import { execFile } from "node:child_process";

function run(file, args) {
  return new Promise((resolve, reject) => execFile(file, args, { encoding: "utf8" }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}

export function helperHealthMatches(value, { version, protocol, demo }) {
  return Boolean(value && value.app === "behavior-wrapped" && value.local === true && value.purpose === "research-donation"
    && value.version === version && value.donationProtocol === protocol && Boolean(value.demo) === Boolean(demo));
}

export function createIdleShutdownController({
  enabled,
  idleMs,
  onIdle,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  let timer = null;
  let stopped = false;

  function schedule() {
    if (!enabled || stopped) return;
    if (timer) clearTimeoutImpl(timer);
    timer = setTimeoutImpl(() => {
      timer = null;
      stopped = true;
      onIdle();
    }, idleMs);
    timer?.unref?.();
  }

  function touch() { schedule(); }
  function stop() {
    stopped = true;
    if (timer) clearTimeoutImpl(timer);
    timer = null;
  }

  schedule();
  return { touch, stop };
}

export function isVerifiedLauncherCommand(command, port) {
  const escapedPort = String(port).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:/(?:agent-)?behavior-wrapped/|(?:^|\\s))server/launcher\\.mjs(?:\\s|$)`, "i").test(command || "")
    && new RegExp(`(?:^|\\s)--port=${escapedPort}(?:\\s|$)`).test(command || "");
}

async function listeningPids(port, runCommand) {
  try {
    const output = await runCommand("/usr/sbin/lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return String(output).split(/\s+/).filter((value) => /^\d+$/.test(value)).map(Number);
  } catch { return []; }
}

export async function stopVerifiedStaleHelper(port, advertisedPid, { runCommand = run, kill = process.kill } = {}) {
  const listeners = await listeningPids(port, runCommand);
  const candidates = Number.isInteger(advertisedPid) && advertisedPid > 1 ? listeners.filter((pid) => pid === advertisedPid) : listeners;
  let stopped = false;
  for (const pid of candidates) {
    let command;
    try { command = await runCommand("/bin/ps", ["-p", String(pid), "-o", "command="]); }
    catch { continue; }
    if (!isVerifiedLauncherCommand(String(command).trim(), port)) continue;
    try { kill(pid, "SIGTERM"); stopped = true; }
    catch (error) { if (error?.code !== "ESRCH") throw error; }
  }
  return stopped;
}
