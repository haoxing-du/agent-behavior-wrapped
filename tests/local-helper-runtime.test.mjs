import test from "node:test";
import assert from "node:assert/strict";
import { createIdleShutdownController, helperHealthMatches, isVerifiedLauncherCommand, stopVerifiedStaleHelper } from "../server/local-helper-runtime.mjs";

const expected = { version: "0.4.2", protocol: 2, demo: false };

test("local helper health requires an exact app version and donation protocol", () => {
  const health = { app: "behavior-wrapped", version: "0.4.2", local: true, purpose: "research-donation", donationProtocol: 2, demo: false };
  assert.equal(helperHealthMatches(health, expected), true);
  assert.equal(helperHealthMatches({ ...health, version: "0.4.1" }, expected), false);
  assert.equal(helperHealthMatches({ ...health, donationProtocol: 1 }, expected), false);
  assert.equal(helperHealthMatches({ ...health, demo: true }, expected), false);
});

test("only a Behavior Wrapped launcher on the requested port is trusted for replacement", () => {
  assert.equal(isVerifiedLauncherCommand("/opt/homebrew/bin/node /tmp/node_modules/behavior-wrapped/server/launcher.mjs --port=4317 --no-open", 4317), true);
  assert.equal(isVerifiedLauncherCommand("node /Users/me/agent-behavior-wrapped/server/launcher.mjs --port=4317 --no-open", 4317), true);
  assert.equal(isVerifiedLauncherCommand("node server/launcher.mjs --port=4317 --no-open", 4317), true);
  assert.equal(isVerifiedLauncherCommand("node /tmp/node_modules/behavior-wrapped/server/launcher.mjs --port=9999", 4317), false);
  assert.equal(isVerifiedLauncherCommand("python -m http.server 4317", 4317), false);
});

test("stale helper replacement validates the listening process before terminating it", async () => {
  const killed = [];
  const commands = new Map([
    ["/usr/sbin/lsof", "410\n411\n"],
    ["/bin/ps:410", "node /tmp/node_modules/behavior-wrapped/server/launcher.mjs --port=4317 --no-open\n"],
    ["/bin/ps:411", "python -m http.server 4317\n"],
  ]);
  const runCommand = async (file, args) => commands.get(file === "/bin/ps" ? `${file}:${args[1]}` : file) || "";
  assert.equal(await stopVerifiedStaleHelper(4317, null, { runCommand, kill: (pid, signal) => killed.push([pid, signal]) }), true);
  assert.deepEqual(killed, [[410, "SIGTERM"]]);
});

test("an advertised helper PID must also own the listening port", async () => {
  const killed = [];
  const commands = new Map([
    ["/usr/sbin/lsof", "410\n"],
    ["/bin/ps:410", "node server/launcher.mjs --port=4317 --no-open\n"],
  ]);
  const runCommand = async (file, args) => commands.get(file === "/bin/ps" ? `${file}:${args[1]}` : file) || "";
  assert.equal(await stopVerifiedStaleHelper(4317, 999, { runCommand, kill: (pid, signal) => killed.push([pid, signal]) }), false);
  assert.deepEqual(killed, []);
});

test("a daemon helper shuts down after its idle window", () => {
  const timers = [];
  let shutdowns = 0;
  createIdleShutdownController({
    enabled: true,
    idleMs: 300_000,
    onIdle: () => { shutdowns += 1; },
    setTimeoutImpl(callback, delay) {
      const timer = { callback, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl(timer) { timer.cleared = true; },
  });
  assert.equal(timers[0].delay, 300_000);
  timers[0].callback();
  assert.equal(shutdowns, 1);
});

test("page heartbeats reset the daemon helper idle window", () => {
  const timers = [];
  let shutdowns = 0;
  const controller = createIdleShutdownController({
    enabled: true,
    idleMs: 300_000,
    onIdle: () => { shutdowns += 1; },
    setTimeoutImpl(callback, delay) {
      const timer = { callback, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl(timer) { timer.cleared = true; },
  });
  controller.touch();
  assert.equal(timers[0].cleared, true);
  assert.equal(timers.length, 2);
  assert.equal(shutdowns, 0);
  timers[1].callback();
  assert.equal(shutdowns, 1);
});

test("direct development helpers do not schedule idle shutdown", () => {
  let scheduled = false;
  createIdleShutdownController({
    enabled: false,
    idleMs: 300_000,
    onIdle() {},
    setTimeoutImpl() { scheduled = true; },
  });
  assert.equal(scheduled, false);
});
