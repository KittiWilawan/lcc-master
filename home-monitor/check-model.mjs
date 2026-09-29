import { readFile } from 'node:fs/promises';
import { readNonNegativeInteger, readPositiveInteger, requireString } from './core.mjs';
import { analyzePair } from './vision.mjs';

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) throw new Error('ระบุไฟล์ภาพตัวอย่างเพื่อทดสอบโมเดล');
  const bytes = await readFile(imagePath);
  const instructions = (await readFile(requireString('HOME_MONITOR_INSTRUCTIONS_FILE', process.env), 'utf8')).trim();
  const startedAt = Date.now();
  const result = await analyzePair({ bytes }, { bytes }, {
    ollamaUrl: requireString('OLLAMA_API_URL', process.env),
    model: requireString('OLLAMA_MODEL', process.env),
    contextLength: readPositiveInteger('OLLAMA_CONTEXT_LENGTH', process.env),
    gpuLayers: readNonNegativeInteger('OLLAMA_GPU_LAYERS', process.env),
    instructions,
    modelTimeoutMs: readPositiveInteger('HOME_MONITOR_MODEL_TIMEOUT_MS', process.env),
  });
  const elapsedMs = Date.now() - startedAt;
  const maxAnalysisMs = readPositiveInteger('HOME_MONITOR_MAX_ANALYSIS_MS', process.env);
  if (elapsedMs > maxAnalysisMs) {
    throw new Error(`โมเดลวิเคราะห์ช้าเกินกำหนด (${elapsedMs} ms > ${maxAnalysisMs} ms)`);
  }
  console.log(JSON.stringify({ result, elapsedMs }, null, 2));
}

main().catch((error) => {
  console.error('ทดสอบโมเดลไม่สำเร็จ:', error.message);
  process.exitCode = 1;
});
