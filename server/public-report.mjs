import { randomBytes } from "node:crypto";
import { sanitizePublicReport } from "./public-report-schema.mjs";
import { BEHAVIOR_WRAPPED_ORIGIN } from "./origins.mjs";
export const PUBLIC_REPORT_ORIGIN = BEHAVIOR_WRAPPED_ORIGIN;
const REQUEST_TIMEOUT_MS = 15_000;

export async function publishPublicReport(report, { clientId, fetchImpl = fetch, origin = PUBLIC_REPORT_ORIGIN, managementToken = randomBytes(32).toString("hex") } = {}) {
  const shareSafeReport = sanitizePublicReport(report);
  if (!shareSafeReport) throw new Error("The report could not be reduced to the public schema.");
  if (!/^[a-f0-9]{64}$/.test(managementToken)) throw new Error("The report management credential is invalid.");
  const serialized = JSON.stringify(shareSafeReport);
  if (/"(?:sessionIds|evidence|transcript|tool_result|tool_use)"\s*:/.test(serialized)) throw new Error("The report contains private fields and was not published.");
  let response;
  try {
    response = await fetchImpl(`${origin}/v1/reports`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-behavior-wrapped-protocol": "1", ...(clientId ? { "x-behavior-wrapped-client": clientId } : {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({ report: shareSafeReport, management_token: managementToken }),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new Error("Public hosting timed out.");
    throw new Error("Public hosting is temporarily unavailable.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Public hosting is temporarily unavailable.");
  return { ...body, management_url: `${body.public_url}#manage=${managementToken}` };
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
