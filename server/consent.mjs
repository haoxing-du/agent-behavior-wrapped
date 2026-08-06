import { createInterface } from "node:readline/promises";

export const remoteAnalysisConsentText = `Behavior Wrapped sends redacted excerpts derived from your session history to Nemotron 3 Ultra via the Behavior Wrapped relay and OpenRouter for analysis. Redaction reduces risk, but may not catch everything.

It also publishes a share-safe report containing aggregate results—not transcripts—at a public URL.`;

export async function requestRemoteAnalysisConsent({ input = process.stdin, output = process.stdout } = {}) {
  const prompt = createInterface({ input, output });
  try {
    const answer = await prompt.question(`${remoteAnalysisConsentText}\n\nProceed? (y/N) `);
    return /^(?:y|yes)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}
