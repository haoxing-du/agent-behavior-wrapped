export const BEHAVIOR_WRAPPED_ORIGIN = "https://behaviorwrapped.com";
export const BEHAVIOR_WRAPPED_HOST = "behaviorwrapped.com";
export const BEHAVIOR_WRAPPED_WWW_HOST = "www.behaviorwrapped.com";
export const LEGACY_BEHAVIOR_WRAPPED_ORIGIN = "https://agent-behavior-wrapped-judge.haoxingdu.workers.dev";
export const LEGACY_BEHAVIOR_WRAPPED_HOST = "agent-behavior-wrapped-judge.haoxingdu.workers.dev";

export function canonicalBehaviorWrappedUrl(value) {
  if (typeof value !== "string" || !value) return value;
  try {
    const url = new URL(value);
    if (url.hostname !== LEGACY_BEHAVIOR_WRAPPED_HOST && url.hostname !== BEHAVIOR_WRAPPED_WWW_HOST) return value;
    url.protocol = "https:";
    url.host = BEHAVIOR_WRAPPED_HOST;
    return url.toString();
  } catch {
    return value;
  }
}
