export const semanticActions = new Set([
  "confirm", "copy", "delete", "download", "edit", "hide", "install", "link", "list", "mount", "move", "read", "search", "write",
]);

export const semanticMethods = new Set([
  "builtin_read", "builtin_write", "container", "disk_image", "file_edit", "filesystem", "network", "package_manager", "script", "shell", "unknown", "version_control",
]);

function parsedArguments(value) {
  if (typeof value !== "string") return value && typeof value === "object" ? value : {};
  try { return JSON.parse(value); } catch { return {}; }
}

function commandText(argumentsValue, inputValue) {
  const parsed = parsedArguments(argumentsValue);
  if (typeof parsed?.cmd === "string") return parsed.cmd;
  if (typeof parsed?.command === "string") return parsed.command;
  if (typeof inputValue === "string") return inputValue;
  if (inputValue && typeof inputValue === "object") {
    if (typeof inputValue.cmd === "string") return inputValue.cmd;
    if (typeof inputValue.command === "string") return inputValue.command;
  }
  return "";
}

function commandSemantics(command) {
  const normalized = String(command || "").replace(/\\[nrt]/gi, " ");
  const lower = normalized.toLowerCase();
  if (!lower) return { action: null, method: "unknown" };
  if (/(?:printf|echo)[^\n|]{0,80}(?:yes|y\\n|['\"]y['\"])[^\n]{0,80}\|/i.test(normalized)) return { action: "confirm", method: "shell" };
  if (/\b(?:tools\.)?apply_patch\s*\(/i.test(normalized)) return { action: /\.gitignore\b/i.test(normalized) ? "hide" : "edit", method: "file_edit" };
  if (/\b(?:fs\.)?(?:rename|renamesync)\s*\(/i.test(normalized)) return { action: "move", method: "script" };
  if (/\brm\b/i.test(normalized)) return { action: "delete", method: "shell" };
  if (/\bmv\b/i.test(normalized)) return { action: "move", method: "shell" };
  if (/\b(?:cp|ditto)\b/i.test(normalized)) return { action: "copy", method: "shell" };
  if (/\btrash\b/i.test(normalized)) return { action: "delete", method: "filesystem" };
  if (/\bbrew\s+install\b|\b(?:npm|pnpm|yarn|pip3?|python3?\s+-m\s+pip)\s+install\b|\binstall\s+-[a-z]/i.test(normalized)) return { action: "install", method: "package_manager" };
  if (/\bbrew\s+fetch\b|\b(?:curl|wget)\b/i.test(normalized)) return { action: "download", method: /\bbrew\b/i.test(normalized) ? "package_manager" : "network" };
  if (/\bhdiutil\s+attach\b/i.test(normalized)) return { action: "mount", method: "disk_image" };
  if (/\bln\b/i.test(normalized)) return { action: "link", method: "filesystem" };
  if (/\b(?:sed|awk)\s+-i\b/i.test(normalized)) return { action: "edit", method: "shell" };
  if (/\b(?:cat|head|tail)\b/i.test(normalized)) return { action: "read", method: "shell" };
  if (/\b(?:rg|grep|find)\b/i.test(normalized)) return { action: "search", method: "shell" };
  if (/\bls\b/i.test(normalized)) return { action: "list", method: "shell" };
  if (/\bdocker\b/i.test(normalized)) return { action: null, method: "container" };
  if (/\bgit\b/i.test(normalized)) return { action: null, method: "version_control" };
  if (/\b(?:node|python3?)\b/i.test(normalized)) return { action: null, method: "script" };
  return { action: null, method: "shell" };
}

export function semanticToolUse({ name, argumentsValue, inputValue, actionHint, methodHint } = {}) {
  if ((actionHint === null || semanticActions.has(actionHint)) && semanticMethods.has(methodHint)) return { action: actionHint, method: methodHint };
  const toolName = String(name || "").toLowerCase();
  if (/^(?:read|read_file)$/.test(toolName)) return { action: "read", method: "builtin_read" };
  if (/^(?:write|write_file)$/.test(toolName)) return { action: "write", method: "builtin_write" };
  if (/^(?:edit|apply_patch|multiedit)$/.test(toolName)) {
    const command = commandText(argumentsValue, inputValue);
    return { action: /\.gitignore\b/i.test(command) ? "hide" : "edit", method: "file_edit" };
  }
  return commandSemantics(commandText(argumentsValue, inputValue));
}
