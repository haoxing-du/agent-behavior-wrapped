import assert from "node:assert/strict";
import test from "node:test";
import { donationAcceptedNotification, sendZulipNotification, wrappedCreatedNotification } from "../worker/phrase-judge-worker.mjs";

const environment = {
  ZULIP_SITE: "https://susancalvin.zulipchat.com",
  ZULIP_BOT_EMAIL: "behavior-wrapped-monitor-bot@susancalvin.zulipchat.com",
  ZULIP_BOT_API_KEY: "test-key",
  ZULIP_CHANNEL: "bots",
};

test("sends a notification to the configured Zulip channel and topic", async () => {
  let transmitted;
  const result = await sendZulipNotification(environment, "app usage", "A Wrapped was created.", async (url, init) => {
    transmitted = { url, init };
    return new Response(JSON.stringify({ result: "success", id: 42 }), { status: 200 });
  });
  assert.deepEqual(result, { sent: true });
  assert.equal(transmitted.url, "https://susancalvin.zulipchat.com/api/v1/messages");
  assert.match(transmitted.init.headers.authorization, /^Basic /);
  const body = new URLSearchParams(transmitted.init.body);
  assert.equal(body.get("type"), "stream");
  assert.equal(body.get("to"), "bots");
  assert.equal(body.get("topic"), "app usage");
  assert.equal(body.get("content"), "A Wrapped was created.");
});

test("does nothing when the Zulip secret is not configured", async () => {
  let called = false;
  const result = await sendZulipNotification({ ...environment, ZULIP_BOT_API_KEY: undefined }, "app usage", "test", async () => { called = true; });
  assert.deepEqual(result, { sent: false, reason: "not_configured" });
  assert.equal(called, false);
});

test("notification content contains only safe aggregate metadata", () => {
  const wrapped = wrappedCreatedNotification({ id: "private-report-id", stats: { sessions: 12, activeDays: 5 }, evidence: "private transcript" });
  const donation = donationAcceptedNotification({
    ciphertext: "private-ciphertext",
    metadata: { reportId: "private-report-id", sessions: 9, messages: 321, automatedDetections: 17, redactionMode: "standard" },
  });
  assert.match(wrapped, /12/);
  assert.match(donation, /321/);
  assert.equal(`${wrapped}${donation}`.includes("private"), false);
});
