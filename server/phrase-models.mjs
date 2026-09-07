// Counts describe the models that said the selected phrase, not the selection judge.
export function validatePhraseModels(value, total) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) return null;
  const seen = new Set();
  const models = [];
  for (const item of value) {
    const model = typeof item?.model === "string" ? item.model.normalize("NFKC").trim() : "";
    if (!/^[\p{L}\p{N} ._+-]{1,80}$/u.test(model) || seen.has(model)
      || !Number.isInteger(item?.count) || item.count < 1 || item.count > 10_000_000) return null;
    seen.add(model);
    models.push({ model, count: item.count });
  }
  if (models.length && models.reduce((sum, item) => sum + item.count, 0) !== total) return null;
  return models.sort((left, right) => right.count - left.count || left.model.localeCompare(right.model));
}

export function parsePhraseModels(value, total) {
  try { return validatePhraseModels(JSON.parse(value), total) || []; } catch { return []; }
}
