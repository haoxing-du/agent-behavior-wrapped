import { sanitizeResearchDonation } from "./research-donation-schema.mjs";

export const RESEARCH_DONATION_URL = "https://agent-behavior-wrapped-judge.haoxingdu.workers.dev/v1/research-donations";
const REQUEST_TIMEOUT_MS = 30_000;

export async function submitResearchDonation(value, { clientId, endpoint = RESEARCH_DONATION_URL, fetchImpl = fetch } = {}) {
  const donation = sanitizeResearchDonation(value);
  if (!donation) throw new Error("The reviewed donation does not match the research schema.");
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-behavior-wrapped-protocol": "1",
        ...(clientId ? { "x-behavior-wrapped-client": clientId } : {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({ donation }),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new Error("The research donation timed out. Your data was not confirmed as received.");
    throw new Error("The research donation service is temporarily unavailable.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "The research donation could not be accepted.");
  return body;
}
