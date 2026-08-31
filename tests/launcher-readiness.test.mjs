import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
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
