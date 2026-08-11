import { encryptResearchDonation } from "./research-donation-crypto.mjs";
import { BEHAVIOR_WRAPPED_ORIGIN } from "./origins.mjs";

export const RESEARCH_DONATION_URL = `${BEHAVIOR_WRAPPED_ORIGIN}/v1/research-donations`;
const REQUEST_TIMEOUT_MS = 30_000;

export async function submitResearchDonation(value, { clientId, endpoint = RESEARCH_DONATION_URL, fetchImpl = fetch } = {}) {
  const encryptedDonation = encryptResearchDonation(value);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-behavior-wrapped-protocol": "2",
        ...(clientId ? { "x-behavior-wrapped-client": clientId } : {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({ encryptedDonation }),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new Error("The research donation timed out. Your data was not confirmed as received.");
    throw new Error("The research donation service is temporarily unavailable.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "The research donation could not be accepted.");
  return body;
}

export async function deleteResearchDonation(id, deletionToken, { endpoint = RESEARCH_DONATION_URL, fetchImpl = fetch } = {}) {
  if (!/^[0-9a-f-]{36}$/.test(id || "") || !/^[A-Za-z0-9_-]{43}$/.test(deletionToken || "")) throw new Error("The local deletion receipt is invalid.");
  const response = await fetchImpl(`${endpoint}/${id}`, {
    method: "DELETE",
    headers: { "x-behavior-wrapped-protocol": "2", "x-behavior-wrapped-deletion-token": deletionToken },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!response) throw new Error("The research donation service is temporarily unavailable.");
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "The research donation could not be deleted.");
  return body;
}
