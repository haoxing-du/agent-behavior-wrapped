export function displayModelName(value) {
  const raw = String(value || "Unknown model");
  if (raw === "<synthetic>") return "Synthetic model";
  const claude = raw.match(/^claude-([a-z]+)-(\d+)-(\d+)$/i);
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1).toLowerCase()} ${claude[2]}.${claude[3]}`;
  const gpt = raw.match(/^gpt-(\d+)[.-](\d+)(?:-([a-z]+))?$/i);
  if (gpt) return `GPT-${gpt[1]}.${gpt[2]}${gpt[3] ? ` ${gpt[3][0].toUpperCase()}${gpt[3].slice(1).toLowerCase()}` : ""}`;
  return raw
    .replace(/^claude-/i, "Claude ")
    .replace(/^gpt-/i, "GPT-")
    .replace(/-(\d+)-(\d+)(?=$|-)/g, "$1.$2")
    .replace(/-/g, " ")
    .replace(/\b[a-z]+\b/gi, (word) => word.toLowerCase() === "gpt" ? "GPT" : word[0].toUpperCase() + word.slice(1).toLowerCase());
}
