import assert from "node:assert/strict";
import test from "node:test";
import { browserOpenCommand, canonicalSessionDirectoryLabels, canonicalSessionRoots, openExternalUrl, supportedAgentNames } from "../server/platform.mjs";

test("canonical Linux roots include Claude Code and Codex but not macOS-only Cowork", () => {
  const roots = canonicalSessionRoots({ home: "/home/tester", platform: "linux" });
  assert.equal(roots.claudeRoot, "/home/tester/.claude/projects");
  assert.deepEqual(roots.codexRoots, ["/home/tester/.codex/sessions", "/home/tester/.codex/archived_sessions"]);
  assert.equal(roots.coworkRoot, null);
  assert.deepEqual(canonicalSessionDirectoryLabels("linux"), ["~/.claude/projects", "~/.codex/sessions", "~/.codex/archived_sessions"]);
  assert.deepEqual(supportedAgentNames("linux"), ["Claude Code", "Codex"]);
});

test("canonical macOS roots retain Cowork discovery", () => {
  const roots = canonicalSessionRoots({ home: "/Users/tester", platform: "darwin" });
  assert.equal(roots.coworkRoot, "/Users/tester/Library/Application Support/Claude/local-agent-mode-sessions");
  assert.equal(canonicalSessionDirectoryLabels("darwin").length, 4);
  assert.deepEqual(supportedAgentNames("darwin"), ["Claude Code", "Cowork", "Codex"]);
});

test("browser opening uses the native macOS and Linux launchers", () => {
  assert.deepEqual(browserOpenCommand("https://example.com", "darwin"), { file: "open", args: ["https://example.com"] });
  assert.deepEqual(browserOpenCommand("https://example.com", "linux"), { file: "xdg-open", args: ["https://example.com"] });
  assert.equal(browserOpenCommand("https://example.com", "win32"), null);
});

test("browser launcher failures are non-fatal", () => {
  const calls = [];
  const child = { on(event, listener) { calls.push(event); listener(new Error("missing")); }, unref() { calls.push("unref"); } };
  assert.equal(openExternalUrl("https://example.com", { platform: "linux", spawnImpl(file, args, options) {
    calls.push([file, args, options]);
    return child;
  } }), true);
  assert.equal(calls[0][0], "xdg-open");
  assert.deepEqual(calls.slice(1), ["error", "unref"]);
});
