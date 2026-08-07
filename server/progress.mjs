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

  function line(symbol) {
    const extra = detail ? ` · ${detail}` : "";
    return `${symbol}  ${label}${extra} · ${elapsedLabel(now() - startedAt)}`;
  }

  function render() {
    if (!timer) return;
    output.write(`\r\x1b[2K${line(spinnerFrames[frame++ % spinnerFrames.length])}`);
  }

  function stopTimer() {
    if (!timer) return;
    clearIntervalImpl(timer);
    timer = null;
  }

  return {
    start(nextLabel, nextDetail = "") {
      stopTimer();
      label = nextLabel;
      detail = nextDetail;
      startedAt = now();
      frame = 0;
      if (!interactive) {
        output.write(`◇  ${label}${detail ? ` · ${detail}` : ""}\n`);
        return;
      }
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
      output.write(interactive ? `\r\x1b[2K✓  ${summary} · ${elapsed}\n` : `✓  ${summary} · ${elapsed}\n`);
    },
    stop() {
      stopTimer();
      if (interactive) output.write("\r\x1b[2K");
    },
  };
}

export { elapsedLabel };
