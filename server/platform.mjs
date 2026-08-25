import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export function canonicalSessionRoots({ home = os.homedir(), platform = process.platform } = {}) {
  return {
    claudeRoot: path.join(home, ".claude", "projects"),
    codexRoots: [path.join(home, ".codex", "sessions"), path.join(home, ".codex", "archived_sessions")],
    coworkRoot: platform === "darwin" ? path.join(home, "Library", "Application Support", "Claude", "local-agent-mode-sessions") : null,
  };
}

export function canonicalSessionDirectoryLabels(platform = process.platform) {
  return [
    "~/.claude/projects",
    ...(platform === "darwin" ? ["~/Library/Application Support/Claude/local-agent-mode-sessions"] : []),
    "~/.codex/sessions",
    "~/.codex/archived_sessions",
  ];
}

export function supportedAgentNames(platform = process.platform, { includeCowork = platform === "darwin" } = {}) {
  return ["Claude Code", ...(includeCowork ? ["Cowork"] : []), "Codex"];
}

export function browserOpenCommand(url, platform = process.platform) {
  if (platform === "darwin") return { file: "open", args: [url] };
  if (platform === "linux") return { file: "xdg-open", args: [url] };
  return null;
}

export function openExternalUrl(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  const command = browserOpenCommand(url, platform);
  if (!command) return false;
  const child = spawnImpl(command.file, command.args, { detached: true, stdio: "ignore" });
  child.on?.("error", () => {});
  child.unref?.();
  return true;
}
