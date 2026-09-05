import { WorkerEntrypoint } from "cloudflare:workers";
import { donationAcceptedNotification, sendZulipNotification } from "./phrase-judge-worker.mjs";
export { default } from "./phrase-judge-worker.mjs";

// Only callable through an explicit Cloudflare service binding. No public route.
export class DonationNotifications extends WorkerEntrypoint {
  async notifyDonation(metadata) {
    return sendZulipNotification(this.env, "data donations", `${donationAcceptedNotification({ metadata })}\n- Collector: **Share with Susan Calvin**`);
  }
}
