export const PUBLIC_REPORT_ORIGIN = "https://agent-behavior-wrapped-judge.haoxingdu.workers.dev";
import { sanitizePublicReport } from "./public-report-schema.mjs";
const REQUEST_TIMEOUT_MS = 15_000;

export async function publishPublicReport(report, { clientId, fetchImpl = fetch, origin = PUBLIC_REPORT_ORIGIN } = {}) {
  const shareSafeReport = sanitizePublicReport(report);
  if (!shareSafeReport) throw new Error("The report could not be reduced to the public schema.");
  const serialized = JSON.stringify(shareSafeReport);
  if (/"(?:sessionIds|evidence|transcript|tool_result|tool_use)"\s*:/.test(serialized)) throw new Error("The report contains private fields and was not published.");
  let response;
  try {
    response = await fetchImpl(`${origin}/v1/reports`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-behavior-wrapped-protocol": "1", ...(clientId ? { "x-behavior-wrapped-client": clientId } : {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({ report: shareSafeReport }),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new Error("Public hosting timed out.");
    throw new Error("Public hosting is temporarily unavailable.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Public hosting is temporarily unavailable.");
  return body;
}

export async function deletePublicReport(id, { clientId, fetchImpl = fetch, origin = PUBLIC_REPORT_ORIGIN } = {}) {
  const response = await fetchImpl(`${origin}/v1/reports/${id}`, {
    method: "DELETE",
    headers: { "x-behavior-wrapped-protocol": "1", ...(clientId ? { "x-behavior-wrapped-client": clientId } : {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Could not remove the public report.");
  return body;
}
