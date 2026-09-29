export function isOperationalAlert(analysis, threshold) {
  return analysis.status === 'fall' && analysis.confidence >= threshold;
}

function divide(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

export function summarizeCases(cases) {
  const completed = cases.filter((item) => !item.error);
  const truePositive = completed.filter((item) => item.expectedFall && item.alerted).length;
  const trueNegative = completed.filter((item) => !item.expectedFall && !item.alerted).length;
  const falsePositive = completed.filter((item) => !item.expectedFall && item.alerted).length;
  const falseNegative = completed.filter((item) => item.expectedFall && !item.alerted).length;
  const latencies = completed.map((item) => item.elapsedMs);
  const precision = divide(truePositive, truePositive + falsePositive);
  const recall = divide(truePositive, truePositive + falseNegative);
  return {
    total: cases.length,
    completed: completed.length,
    errors: cases.length - completed.length,
    confusionMatrix: { truePositive, trueNegative, falsePositive, falseNegative },
    accuracy: divide(truePositive + trueNegative, completed.length),
    precision,
    recall,
    specificity: divide(trueNegative, trueNegative + falsePositive),
    falsePositiveRate: divide(falsePositive, trueNegative + falsePositive),
    f1: precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall),
    latencyMs: {
      mean: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
      p95: percentile(latencies, 0.95),
      maximum: latencies.length ? Math.max(...latencies) : null,
    },
  };
}

export function summarizeBy(cases, field) {
  const groups = new Map();
  for (const item of cases) {
    const key = item[field] || 'not_provided';
    const existing = groups.get(key) || [];
    existing.push(item);
    groups.set(key, existing);
  }
  return Object.fromEntries([...groups.entries()].map(([key, items]) => [key, summarizeCases(items)]));
}
