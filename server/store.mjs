import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const storeRoot = process.env.BEHAVIOR_WRAPPED_STORE_ROOT || path.join(os.homedir(), ".agent-behavior-wrapped");
export const reportsRoot = path.join(storeRoot, "reports");

function ensureStore() {
  fs.mkdirSync(reportsRoot, { recursive: true, mode: 0o700 });
}

export function createReportId() {
  return crypto.randomBytes(12).toString("base64url");
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
