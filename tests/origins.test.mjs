import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FRUSTRATION_JUDGE_RELAY_URL } from "../server/frustration-card.mjs";
import { WORKAROUND_RELAY_URL } from "../server/instrumental-workarounds.mjs";
import { INTERACTION_TONE_RELAY_URL } from "../server/interaction-tone.mjs";
import { LEADERBOARD_RELAY_ORIGIN } from "../server/leaderboard.mjs";
import { BEHAVIOR_WRAPPED_ORIGIN, canonicalBehaviorWrappedUrl } from "../server/origins.mjs";
import { PHRASE_JUDGE_RELAY_URL } from "../server/phrase-card.mjs";
import { PUBLIC_REPORT_ORIGIN } from "../server/public-report.mjs";
import { RESEARCH_DONATION_URL } from "../server/research-donation.mjs";
import { SESSION_TOPIC_RELAY_URL } from "../server/session-topics.mjs";

test("all public and relay URLs use behaviorwrapped.com", () => {
  assert.equal(BEHAVIOR_WRAPPED_ORIGIN, "https://behaviorwrapped.com");
  assert.equal(PUBLIC_REPORT_ORIGIN, BEHAVIOR_WRAPPED_ORIGIN);
  assert.equal(LEADERBOARD_RELAY_ORIGIN, BEHAVIOR_WRAPPED_ORIGIN);
  for (const url of [
    PHRASE_JUDGE_RELAY_URL,
    FRUSTRATION_JUDGE_RELAY_URL,
    INTERACTION_TONE_RELAY_URL,
    SESSION_TOPIC_RELAY_URL,
    WORKAROUND_RELAY_URL,
    RESEARCH_DONATION_URL,
  ]) assert.equal(new URL(url).origin, BEHAVIOR_WRAPPED_ORIGIN);
});

test("saved legacy and www URLs are presented on the canonical domain", () => {
  assert.equal(
    canonicalBehaviorWrappedUrl("https://agent-behavior-wrapped-judge.haoxingdu.workers.dev/w/shareSafe1234#manage=secret"),
    "https://behaviorwrapped.com/w/shareSafe1234#manage=secret",
  );
  assert.equal(
    canonicalBehaviorWrappedUrl("https://www.behaviorwrapped.com/leaderboard/shareSafe1234"),
    "https://behaviorwrapped.com/leaderboard/shareSafe1234",
  );
  assert.equal(canonicalBehaviorWrappedUrl("https://example.com/w/shareSafe1234"), "https://example.com/w/shareSafe1234");
});

test("Cloudflare routes both domain forms through the Worker", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.routes, [
    { pattern: "behaviorwrapped.com", custom_domain: true },
    { pattern: "www.behaviorwrapped.com", custom_domain: true },
  ]);
  assert.equal(config.workers_dev, true);
  assert.equal(config.assets.run_worker_first.includes("/"), true);
  assert.equal(config.assets.run_worker_first.includes("/data-policy"), true);
  assert.equal(config.assets.run_worker_first.includes("/w/*"), true);
  assert.equal(config.assets.run_worker_first.includes("/leaderboard"), true);
});
