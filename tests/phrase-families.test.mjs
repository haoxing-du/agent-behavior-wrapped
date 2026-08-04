import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { minePhraseFamilies } from "../scripts/mine-phrase-families.mjs";

test("clusters synthetic near-duplicate phrases without all-pairs verification", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "behavior-wrapped-phrases-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const phrases = [
    "Let me inspect the configuration.",
    "Let me check the configuration.",
    "Let me review the configuration.",
  ];
  const unrelated = [
    "Quartz beacons illuminate frozen valleys.",
    "Gentle rivers carry autumn leaves.",
    "Copper engines measure distant thunder.",
  ];
  const personPhrases = [
    "Morgan ordered a pause now.",
    "Morgan requested a pause now.",
    "A pause was requested.",
  ];
  const byPersonPhrases = [
    "The pause was reaffirmed by Morgan today.",
    "The plan was reaffirmed by Morgan today.",
    "A separate observation was recorded.",
  ];
  const responsePhrases = [
    "I'll only respond if Morgan directly pings.",
    "I'll only answer if Morgan directly pings.",
    "No response is needed.",
  ];
  const pluralMessagePhrases = [
    "No new Morgan messages since yesterday.",
    "No recent Morgan messages since yesterday.",
    "No messages were found.",
  ];
  phrases.forEach((phrase, index) => {
    const project = path.join(root, `project-${index}`);
    fs.mkdirSync(project);
    const records = [phrase, unrelated[index], personPhrases[index], byPersonPhrases[index], responsePhrases[index], pluralMessagePhrases[index]].map((text) => JSON.stringify({
      type: "assistant",
      message: { model: "synthetic-test-model", content: [{ type: "text", text }] },
    }));
    fs.writeFileSync(path.join(project, `session-${index}.jsonl`), `${records.join("\n")}\n`);
  });

  const artifact = await minePhraseFamilies(root);
  const family = artifact.phrase_families.find((item) => item.template === "let me […] the configuration");
  assert.ok(family);
  assert.equal(family.occurrences, 3);
  assert.equal(family.distinct_sessions, 3);
  assert.equal(family.variant_count, 3);
  assert.ok(artifact.candidate_reduction.edit_distance_verified_pairs < artifact.candidate_reduction.theoretical_all_pairs);
  assert.ok(!JSON.stringify(artifact).toLowerCase().includes("morgan"));
  assert.ok(JSON.stringify(artifact).includes("person"));
  assert.ok(JSON.stringify(artifact).includes("only respond"));
  assert.ok(!JSON.stringify(artifact).includes("person respond"));
});
