// Standard API list prices in USD per million tokens, verified 2026-08-26.
// OpenAI: https://developers.openai.com/api/docs/models/compare
// Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
const scaled = (value, multiplier) => Number((value * multiplier).toFixed(12));

const price = (input, output, cacheRead, cacheWrite5m, cacheWrite1h) => ({
  input,
  output,
  cacheRead: cacheRead ?? scaled(input, 0.1),
  cacheWrite5m: cacheWrite5m ?? scaled(input, 1.25),
  cacheWrite1h: cacheWrite1h ?? scaled(input, 2),
});

const modelRates = [
  [/gpt-5\.6-sol/, price(4, 20)],
  [/gpt-5\.6-terra/, price(2, 12)],
  [/gpt-5\.6-luna/, price(0.2, 1.2)],
  [/gpt-5\.5-pro/, price(30, 180, 0, 30, 30)],
  [/gpt-5\.5/, price(5, 30)],
  [/gpt-5\.4-pro/, price(30, 180, 0, 30, 30)],
  [/gpt-5\.4-mini/, price(0.75, 4.5)],
  [/gpt-5\.4-nano/, price(0.2, 1.25)],
  [/gpt-5\.4/, price(2.5, 15)],
  [/gpt-5\.3-codex/, price(1.75, 14)],
  [/gpt-5\.2/, price(1.75, 14)],
  [/(?:claude-)?(?:fable|mythos)(?:-|\s)?5/, price(10, 50)],
  [/(?:claude-)?opus(?:-|\s)?5/, price(5, 25)],
  [/(?:claude-)?opus(?:-|\s)?4(?:-|\s)?(?:8|7|6|5)/, price(5, 25)],
  [/(?:claude-)?opus(?:-|\s)?4(?:-|\s)?1/, price(15, 75)],
  [/(?:claude-)?opus(?:-|\s)?4(?:\b|-20)/, price(15, 75)],
  [/(?:claude-)?sonnet(?:-|\s)?5/, price(2, 10)],
  [/(?:claude-)?sonnet(?:-|\s)?4/, price(3, 15)],
  [/(?:claude-)?haiku(?:-|\s)?4(?:-|\s)?5/, price(1, 5)],
  [/(?:claude-)?haiku(?:-|\s)?3(?:-|\s)?5/, price(0.8, 4)],
];

export function ratesFor(model, agent) {
  const value = String(model || "").toLowerCase();
  const match = modelRates.find(([pattern]) => pattern.test(value));
  if (match) return match[1];
  return agent === "codex" || value.startsWith("gpt") ? price(2.5, 15) : price(3, 15);
}

export function estimateModelUsageCost(usage, model, agent) {
  const input = Number(usage?.input_tokens) || 0;
  const output = Number(usage?.output_tokens) || 0;
  const reasoning = Number(usage?.reasoning_output_tokens) || 0;
  const cacheRead = Number(usage?.cache_read_input_tokens) || 0;
  const cacheWrite = Number(usage?.cache_creation_input_tokens) || 0;
  const declared5m = Number(usage?.cache_creation?.ephemeral_5m_input_tokens) || 0;
  const declared1h = Number(usage?.cache_creation?.ephemeral_1h_input_tokens) || 0;
  const cacheWrite5m = declared5m + Math.max(0, cacheWrite - declared5m - declared1h);
  const rates = ratesFor(model, agent);
  return (
    input * rates.input
    + (output + reasoning) * rates.output
    + cacheRead * rates.cacheRead
    + cacheWrite5m * rates.cacheWrite5m
    + declared1h * rates.cacheWrite1h
  ) / 1_000_000;
}
