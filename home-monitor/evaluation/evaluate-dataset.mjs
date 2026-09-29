import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readNonNegativeInteger, readPositiveInteger, readProbability, requireString } from '../core.mjs';
import { analyzePair } from '../vision.mjs';
import { isOperationalAlert, summarizeBy, summarizeCases } from './metrics.mjs';

function percentage(value) {
  return value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`;
}

function markdownTable(rows) {
  return [
    '| กลุ่ม | จำนวน | Accuracy | Recall | Specificity | F1 | ผิดพลาด |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...Object.entries(rows).map(([name, summary]) =>
      `| ${name} | ${summary.completed} | ${percentage(summary.accuracy)} | ${percentage(summary.recall)} | ${percentage(summary.specificity)} | ${percentage(summary.f1)} | ${summary.errors} |`),
  ].join('\n');
}

function createReport(payload) {
  const { model, threshold, summary, breakdown, results, generatedAt, dataset } = payload;
  const matrix = summary.confusionMatrix;
  const failures = results.filter((item) => item.error || item.expectedFall !== item.alerted);
  const failureRows = failures.length
    ? failures.map((item) => `| ${item.caseId} | ${item.label} | ${item.status || 'error'} | ${item.confidence ?? 'N/A'} | ${item.error || item.reason || ''} |`).join('\n')
    : '| ไม่มี | - | - | - | - |';
  return `# รายงานทดสอบ AI ตรวจจับการล้ม\n\n` +
    `- วันที่ทดสอบ: ${generatedAt}\n- ชุดข้อมูล: ${dataset}\n- โมเดล: ${model}\n` +
    `- เกณฑ์แจ้งเตือน: status = fall และ confidence >= ${threshold}\n- จำนวนกรณี: ${summary.total} (สำเร็จ ${summary.completed}, ผิดพลาด ${summary.errors})\n\n` +
    `## ผลรวม\n\n| ตัวชี้วัด | ผล |\n|---|---:|\n` +
    `| Accuracy | ${percentage(summary.accuracy)} |\n| Precision | ${percentage(summary.precision)} |\n` +
    `| Recall / Sensitivity | ${percentage(summary.recall)} |\n| Specificity | ${percentage(summary.specificity)} |\n` +
    `| F1 | ${percentage(summary.f1)} |\n| False positive rate | ${percentage(summary.falsePositiveRate)} |\n` +
    `| เวลาเฉลี่ย | ${summary.latencyMs.mean ?? 'N/A'} ms |\n| เวลา P95 | ${summary.latencyMs.p95 ?? 'N/A'} ms |\n\n` +
    `## Confusion matrix\n\n| | ระบบแจ้งล้ม | ระบบไม่แจ้ง |\n|---|---:|---:|\n` +
    `| เหตุล้มจริง | ${matrix.truePositive} | ${matrix.falseNegative} |\n` +
    `| ไม่ล้มจริง | ${matrix.falsePositive} | ${matrix.trueNegative} |\n\n` +
    `## แยกตามมุมกล้อง\n\n${markdownTable(breakdown.cameraAngle)}\n\n` +
    `## แยกตามกิจกรรม\n\n${markdownTable(breakdown.action)}\n\n` +
    `## แยกตามกลุ่มอายุจาก metadata\n\n${markdownTable(breakdown.ageGroup)}\n\n` +
    `## กรณีที่ระบบพลาดหรือทำงานไม่สำเร็จ\n\n` +
    `| กรณี | คำตอบจริง | ผลระบบ | ความมั่นใจ | เหตุผล |\n|---|---|---|---:|---|\n${failureRows}\n\n` +
    `## ข้อจำกัด\n\nชุดนำร่องนี้เป็นเหตุการณ์จำลองในห้องและไม่มี metadata อายุหรือเพศ จึงยังใช้สรุปความเท่าเทียมระหว่างเด็ก วัยรุ่น ผู้ใหญ่ และผู้สูงอายุไม่ได้ ต้องทดสอบเพิ่มด้วยข้อมูลที่ได้รับความยินยอมและมี metadata จากผู้เข้าร่วม โดยห้ามเดาอายุหรือเพศจากรูปลักษณ์\n`;
}

async function main() {
  const manifestPath = resolve(process.argv[2] || 'test-artifacts/ai-evaluation/urfall-pilot/manifest.json');
  const outputPath = resolve(process.argv[3] || 'test-artifacts/ai-evaluation/urfall-pilot/results.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const instructions = (await readFile(requireString('HOME_MONITOR_INSTRUCTIONS_FILE', process.env), 'utf8')).trim();
  const threshold = readProbability('HOME_MONITOR_FALL_CONFIDENCE', process.env);
  const config = {
    ollamaUrl: requireString('OLLAMA_API_URL', process.env),
    model: requireString('OLLAMA_MODEL', process.env),
    contextLength: readPositiveInteger('OLLAMA_CONTEXT_LENGTH', process.env),
    gpuLayers: readNonNegativeInteger('OLLAMA_GPU_LAYERS', process.env),
    modelTimeoutMs: readPositiveInteger('HOME_MONITOR_MODEL_TIMEOUT_MS', process.env),
    instructions,
  };
  const results = [];
  for (const [index, testCase] of manifest.cases.entries()) {
    const startedAt = Date.now();
    const base = {
      ...testCase,
      expectedFall: testCase.label === 'fall',
    };
    try {
      const previous = { bytes: await readFile(resolve(testCase.previousFrame)) };
      const current = { bytes: await readFile(resolve(testCase.currentFrame)) };
      const analysis = await analyzePair(previous, current, config);
      const result = {
        ...base,
        ...analysis,
        alerted: isOperationalAlert(analysis, threshold),
        elapsedMs: Date.now() - startedAt,
      };
      results.push(result);
      console.log(`[${index + 1}/${manifest.cases.length}] ${testCase.caseId}: ${analysis.status} ${analysis.confidence}`);
    } catch (error) {
      results.push({ ...base, alerted: false, elapsedMs: Date.now() - startedAt, error: error.message });
      console.log(`[${index + 1}/${manifest.cases.length}] ${testCase.caseId}: ERROR ${error.message}`);
    }
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    dataset: manifest.dataset,
    model: config.model,
    threshold,
    summary: summarizeCases(results),
    breakdown: {
      cameraAngle: summarizeBy(results, 'cameraAngle'),
      action: summarizeBy(results, 'action'),
      ageGroup: summarizeBy(results, 'ageGroup'),
      sex: summarizeBy(results, 'sex'),
    },
    results,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  const reportPath = outputPath.endsWith('.json') ? `${outputPath.slice(0, -5)}.md` : `${outputPath}.md`;
  await writeFile(reportPath, createReport(payload));
  console.log(JSON.stringify({ outputPath, reportPath, summary: payload.summary }, null, 2));
}

main().catch((error) => {
  console.error('ทดสอบชุดข้อมูลไม่สำเร็จ:', error.message);
  process.exitCode = 1;
});
