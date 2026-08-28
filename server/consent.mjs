import { createInterface } from "node:readline/promises";

const bright = "\x1b[1m";
const lime = "\x1b[38;2;201;242;75m";
const purple = "\x1b[38;2;141;92;255m";
const reset = "\x1b[0m";

export const remoteAnalysisConsentText = "Behavior Wrapped will send redacted excerpts from your session history to GPT-5.6 Luna via OpenRouter using zero-data-retention providers for analysis. OK to proceed?";
export const localOnlyAnalysisText = "Local-only analysis keeps all session data on this device. It uses deterministic statistics and a locally counted favorite phrase, but omits AI-judged interaction tone, usage topics, and instrumental workarounds. Those omissions leave leaderboard plots 2 and 3 incomplete, so the report will not be published or included in the leaderboard.";
export const researchDonationIntroText = [
  "Your Claude Code and Codex sessions from the last 30 days are read and analyzed locally.",
  "With permission, redacted excerpts are sent to an LLM judge for additional analysis.",
  "Your public Wrapped contains aggregate statistics only.",
  "At the end, you may optionally review and donate select transcripts to the Susan Calvin Project (susancalvin.org). Research donation is optional and is not required to create your Wrapped.",
];

export function formatResearchDonationIntro() {
  return [
    `${bright}Before we begin${reset}`,
    "",
    ...researchDonationIntroText.map((line, index) => `${purple}${index + 1}.${reset} ${line}`),
  ].join("\n");
}

export async function requestAnalysisMode({ input = process.stdin, output = process.stdout } = {}) {
  const prompt = createInterface({ input, output });
  try {
    output.write(`\n${formatResearchDonationIntro()}\n\n`);
    const question = `${lime}◇${reset} ${remoteAnalysisConsentText.replace("GPT-5.6 Luna", `${purple}${bright}GPT-5.6 Luna${reset}`)} ${bright}(Y/n)${reset} `;
    const answer = await prompt.question(question);
    if (/^(?:|y|yes)$/i.test(answer.trim())) return "remote";
    output.write(`\n${localOnlyAnalysisText}\n\n`);
    const localAnswer = await prompt.question(`${lime}◇${reset} Proceed with local-only analysis? ${bright}(Y/n)${reset} `);
    return /^(?:|y|yes)$/i.test(localAnswer.trim()) ? "local-only" : "cancel";
  } finally {
    prompt.close();
  }
}

export async function requestRemoteAnalysisConsent(options) {
  return await requestAnalysisMode(options) === "remote";
}
