# Research donations

Research donation is optional and separate from creating or publishing a Wrapped report. No donation data is transmitted until the user selects a mode, reviews the resulting material, checks the final research-consent box, and presses **Donate**.

Classifier feedback uses this same donation tier. From a private yelling or thanking occurrence, the review is locked to the single source session and includes a corrected label plus an optional explanation. The purpose-specific consent states that the reviewed session will be used for research and to evaluate and improve Behavior Wrapped. Opening the review or marking a correction does not itself transmit data.

The localhost helper can construct a standard-redacted preview, a customizable redaction review, or a deliberately unredacted copy. Detailed modes let users exclude whole sessions, edit or redact text, and keep timestamps off by default. Every message in an included session is preserved in its original sequence, and the localhost submission endpoint rejects incomplete transcripts. The unredacted path shows every included line and requires a separate warning and explicit acknowledgement that credentials and private details may be transmitted.

Donation discovery, default redaction, preview, exclusions, editing, schema validation, compression, and authenticated AES-256-GCM encryption happen on localhost. Compression is applied before encryption so substantial reviewed transcripts can be transmitted without weakening confidentiality. Each donation receives a fresh content key, wrapped with a rotation-versioned RSA-OAEP public key. The private key is absent from the npm package, Worker, D1, and R2.

The receiving Worker accepts only encrypted protocol-2 envelopes. A private R2 bucket stores ciphertext, separating general donations and classifier-feedback donations by object prefix while applying the same access controls. A separate D1 database stores pseudonymous consent, size, count, encryption-key, and object-location metadata—never transcript text or classifier corrections. No automatic retention policy is currently configured. A locally retained deletion receipt lets the donor delete both records.

## Maintainer operations

The research private key is deliberately outside the repository at `~/.config/behavior-wrapped/keys/research-donation-rsa-2026-08.pem`. On the maintainer Mac, its passphrase is held in Keychain under `behavior-wrapped-research-key-2026-08`. Back up the key and passphrase through separate secure channels before accepting real donations.

After downloading an encrypted R2 object, decrypt it into a new private file:

```bash
npm run research:decrypt -- encrypted-envelope.json private-donation.json
```

Never upload decrypted output to R2 or commit it. Research transcript ciphertext uses the private `behavior-wrapped-research-donations` R2 bucket. Consent and lifecycle metadata use the separate `behavior-wrapped-research-metadata` D1 database initialized by `migrations/research/0001_encrypted_donations.sql`.
