import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidates, resolveJudgment } from "../scripts/judge-wrapped-phrases.mjs";

test("resolves judge IDs to canonical exact phrases and counts", () => {
  const phraseFamilies = Array.from({ length: 6 }, (_, index) => ({
    rank: index + 1,
    template: `safe phrase ${index + 1} […]`,
    occurrences: 10 + index,
    distinct_sessions: 8 + index,
    opening_rate: 0.5,
    variants: [{ phrase: `safe exact phrase ${index + 1}`, occurrences: 3 + index, distinct_sessions: 3 + index }],
  }));
  const candidates = buildCandidates({ phrase_families: phraseFamilies });
  const candidateMap = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
  const judgment = resolveJudgment({
    winner: { candidate_id: "1:1", interestingness_score: 90, card_title: "A title", rationale: "Clear", caveat: "None" },
    shortlist: candidates.slice(1).map((candidate) => ({ candidate_id: candidate.candidate_id, interestingness_score: 70, rationale: "Alternative" })),
    corpus_assessment: "Synthetic corpus.",
  }, candidateMap);
  assert.equal(judgment.winner.phrase, "safe exact phrase 1");
  assert.equal(judgment.winner.occurrences, 3);
  assert.equal(judgment.winner.card_copy, "Your agent said “safe exact phrase 1” 3 times.");
});
