const MAX_SESSION_TURNS = 1_000_000;
const CONTOUR_POINT_COUNT = 64;

function validSessionTurns(values) {
  return Array.isArray(values)
    ? values.flatMap((value) => Number.isInteger(value) && value >= 1 && value <= MAX_SESSION_TURNS ? [value] : [])
    : [];
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildSessionLengthDistribution(values) {
  const sessions = validSessionTurns(values);
  if (!sessions.length) return { session_count: 0, median_turns: 0, min_turns: 0, max_turns: 0, points: [] };

  const logs = sessions.map((value) => Math.log10(value));
  const observedMinimum = Math.min(...logs);
  const observedMaximum = Math.max(...logs);
  const observedSpan = observedMaximum - observedMinimum;
  const padding = Math.max(.12, observedSpan * .08);
  const domainMinimum = Math.max(0, observedMinimum - padding);
  const domainMaximum = Math.max(domainMinimum + .32, observedMaximum + padding);
  const mean = logs.reduce((sum, value) => sum + value, 0) / logs.length;
  const variance = logs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / logs.length;
  const deviation = Math.sqrt(variance);
  const bandwidth = Math.max(.08, Math.min(.32, 1.06 * (deviation || .18) * logs.length ** -.2));
  const raw = Array.from({ length: CONTOUR_POINT_COUNT }, (_, index) => {
    const position = domainMinimum + index / (CONTOUR_POINT_COUNT - 1) * (domainMaximum - domainMinimum);
    const density = logs.reduce((sum, value) => sum + Math.exp(-.5 * ((position - value) / bandwidth) ** 2), 0) / logs.length;
    return { turns: 10 ** position, density };
  });
  const maximumDensity = Math.max(...raw.map((point) => point.density), Number.EPSILON);

  return {
    session_count: sessions.length,
    median_turns: Number(median(sessions).toFixed(1)),
    min_turns: Math.min(...sessions),
    max_turns: Math.max(...sessions),
    points: raw.map((point) => ({
      turns: Number(point.turns.toPrecision(7)),
      density: Number((point.density / maximumDensity).toFixed(4)),
    })),
  };
}

export function parseSessionLengthDistribution(value) {
  let parsed;
  try { parsed = typeof value === "string" ? JSON.parse(value) : value; }
  catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const sessionCount = Number(parsed.session_count);
  const medianTurns = Number(parsed.median_turns);
  const minTurns = Number(parsed.min_turns);
  const maxTurns = Number(parsed.max_turns);
  if (![sessionCount, medianTurns, minTurns, maxTurns].every(Number.isFinite)) return null;
  if (!Number.isInteger(sessionCount) || sessionCount < 0 || sessionCount > 100_000_000) return null;
  if (sessionCount === 0) return parsed.points?.length === 0 ? { session_count: 0, median_turns: 0, min_turns: 0, max_turns: 0, points: [] } : null;
  if (medianTurns < 1 || minTurns < 1 || maxTurns < minTurns || maxTurns > MAX_SESSION_TURNS || medianTurns > maxTurns) return null;
  if (!Array.isArray(parsed.points) || parsed.points.length !== CONTOUR_POINT_COUNT) return null;
  let previousTurns = 0;
  const points = parsed.points.flatMap((point) => {
    const turns = Number(point?.turns);
    const density = Number(point?.density);
    if (!Number.isFinite(turns) || turns <= previousTurns || turns < 1 || turns > MAX_SESSION_TURNS * 2 || !Number.isFinite(density) || density < 0 || density > 1) return [];
    previousTurns = turns;
    return [{ turns, density }];
  });
  return points.length === CONTOUR_POINT_COUNT ? { session_count: sessionCount, median_turns: medianTurns, min_turns: minTurns, max_turns: maxTurns, points } : null;
}
