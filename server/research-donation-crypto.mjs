import crypto from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { DONATION_CONSENT_VERSION, DONATION_CONTENT_ENCODING, DONATION_ENCRYPTION_ALGORITHM, DONATION_ENVELOPE_FORMAT, DONATION_KEY_ID, MAX_COMPRESSED_DONATION_BYTES, encryptedDonationAAD, sanitizeEncryptedDonationEnvelope } from "./encrypted-donation-schema.mjs";
import { MAX_DONATION_BYTES, researchDonationByteLength, sanitizeResearchDonation } from "./research-donation-schema.mjs";

export const RESEARCH_DONATION_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA0RaXFQBixAmtwKRz2I7Y
pq0TlQPAZ72gHbyV2RJ9dRiDNwlwaKbHHVLYHG0QjxFanktNi/ms6NoV9slBQhjJ
Rb3kMzg5xEJYYy8TzyQKpY28f5/srGpSL2ziWRb9TSsgrOJPNk9LFPKLuJhty1+x
Gh9+I3UW+JPj+To4VY7GVU46jptP2MDtROK5v/p9PLP+QoKhjTBuDqgu5T78wTv5
/C34ZZD4ACIKvIQ8dtAZM6CPY0sWWVN84VO5etr1rYZg7DWczy2ZsX2StiKmuZ8b
kSqZr/mn6+PC5sthPCt0B+Tk1pxPv6LuwiNYubst4EKQDpFbP2e4h3KIaNxTnVRx
AHzd9XfF9rN86+Cjf55YlBuT9GeYXLttGBfoT6Llr4Xw370WIHabo7A57/atLOgw
YKX6TcNe6TOHuCTHM7LDmTPGNZdMi9cXXBUzohvTxm7O8qduIekFg4emxIiduVY2
3pHhzoP9p0kwO+L0BE1ELIHF9dk0p3s/NDIDfbiDxn5XAgMBAAE=
-----END PUBLIC KEY-----`;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

export function encryptResearchDonation(value, publicKey = RESEARCH_DONATION_PUBLIC_KEY, { compress = true } = {}) {
  const donationBytes = researchDonationByteLength(value);
  if (donationBytes !== null && donationBytes > MAX_DONATION_BYTES) throw new Error("The reviewed donation is larger than 20 MB. Choose Advanced mode and select fewer sessions.");
  const donation = sanitizeResearchDonation(value);
  if (!donation) throw new Error("The reviewed donation does not match the research schema.");
  const plaintext = Buffer.from(JSON.stringify(donation));
  const encryptedPlaintext = compress ? gzipSync(plaintext) : plaintext;
  if (compress && encryptedPlaintext.byteLength > MAX_COMPRESSED_DONATION_BYTES) throw new Error("The reviewed donation is still too large after compression. Choose Advanced mode and select fewer sessions.");
  const contentKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const envelope = {
    format: DONATION_ENVELOPE_FORMAT,
    encryption: { algorithm: DONATION_ENCRYPTION_ALGORITHM, keyId: DONATION_KEY_ID },
    metadata: {
      reportId: donation.reportId,
      purpose: donation.purpose,
      redactionMode: donation.redactionMode,
      createdAt: donation.createdAt,
      consentedAt: donation.consent.consentedAt,
      consentVersion: DONATION_CONSENT_VERSION,
      unredactedData: donation.redactionMode === "unredacted",
      automatedDetections: donation.redactionSummary.automatedDetections,
      sessions: donation.redactionSummary.sessions,
      messages: donation.redactionSummary.messages,
      ...(compress ? { contentEncoding: DONATION_CONTENT_ENCODING } : {}),
    },
  };
  const cipher = crypto.createCipheriv("aes-256-gcm", contentKey, iv);
  cipher.setAAD(Buffer.from(encryptedDonationAAD(envelope)));
  const ciphertext = Buffer.concat([cipher.update(encryptedPlaintext), cipher.final()]);
  return sanitizeEncryptedDonationEnvelope({
    ...envelope,
    encryption: {
      ...envelope.encryption,
      wrappedKey: base64url(crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, contentKey)),
      iv: base64url(iv),
      authTag: base64url(cipher.getAuthTag()),
    },
    ciphertext: base64url(ciphertext),
  });
}

export function decryptResearchDonation(value, privateKey, passphrase) {
  const envelope = sanitizeEncryptedDonationEnvelope(value);
  if (!envelope) throw new Error("The encrypted donation envelope is invalid.");
  const contentKey = crypto.privateDecrypt({ key: privateKey, passphrase, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(envelope.encryption.wrappedKey, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", contentKey, Buffer.from(envelope.encryption.iv, "base64url"));
  decipher.setAAD(Buffer.from(encryptedDonationAAD(envelope)));
  decipher.setAuthTag(Buffer.from(envelope.encryption.authTag, "base64url"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]);
  const plaintext = envelope.metadata.contentEncoding === DONATION_CONTENT_ENCODING
    ? gunzipSync(decrypted, { maxOutputLength: MAX_DONATION_BYTES + 1 })
    : decrypted;
  const donation = sanitizeResearchDonation(JSON.parse(plaintext.toString("utf8")));
  if (!donation) throw new Error("The decrypted donation is invalid.");
  return donation;
}
