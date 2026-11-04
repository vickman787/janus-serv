# Threat model

- Wallet connection is not authentication. Server verifies a bound personal-message
  signature, atomically consumes the nonce and issues a hashed opaque session token.
- POST origins and allowed Hosts are checked. Cookies use HttpOnly/SameSite Strict;
  Secure is added for configured HTTPS deployments. Body sizes/rate limits apply.
- Server derives actors from sessions, validates request schemas and supported
  object types, and checks roles again onchain. Clients cannot choose trusted
  packages, memory accounts or arbitrary funded backend signing tools.
- Checkpoints are signed by a dedicated app Ed25519 writer, hash-linked and checked
  against the latest discovery pointer. A hash chain alone is not authentication.
- The writer key and SQLite database must be backed up/protected. Keep them together
  across restarts. A new installation cannot safely enable writes from a potentially
  stale imported reference alone; such imports are inspection-only.
- Managed Walrus relayer sees plaintext before encryption. Namespaces organize
  records; they are not user authentication. The app's delegate can access its whole
  memory account, so only the server holds it and enforces participant permissions.
- Public operations expose their intent and participants only after explicit opt-in.
  Private preferences are scoped to the approving wallet and latest nonrevoked
  revision. Learned presentation choices never change authorization or expiry.
- Unsigned prepared bytes remain in the restricted local outbox. Signed payloads
  are not retained or automatically replayed. Ambiguous outcomes block new bytes.
- This build uses SQLite on one durable host. Do not mount separate database copies
  across independent app instances. Use one shared durable store or migrate to a
  proper transactional multi-host database before horizontally scaling.
- Production account recovery, monitoring, backup policy and hosting security need
  deployment-specific verification. Automated tests are not an independent audit.
