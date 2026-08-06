import assert from "node:assert/strict";
import test from "node:test";
import { judgeError, judgeErrorDetails, judgeRequestDetails } from "../server/judge-debug.mjs";

test("verbose judge diagnostics contain metrics but never candidate text or secrets", () => {
  const candidates = [{ candidate_id: "candidate-1", text: "private excerpt" }];
  const request = judgeRequestDetails("test-judge", "relay", "https://relay.example/v1/test", candidates);
  const error = judgeError("Request failed", { ...request, authorization: "Bearer secret", upstream_message: "sk-test_12345678901234567890" });
  const details = judgeErrorDetails(error);
  assert.equal(details.candidate_count, 1);
  assert.ok(details.payload_bytes > 0);
  assert.equal("authorization" in details, false);
  assert.equal(details.upstream_message, "[REDACTED]");
  assert.equal(JSON.stringify(details).includes("private excerpt"), false);
});
