import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readRecords } from "../server/discovery.mjs";

test("Codex tool inputs and outputs are retained only for private local evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "behavior-private-evidence-"));
  const file = path.join(directory, "session.jsonl");
  const records = [
    { timestamp: "2026-08-01T00:00:00.000Z", type: "turn_context", payload: { model: "gpt-test" } },
    { timestamp: "2026-08-01T00:00:01.000Z", type: "response_item", payload: { type: "custom_tool_call", call_id: "call-1", name: "exec", input: 'tools.exec_command({ cmd: "rm -rf /tmp/cache" })' } },
    { timestamp: "2026-08-01T00:00:02.000Z", type: "response_item", payload: { type: "custom_tool_call_output", call_id: "call-1", output: "Rejected: operation not permitted" } },
  ];
  fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n"));
  try {
    const ordinary = readRecords(file, "codex");
    const privateEvidence = readRecords(file, "codex", { includePrivateToolDetails: true });
    assert.equal(ordinary[0].message.content[0].input, undefined);
    assert.equal(ordinary[1].message.content[0].content, undefined);
    assert.equal(privateEvidence[0].message.content[0].input, 'tools.exec_command({ cmd: "rm -rf /tmp/cache" })');
    assert.equal(privateEvidence[1].message.content[0].content, "Rejected: operation not permitted");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
