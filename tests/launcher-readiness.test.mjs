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

test("classifier corrections launch Susan with the stored source session and survive helper exit", { timeout: 8_000 }, async (t) => {
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

  const post = (body, from = origin) => fetch(`${origin}/api/share-with-susan`, {
    method: "POST", headers: { origin: from, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await post({}, "https://attacker.example")).status, 403);
  assert.equal((await post({ reportId, feedbackId: "yelling-999" })).status, 404);
  const body = { reportId, feedbackId: "yelling-1", sessionIds: [other], correctedLabel: "thanking", judgedText: "Injected" };
  const responses = await Promise.all([post(body), post(body)]);
  const [local, duplicate] = await Promise.all(responses.map(r => r.json()));
  assert.equal(local.url, duplicate.url);
  assert.match(local.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  t.after(() => fetch(`${local.url}/api/shutdown`, { method: "POST", headers: { origin: local.url } }));
  const susan = await (await fetch(`${local.url}/api/catalog`)).json();
  assert.equal(susan.demo, true);
  assert.deepEqual(susan.sessions.map(s => s.id), [source]);
  assert.equal(susan.feedback.judgedText, "This is worse than before.");
  assert.equal(susan.feedback.correctedLabel, undefined);
  const general = await (await post({ reportId, sessionIds: [source] })).json();
  t.after(() => fetch(`${general.url}/api/shutdown`, { method: "POST", headers: { origin: general.url } }));
  const all = await (await fetch(`${general.url}/api/catalog`)).json();
  assert.ok(all.sessions.length > 1);
  assert.equal(all.feedback, undefined);
  child.kill("SIGTERM");
  assert.equal((await fetch(`${local.url}/api/health`)).status, 200);

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
