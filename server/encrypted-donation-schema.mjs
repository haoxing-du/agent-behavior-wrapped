export const DONATION_ENVELOPE_FORMAT = "behavior-wrapped-encrypted-donation-v1";
export const DONATION_ENCRYPTION_ALGORITHM = "RSA-OAEP-256+A256GCM";
export const DONATION_KEY_ID = "research-donation-rsa-2026-08";
export const DONATION_CONSENT_VERSION = 2;
export const DONATION_CONTENT_ENCODING = "gzip";
export const MAX_COMPRESSED_DONATION_BYTES = 8_000_000;
export const MAX_ENCRYPTED_DONATION_BYTES = Math.ceil(MAX_COMPRESSED_DONATION_BYTES / 3) * 4 + 10_000;
const MAX_LEGACY_DONATION_BYTES = 1_800_000;

const base64url = /^[A-Za-z0-9_-]+$/;
const timestamp = /^\d{4}-\d{2}-\d{2}T/;

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}

function boundedInteger(value, maximum) {
  return Number.isInteger(value) && value >= 0 && value <= maximum;
}

export function encryptedDonationAAD(envelope) {
  return JSON.stringify({
    format: envelope.format,
    encryption: { algorithm: envelope.encryption.algorithm, keyId: envelope.encryption.keyId },
    metadata: envelope.metadata,
  });
}

export function sanitizeEncryptedDonationEnvelope(value) {
  if (!exactKeys(value, ["ciphertext", "encryption", "format", "metadata"])) return null;
  if (value.format !== DONATION_ENVELOPE_FORMAT) return null;
  if (!exactKeys(value.encryption, ["algorithm", "authTag", "iv", "keyId", "wrappedKey"])) return null;
  if (value.encryption.algorithm !== DONATION_ENCRYPTION_ALGORITHM || value.encryption.keyId !== DONATION_KEY_ID) return null;
  if (typeof value.encryption.wrappedKey !== "string" || value.encryption.wrappedKey.length < 480 || value.encryption.wrappedKey.length > 700 || !base64url.test(value.encryption.wrappedKey)) return null;
  if (typeof value.encryption.iv !== "string" || value.encryption.iv.length !== 16 || !base64url.test(value.encryption.iv)) return null;
  if (typeof value.encryption.authTag !== "string" || value.encryption.authTag.length !== 22 || !base64url.test(value.encryption.authTag)) return null;
  if (typeof value.ciphertext !== "string" || !value.ciphertext.length || !base64url.test(value.ciphertext)) return null;
  const baseMetadataKeys = ["automatedDetections", "consentVersion", "consentedAt", "createdAt", "messages", "redactionMode", "reportId", "sessions", "unredactedData"];
  const compressed = exactKeys(value.metadata, [...baseMetadataKeys, "contentEncoding"]);
  if (!compressed && !exactKeys(value.metadata, baseMetadataKeys)) return null;
  const metadata = value.metadata;
  if (compressed && metadata.contentEncoding !== DONATION_CONTENT_ENCODING) return null;
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(metadata.reportId || "")) return null;
  if (!new Set(["standard", "custom", "unredacted"]).has(metadata.redactionMode)) return null;
  if (!timestamp.test(metadata.createdAt || "") || !timestamp.test(metadata.consentedAt || "")) return null;
  if (!new Set([1, DONATION_CONSENT_VERSION]).has(metadata.consentVersion) || typeof metadata.unredactedData !== "boolean" || metadata.unredactedData !== (metadata.redactionMode === "unredacted")) return null;
  if (!boundedInteger(metadata.automatedDetections, 1_000_000) || !boundedInteger(metadata.sessions, 250) || metadata.sessions < 1 || !boundedInteger(metadata.messages, 50_000) || metadata.messages < 1) return null;
  const maximumCiphertextBytes = compressed ? MAX_COMPRESSED_DONATION_BYTES : MAX_LEGACY_DONATION_BYTES;
  if (value.ciphertext.length > Math.ceil(maximumCiphertextBytes / 3) * 4) return null;
  return value;
}
