import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const launcher = path.join(root, "server", "launcher.mjs");
const cli = path.join(root, "server", "cli.mjs");

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(200) });
      if (response.ok) return response.json();
    } catch { /* The process may still be binding its socket. */ }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`helper did not become healthy within ${timeoutMs}ms`);
}

test("helper health does not wait for a slow session catalog", { timeout: 5_000 }, async (t) => {
  const port = await availablePort();
  const child = spawn(process.execPath, [launcher, `--port=${port}`, "--demo", "--no-open"], {
    cwd: root,
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "test", BEHAVIOR_WRAPPED_TEST_CATALOG_DELAY_MS: "2000" },
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  const startedAt = Date.now();
  const health = await waitForHealth(port, 1_200);
  assert.equal(health.catalogState, "not-loaded");
  assert.ok(Date.now() - startedAt < 1_200);
});

test("classifier feedback preview and submission stay locked to the stored source session", { timeout: 8_000 }, async (t) => {
  const port = await availablePort();
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "behavior-wrapped-feedback-"));
  const child = spawn(process.execPath, [launcher, `--port=${port}`, "--demo", "--no-open"], {
    cwd: root,
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "test", BEHAVIOR_WRAPPED_STORE_ROOT: store },
  });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGTERM");
    fs.rmSync(store, { recursive: true, force: true });
  });
  await waitForHealth(port, 1_500);
  const origin = `http://127.0.0.1:${port}`;
  const catalog = await (await fetch(`${origin}/api/discover`)).json();
  assert.ok(catalog.sessions.length >= 2);
  const source = catalog.sessions[0].id;
  const other = catalog.sessions[1].id;
  const reportId = "feedbackRoute1";
  fs.mkdirSync(path.join(store, "reports"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(store, "reports", `${reportId}.json`), JSON.stringify({
    id: reportId,
    sessionIds: [source, other],
    interactionReview: {
      model: "openai/gpt-5.6-luna",
      promptVersion: 1,
      frustrated: [{ candidateId: "interaction-1", judgedText: "This is worse than before.", occurrences: 1, confidence: 1, location: { sessionId: source, recordIndex: 0 } }],
      grateful: [],
    },
  }), { mode: 0o600 });

  const selectionResponse = await fetch(`${origin}/api/reports/${reportId}/interaction-feedback/yelling-1`);
  assert.equal(selectionResponse.status, 200);
  const selection = await selectionResponse.json();
  assert.deepEqual(selection.sessionIds, [source]);
  assert.equal("sessionId" in selection.feedback, false);

  const previewResponse = await fetch(`${origin}/api/donation-preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reportId, feedbackId: "yelling-1", sessionIds: [other], previewMode: "redacted" }),
  });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.sessions.length, 1);
  assert.equal(preview.sessions[0].sessionId, source);

  const rejected = await fetch(`${origin}/api/research-donations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      donation: { reportId, sessions: [{ sessionId: other, messages: [{ role: "user", text: "Reviewed text" }] }] },
      feedback: { feedbackId: "yelling-1", correctedLabel: "neither" },
    }),
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /only its original session/);
});

test("CLI explains when another application occupies the helper port", { timeout: 5_000 }, async (t) => {
  const blocker = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ app: "another-application" }));
  });
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => blocker.close());
  const port = blocker.address().port;
  const result = await new Promise((resolve) => {
    execFile(process.execPath, [cli, "--demo", "--test", "--no-open"], {
      cwd: root,
      env: { ...process.env, NODE_ENV: "test", BEHAVIOR_WRAPPED_PORT: String(port) },
      timeout: 4_000,
    }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
  });
  assert.ok(result.error);
  assert.match(result.stderr, /Another application may already be using that port/);
});
