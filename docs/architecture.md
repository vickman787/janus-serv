# Architecture

Janus is a separate Sui application. The original Base/Sibyl deployment is unchanged.

- React/Vite: original SVG brand, dashboard, operations, two-pane cockpit, memory,
  status, guide and a separate wallet diagnostic. Browser holds no provider secrets.
- Node API: wallet challenges/sessions, participant authorization, exact-byte
  preparation, wallet signature verification and Tatum-only submission/effects reads.
- Sui Move: shared Control and Proposal objects. Administrator authority gates a
  harmless counter. Proposal acceptance requires successor, revision, control and
  unexpired Sui Clock conditions. Changes advance revision; repeat acceptance fails.
- Walrus Memory Mainnet: signed intent/checkpoint/outcome records and approved
  preferences, stored via the real SDK and Foundation hosted relayer.
- SQLite: discovery pointers, sessions, unsigned preparations, accepted memory-job
  pointers, journal and durable leases. Critical workflow context is restored from
  Walrus before continuation. There is no local checkpoint fallback.
- Worker: the long-lived API checks unresolved digests every 20 seconds. The same
  engine can run via `npm run worker`. Durable claims coordinate processes sharing
  one SQLite database on a single host. This is not a multi-host distributed DB.

## Chain and memory networks

Administrative actions are restricted to Sui Testnet in this build; package and
object types are server-controlled. Walrus Memory uses Mainnet. These are separate
network selections. The Foundation managed relayer sponsors its memory storage;
Sui testnet transactions require testnet gas and individual wallet approvals.

## Deployment

`npm run build` creates the SPA. `npm start` serves it with the API from one
long-lived process. `JANUS_RUNTIME_ORIGIN` sets the exact allowed app origin;
`JANUS_BIND` and `JANUS_PORT` configure the listener. HTTPS origins add Secure to
session cookies. The Dockerfile packages the app; mount `.data` persistently and
provision secrets outside the image. The image excludes local credentials, writer
keys, test data and downloaded tools. Actual hosting has not been provisioned.

## Honest boundaries

Record-ID candidate retrieval is constrained by the SDK: each immutable record
uses a unique namespace, and the exact blob identity, hash and writer signature
are checked. A missing candidate is unavailable, not confirmed absence. Independent
fresh runtimes need the same trusted writer key and the authoritative latest index
before mutations. Imported references are inspection-only if that index is absent.
No autonomous signing, spending, generalized workflow or payments are implemented.
