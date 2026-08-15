import test from "node:test";
import assert from "node:assert/strict";
import { createCliProgress, elapsedLabel } from "../server/progress.mjs";

test("interactive CLI progress animates, updates detail, and reports elapsed time", () => {
  const writes = [];
  const output = { isTTY: true, write(value) { writes.push(value); } };
  let clock = 0;
  let tick;
  let cleared = false;
  const progress = createCliProgress({
    output,
    now: () => clock,
    setIntervalImpl(callback) { tick = callback; return { unref() {} }; },
    clearIntervalImpl() { cleared = true; },
  });
  progress.start("Reading sessions", "1/4");
  clock = 2_000;
  progress.update("2/4");
  tick();
  progress.succeed("Sessions ready");
  const rendered = writes.join("");
  assert.match(rendered, /⠋/);
  assert.match(rendered, /Reading sessions · 2\/4 · 2s/);
  assert.match(rendered, /✓  Sessions ready · 2s/);
  assert.equal(cleared, true);
});

test("non-interactive progress produces stable line-based logs", () => {
  const writes = [];
  const progress = createCliProgress({ output: { isTTY: false, write(value) { writes.push(value); } }, now: () => 0 });
  progress.start("Publishing", "share-safe report");
  progress.succeed("Published");
  assert.deepEqual(writes, ["◇  Publishing · share-safe report\n", "✓  Published · 0s\n"]);
  assert.equal(elapsedLabel(125_000), "2m 5s");
});

test("long interactive phases keep their heading separate and clear only the live task line", () => {
  const writes = [];
  const terminalCalls = [];
  let tick;
  const output = {
    isTTY: true,
    write(value) { writes.push(value); },
    clearLine(direction) { terminalCalls.push(["clearLine", direction]); },
    cursorTo(column) { terminalCalls.push(["cursorTo", column]); },
  };
  const progress = createCliProgress({
    output,
    now: () => 0,
    setIntervalImpl(callback) { tick = callback; return { unref() {} }; },
    clearIntervalImpl() {},
  });
  const tasks = "favorite phrase … · agent interaction … · topics … · workarounds …";
  progress.start("Running redacted excerpts through LLM Judge", tasks, { separateDetail: true });
  tick();
  progress.succeed("LLM Judge complete");
  assert.equal(writes[0], "◇  Running redacted excerpts through LLM Judge\n");
  assert.equal(writes.filter((value) => value.includes("Running redacted excerpts")).length, 1);
  assert.ok(writes.some((value) => value.includes(tasks)));
  assert.deepEqual(terminalCalls.slice(0, 2), [["clearLine", 0], ["cursorTo", 0]]);
  assert.match(writes.at(-1), /✓  LLM Judge complete · 0s/);
});
