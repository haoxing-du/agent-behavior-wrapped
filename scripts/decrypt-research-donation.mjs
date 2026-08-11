#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { decryptResearchDonation } from "../server/research-donation-crypto.mjs";

const [, , inputArg, outputArg, keyArg] = process.argv;
if (!inputArg || !outputArg) {
  console.error("Usage: node scripts/decrypt-research-donation.mjs <encrypted-envelope.json> <private-output.json> [private-key.pem]");
  process.exit(1);
}

const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
const privateKeyPath = path.resolve(keyArg || path.join(os.homedir(), ".config", "behavior-wrapped", "keys", "research-donation-rsa-2026-08.pem"));
const passphrase = process.env.BEHAVIOR_WRAPPED_DONATION_KEY_PASSPHRASE || (process.platform === "darwin"
  ? execFileSync("security", ["find-generic-password", "-a", os.userInfo().username, "-s", "behavior-wrapped-research-key-2026-08", "-w"], { encoding: "utf8" }).trim()
  : "");

if (!passphrase) throw new Error("Set BEHAVIOR_WRAPPED_DONATION_KEY_PASSPHRASE before decrypting.");
const envelope = JSON.parse(fs.readFileSync(input, "utf8"));
const donation = decryptResearchDonation(envelope, fs.readFileSync(privateKeyPath, "utf8"), passphrase);
fs.writeFileSync(output, `${JSON.stringify(donation, null, 2)}\n`, { mode: 0o600, flag: "wx" });
console.log(`Decrypted donation written with private permissions: ${output}`);
