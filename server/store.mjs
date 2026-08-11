import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const storeRoot = process.env.BEHAVIOR_WRAPPED_STORE_ROOT || path.join(os.homedir(), ".agent-behavior-wrapped");
export const reportsRoot = path.join(storeRoot, "reports");
export const donationReceiptsRoot = path.join(storeRoot, "donation-receipts");
const clientIdFile = path.join(storeRoot, "client-id");

function ensureStore() {
  fs.mkdirSync(reportsRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(donationReceiptsRoot, { recursive: true, mode: 0o700 });
}

export function saveDonationReceipt(value) {
  if (!/^[0-9a-f-]{36}$/.test(value?.donation_id || "") || !/^[A-Za-z0-9_-]{43}$/.test(value?.deletion_token || "")) throw new Error("The donation service returned an invalid deletion receipt.");
  ensureStore();
  const receipt = { donationId: value.donation_id, deletionToken: value.deletion_token, retentionDays: value.retention_days, savedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(donationReceiptsRoot, `${receipt.donationId}.json`), `${JSON.stringify(receipt)}\n`, { mode: 0o600, flag: "wx" });
  return receipt;
}

export function loadDonationReceipt(id) {
  if (!/^[0-9a-f-]{36}$/.test(id || "")) return null;
  try { return JSON.parse(fs.readFileSync(path.join(donationReceiptsRoot, `${id}.json`), "utf8")); }
  catch { return null; }
}

export function deleteDonationReceipt(id) {
  if (!/^[0-9a-f-]{36}$/.test(id || "")) return false;
  const file = path.join(donationReceiptsRoot, `${id}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function createReportId() {
  return crypto.randomBytes(12).toString("base64url");
}

export function getOrCreateClientId() {
  ensureStore();
  if (fs.existsSync(clientIdFile)) {
    const existing = fs.readFileSync(clientIdFile, "utf8").trim();
    if (/^[a-f0-9]{32}$/.test(existing)) return existing;
  }
  const clientId = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(clientIdFile, `${clientId}\n`, { mode: 0o600 });
  return clientId;
}

export function saveReport(report) {
  ensureStore();
  const file = path.join(reportsRoot, `${report.id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return file;
}

export function loadReport(id) {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) return null;
  const file = path.join(reportsRoot, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

export function listReports() {
  ensureStore();
  return fs.readdirSync(reportsRoot).filter((name) => name.endsWith(".json")).flatMap((name) => {
    const report = loadReport(name.slice(0, -5));
    return report ? [report] : [];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteReport(id) {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) return false;
  const file = path.join(reportsRoot, `${id}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
