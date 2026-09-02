import test from "node:test";
import assert from "node:assert/strict";
import { donationSessionIntegrityError } from "../server/donation-session-integrity.mjs";

const source = [{
  sessionId: "session-1",
  messages: [
    { role: "user", sourceIndex: 2, text: "Original request" },
    { role: "assistant", sourceIndex: 4, text: "Original answer" },
    { role: "assistant", sourceIndex: 7, text: "Follow-up answer" },
  ],
}];

test("donation sessions may edit text while preserving every source message", () => {
  const donated = structuredClone(source);
  donated[0].messages[0].text = "[REDACTED]";
  donated[0].messages[1].text = "Reviewed answer";
  assert.equal(donationSessionIntegrityError(donated, source), null);
});

test("donation sessions cannot omit or reorder individual messages", () => {
  const omitted = structuredClone(source);
  omitted[0].messages.splice(1, 1);
  assert.match(donationSessionIntegrityError(omitted, source), /keep every original message/);

  const reordered = structuredClone(source);
  [reordered[0].messages[1], reordered[0].messages[2]] = [reordered[0].messages[2], reordered[0].messages[1]];
  assert.match(donationSessionIntegrityError(reordered, source), /original order/);
});
