# Integration spike — current evidence

Date: 28 October 2026. This is an incomplete Phase A build, not a deployed application.

## Verified locally

- Pinned original source checked out separately under ignored `.reference/janus`.
- MIT license retained; all nine original SVG brand assets copied unchanged.
- Official packages installed with a lockfile: Sui 2.38.0, dApp Kit React 2.1.43,
  Walrus Memory 0.1.11. The installed declarations are checked by TypeScript.
- Native HTTP/2 gRPC adapter uses the Sui SDK generated services plus
  `@protobuf-ts/grpc-transport`, TLS and Tatum `x-api-key` metadata.
- Local domain tests cover stale/missing/unavailable evidence, identity/revision
  mismatches, author signatures, unresolved outcomes and preference revocation.
- Offline sign-only fixture verifies exact returned bytes, digest and signer.
  This is SDK cryptography evidence, not a real extension-wallet compatibility test.

## Observed blockers

`npm run probe` was executed without credentials. Both Tatum and Walrus checks
returned `blocked` with configuration validation errors; command exited 1.
No authenticated provider success, memory write, chain transaction or Mainnet
record is claimed. The Sui CLI is not installed; no Move compilation is claimed.

## Walrus capability finding and proposed retrieval design

The installed SDK supports `remember`, asynchronous job polling, `listMemories`
(metadata), `recall` (decrypted semantic candidates), and `restore` (index repair).
It exposes no exact-record content getter. Do not invent one.

Proposed spike: each immutable checkpoint gets a unique, single-record namespace.
A recovery reference carries memory account/network, namespace, exact blob ID,
record ID and content hash. `retrieveCandidate` accepts only that blob ID; the
caller then verifies hash, writer signature, operation identity and latest
sequence from the trusted index. Search rank never chooses the current revision.
An empty or mismatched search is **unavailable**, never confirmed deletion.
This is candidate retrieval with exact identity validation, not guaranteed KV
lookup. The architecture gate stays open until real fresh-process tests prove
retrieval, namespace isolation, retention and latency. If the gate fails, evaluate
supported manual Seal decryption by blob ID or a supported relayer extension.
Do not silently substitute local JSON for Walrus context.

The write probe creates only a disposable integration record, not an operation.
A successful write job alone is insufficient: verify retrieval before allowing
broadcast. The separate restore script reads the reference, not a payload cache.
Production checkpoints additionally require an independently provisioned trusted
writer public key and an authenticated latest-sequence pointer.

## Trust and access

Use a dedicated app-managed account/delegate. Managed mode sends plaintext to the
relayer before encryption; it does not hide data from that relayer. App sessions
must authorize both participants before protected context is read. Namespace names
are organization, not per-user authorization: the delegate can read the whole
account. Backend ACLs and writer signatures are still required and not yet wired.
Never distribute the delegate to browsers. Preference ownership is checked on
application reads; private preference storage controls remain to be proven.

## Commands

- `npm run typecheck`
- `npm test`
- `npm run probe` — read-only; requires configured credentials.
- `npm run probe:memory-write -- --owner-approved-write` — ONLY after explicit
  approval of storage/resource spending. Creates one real memory.
- `npm run probe:memory-restore` — separate runtime with the same provisioned
  credentials and recovery reference. Never infer successful restore from files.

Do not run paid writes as health checks. If a write poll times out, inspect the
saved `.data/memory-job.json` before creating a new paid job. The probe is not a
production durable outbox or an idempotent cross-process retry implementation.

## Primary documentation inspected

- https://sdk.mystenlabs.com/dapp-kit/getting-started/react
- https://sdk.mystenlabs.com/dapp-kit/actions/sign-transaction
- https://sdk.mystenlabs.com/sui/clients/grpc
- https://docs.tatum.io/reference/sui-grpc
- https://docs.wal.app/walrus-memory/sdk/api-reference
- https://docs.wal.app/walrus-memory/relayer/api-reference
- https://docs.wal.app/walrus-memory/sdk/headless-setup

These define the integration direction; actual provider/deployment evidence is
still required. No submission or event-eligibility verification was performed.

## Final local verification for this build

- `npm run typecheck` — passed (exit 0).
- `npm test` — 45 tests passed across 3 files (exit 0).
- Copied SVGs compared by SHA-256 against the pinned original: all match.
- No Move tests, browser wallet approvals, process-crash tests, deployment checks
  or authenticated network calls have passed yet; those gates remain open.

## 29 October — live integration evidence

The credential blocker above was resolved on 29 October. `npm run probe` passed:
Tatum Testnet service identity and checkpoint 400604944 were returned, and Walrus
Mainnet authenticated metadata access succeeded. This does not imply that the
entire handover workflow is complete.

`npm run probe:memory-write -- --owner-approved-write` stored one non-sensitive
integration record through the Foundation hosted relayer (server-sponsored
storage), then retrieved it. `npm run probe:memory-restore` ran in a separate Node
process and returned the same blob with a matching SHA-256 hash at
2026-10-29T17:46:33.902Z. The sanitized manifest is
`docs/integration-memory-evidence.json`. The record is an integration probe and
is not counted as one of the ten meaningful operation/learning memories.

`npx tsx --env-file-if-exists=.env scripts/chain-evidence.ts` verified the Sui Clock
object and successful effects for transaction
`A7jRsh1FYLVJU3rtd6ERq9qPD8yXtvfj7uAep6zfAnAh` through Tatum Testnet at
2026-10-29T17:52:07.699Z, checkpoint 400607076. These are public chain reads, not
Janus handover transactions.

The local wallet integration page runs at http://localhost:4310 with its API at
http://localhost:4311. It supports durable wallet-auth challenges, sessions and a
prepared/simulated sign-only testnet self-transfer. It has no broadcast endpoint.
A human wallet approval is the next required integration gate. Production Move
execution, operation participant ACLs, actual process crash boundaries and worker
leases remain unverified.

Checks executed: TypeScript, 50 unit/auth tests, API smoke (origin rejection,
invalid address, authenticated prepare guard, actual personal-message signature,
nonce replay refusal, hashed HttpOnly sessions, logout), and 5 headless Edge UI
checks at 360/390/430/1280/1440 px. Mobile and desktop screenshots were visually
inspected. No fabricated wallet interaction is counted as browser evidence.

## 30 October — full local implementation

The owner requested the complete application before one consolidated manual test,
so the remaining real-wallet spike gates are now included in that manual pass.
The implementation now includes the Move workflow, full Janus feature pages,
authenticated wallet-approved transaction path, durable recovery engine, memory
exploration, actual approved-preference storage/amendment/revocation and container
packaging. This does not claim production deployment or real-wallet verification.

The official `testnet-v1.83.0` Windows CLI was downloaded with release-digest
verification. Sui Move compilation succeeded and 16 Move unit tests passed. The
publication artifact is included at `contracts/janus_handover/compiled/package.json`.
TypeScript typecheck/build and client secret scan passed; 63 unit/auth/recovery
tests passed, including actual subprocess deaths, simultaneous workers and a full
two-wallet lifecycle against explicitly mocked providers. Browser checks cover all
pages and explicitly labeled ready/mismatch/outage cockpit fixtures.

The local API reports packageCompiled=true and packagePublished=false. The first
manual action is wallet-approved testnet package publication. There is no automatic
use of the Sui CLI's development wallet; app transactions use the connected user's
wallet and are submitted through Tatum after exact-byte checks.
