import { createInterface } from "node:readline/promises";

const bright = "\x1b[1m";
const lime = "\x1b[38;2;201;242;75m";
const purple = "\x1b[38;2;141;92;255m";
const reset = "\x1b[0m";

export const remoteAnalysisConsentText = "Behavior Wrapped will send redacted excerpts from your session history to GPT-5.6 Luna via OpenRouter using zero-data-retention providers for analysis. OK to proceed?";

export async function requestRemoteAnalysisConsent({ input = process.stdin, output = process.stdout } = {}) {
  const prompt = createInterface({ input, output });
  try {
    const question = `${lime}◇${reset} Behavior Wrapped will send redacted excerpts from your session history to ${purple}${bright}GPT-5.6 Luna${reset} via OpenRouter using zero-data-retention providers for analysis. OK to proceed? ${bright}(Y/n)${reset} `;
    const answer = await prompt.question(question);
    return /^(?:|y|yes)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}
