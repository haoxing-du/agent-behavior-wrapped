const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function elapsedLabel(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function createCliProgress({
  output = process.stdout,
  now = Date.now,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  intervalMs = 80,
} = {}) {
  const interactive = Boolean(output.isTTY);
  let timer = null;
  let frame = 0;
  let label = "";
  let detail = "";
  let startedAt = 0;
  let separateDetail = false;

  function line(symbol) {
    const extra = detail ? ` · ${detail}` : "";
    return `${symbol}  ${label}${extra} · ${elapsedLabel(now() - startedAt)}`;
  }

  function render() {
    if (!timer) return;
    clearLine();
    output.write(separateDetail
      ? `${spinnerFrames[frame++ % spinnerFrames.length]}  ${detail}`
      : line(spinnerFrames[frame++ % spinnerFrames.length]));
  }

  function clearLine() {
    if (typeof output.clearLine === "function" && typeof output.cursorTo === "function") {
      output.clearLine(0);
      output.cursorTo(0);
      return;
    }
    output.write("\r\x1b[2K");
  }

  function stopTimer() {
    if (!timer) return;
    clearIntervalImpl(timer);
    timer = null;
  }

  return {
    start(nextLabel, nextDetail = "", options = {}) {
      stopTimer();
      label = nextLabel;
      detail = nextDetail;
      separateDetail = Boolean(options.separateDetail && detail);
      startedAt = now();
      frame = 0;
      if (!interactive) {
        output.write(separateDetail ? `◇  ${label}\n◇  ${detail}\n` : `◇  ${label}${detail ? ` · ${detail}` : ""}\n`);
        return;
      }
      if (separateDetail) output.write(`◇  ${label}\n`);
      timer = setIntervalImpl(render, intervalMs);
      timer?.unref?.();
      render();
    },
    update(nextDetail, nextLabel) {
      if (nextLabel) label = nextLabel;
      detail = nextDetail || "";
      if (interactive) render();
    },
    succeed(summary = label) {
      const elapsed = elapsedLabel(now() - startedAt);
      stopTimer();
      if (interactive) clearLine();
      output.write(`✓  ${summary} · ${elapsed}\n`);
    },
    stop() {
      stopTimer();
      if (interactive) clearLine();
    },
  };
}

export { elapsedLabel };
