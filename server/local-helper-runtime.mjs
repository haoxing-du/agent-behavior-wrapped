import { execFile } from "node:child_process";

function run(file, args) {
  return new Promise((resolve, reject) => execFile(file, args, { encoding: "utf8" }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}

export function helperHealthMatches(value, { version, protocol, demo }) {
  return Boolean(value && value.app === "behavior-wrapped" && value.local === true && value.purpose === "research-donation"
    && value.version === version && value.donationProtocol === protocol && Boolean(value.demo) === Boolean(demo));
}

export function isVerifiedLauncherCommand(command, port) {
  const escapedPort = String(port).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`/(?:agent-)?behavior-wrapped/server/launcher\\.mjs(?:\\s|$)`, "i").test(command || "")
    && new RegExp(`(?:^|\\s)--port=${escapedPort}(?:\\s|$)`).test(command || "");
}

async function listeningPids(port, runCommand) {
  try {
    const output = await runCommand("/usr/sbin/lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return String(output).split(/\s+/).filter((value) => /^\d+$/.test(value)).map(Number);
  } catch { return []; }
}

export async function stopVerifiedStaleHelper(port, advertisedPid, { runCommand = run, kill = process.kill } = {}) {
  const candidates = Number.isInteger(advertisedPid) && advertisedPid > 1 ? [advertisedPid] : await listeningPids(port, runCommand);
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
