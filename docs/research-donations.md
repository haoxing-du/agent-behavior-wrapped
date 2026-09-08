# Research donations

Behavior Wrapped launches **Share with Susan Calvin** for optional donation. Ordinary sharing opens the standalone app's normal recent-session picker; the report and its selection are not transferred. Susan owns discovery, review, redaction, consent, encryption, uploads and deletion receipts. Nothing is donated until consent is given inside Susan.

From a private yelling or thanking occurrence, **Correct with Susan Calvin** opens the original session only. Wrapped resolves the classification locally and passes the source reference and original judge context through process IPC. Susan collects and reviews the correction and optional explanation, applies the selected redactions, and requires consent for research and evaluating and improving Wrapped. No report ID, source path or local session ID enters the donation. A missing source produces an error rather than substituting a different session.

The local `/donate/:reportId` route is a compatibility bridge. It starts an independent Susan process on an available loopback port; Wrapped's evidence helper can expire without stopping review. Old report links and private evidence links retain their existing structure. A stopped helper can be restarted with `npx behavior-wrapped@latest open <report-id>`. Ordinary donations can also start directly with `npx share-with-susan-calvin@latest`.

New donations use Susan's streamed encrypted receiver and grouped deletion receipts. Old uploads to `/v1/research-donations` return an upgrade instruction. Old deletion URLs continue forwarding to Susan, which owns the legacy storage bindings. Existing ciphertext and metadata remain in their original resources. `npx share-with-susan-calvin@latest list` finds receipts from both apps; its `delete` command dispatches by receipt origin and preserves credentials on failure.

## Maintainer operations

The research private key is deliberately outside the repository at `~/.config/behavior-wrapped/keys/research-donation-rsa-2026-08.pem`. On the maintainer Mac, its passphrase is held in Keychain under `behavior-wrapped-research-key-2026-08`. Back up the key and passphrase through separate secure channels before accepting real donations.

After downloading an encrypted R2 object, decrypt it into a new private file:

```bash
npm run research:decrypt -- encrypted-envelope.json private-donation.json
```

Never upload decrypted output to R2 or commit it. Research transcript ciphertext uses the private `behavior-wrapped-research-donations` R2 bucket. Consent and lifecycle metadata use the separate `behavior-wrapped-research-metadata` D1 database initialized by `migrations/research/0001_encrypted_donations.sql`.
