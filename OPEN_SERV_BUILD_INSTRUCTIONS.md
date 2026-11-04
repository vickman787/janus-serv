IMPORTANT: This clean copy already exists. Work in this folder; skip instructions to create another copy. The original C:\Projects\Janus-sui remains read-only. Inspect SOURCE_COPY_MANIFEST.json for provenance. No credentials, runtime data, or dependencies were copied.

# Janus OpenServ: instructions for the implementing AI agent

Prepared 4 November 2026 after a read-only inspection of the local Walrus Janus repository.

## 1. Your task

Create a separate OpenServ edition of the existing Janus Sui application. Reuse the working application; do not rebuild it from scratch. Add a substantive recovery copilot using Dolphin and SERV Reasoning for the Dolphin track, subject to verifying the official supported integration route.

The existing source is at:

```text
C:\Projects\Janus-sui
```

Inspected HEAD: `8f1ee11` (`Remove development label from sidebar`). Recheck HEAD and working-tree status before beginning; the owner may have made newer changes.

The owner reports that the Walrus edition has already been submitted. Preserve that edition, its remote, data, deployed application, and production runtime.

Suggested new working directory, if available and authorized in your environment:

```text
C:\Projects\Janus-openserv
```

Create an independent Git checkout/copy with history retained where practical. Do not leave its push destination pointed at the submitted app's repository. Do not create or publish a GitHub repository, push commits, change a deployment, or post on X without the owner's applicable authorization. Local implementation in the separate workspace is the intended task.

## 2. Protect the submitted build

- Treat `C:\Projects\Janus-sui` as read-only reference material.
- Do not run `npm start`, `dev:api`, `worker`, probes, or memory-evidence scripts inside that folder. Its README warns that the production VPS is authoritative and the migrated local database must not become a second writer.
- Do not copy `.env`, `.data`, SQLite databases/WAL files, session cookies, writer private keys, delegate credentials, deployment credentials, or production outbox/jobs into the new app.
- Do not blindly copy `node_modules`, `dist`, `.tools`, caches, or test-results. Install from the copied lockfile in the new workspace.
- Reuse tracked code, tests, brand assets, contract source and appropriate reproducible compiled artifacts. Review the license and preserve attribution.
- Create a fresh local database, new record-signing identity, isolated memory account/scope, and separate local ports for OpenServ development.
- The current server hardcodes `.data/janus.sqlite`; a different current working directory is essential. Prefer adding explicit validated data-directory configuration in the NEW copy.
- Do not reuse the original mutable control/proposal objects for development. Use fixtures and isolated testnet objects, with owner-approved wallet actions when needed.
- Keep paid model calls, account changes, and wallet signatures within the owner's authorization. Continue fixture-based implementation while waiting for credentials.

## 3. What inspection established

This is a TypeScript React/Vite + Node HTTP API/worker app. It uses Zod, SQLite, Sui dApp Kit, Tatum gRPC, and the real Walrus Memory SDK. No SERV/Dolphin/LLM integration was found in the inspected application source or dependency manifest.

The implementation distinguishes **Sui Testnet** administrative actions from **Walrus Mainnet** memory. Do not describe Sui operations as Mainnet transactions.

Existing functionality worth preserving:

- Wallet connection, signature authentication, session and actor checks.
- Proposal, acceptance, successor change, cancellation, expiry, and a harmless admin-only control counter.
- Known-digest transaction recovery, preparation identity verification, unsigned outbox, durable leases, and memory-sync repair.
- Signed Walrus records and validated restore; no local checkpoint fallback.
- Dashboard, operation workspace, two-pane cockpit, evidence, journal, preferences, memory browsing, status, and guide.
- Recovery-reference export/import with documented inspection-only boundaries.
- Domain, API, browser and actual-subprocess recovery test scenarios.

Existing documentation reports executed tests and remote-memory evidence, but those results were NOT rerun during this inspection. Establish a fresh baseline in the NEW isolated copy. Documentation is partly stale about deployment/submission status; preserve history and update OpenServ-specific claims based on actual evidence.

## 4. Start here: the actual integration map

| File | Inspected entry point | Integration instruction |
| --- | --- | --- |
| `apps/api/src/engine.ts` | `Engine.view()` at approximately line 76 | Produces the runtime operation snapshot: checkpoint, live state, verdict, journal, preference. Build sanitized model evidence from this path. |
| `apps/api/src/engine.ts` | `restore()`, `observe()`, `prepare()`, `submit()`, `recover()` | Keep these as deterministic recovery/execution authority. Do not give model output permission to call them. |
| `apps/api/src/routes.ts` | Operation routes at approximately lines 19–29 | Add authenticated copilot routes next to existing operation APIs, using the same session and participant checks. |
| `apps/api/src/store.ts` | SQLite schema and journal | Add separate assessment/job storage through idempotent schema initialization or explicit migration in the new app. |
| `apps/api/src/server.ts` | Dependency construction, request validation, rate limits, worker timer | Construct server-only model adapters, isolated configuration, and assessment worker lifecycle here. |
| `packages/domain/src/workflow.ts` | `workflowSchema` | Runtime workflow data shape; use it when constructing normalized evidence. |
| `packages/memory/src/adapter.ts` | `MemoryAdapter.read()` and `write()` | Existing signed-record validation; do not bypass it or send raw memory envelopes/credentials to providers. |
| `packages/chain/src/handover.ts` and `tatum.ts` | Chain adapter and provider client | Existing current-state/effects sources; preserve them. |
| `apps/web/src/main.tsx` | `View = Awaited<ReturnType<Engine['view']>>`, cockpit around lines 69–79 | Add an additive Recovery Copilot panel below/alongside the deterministic verdict. |
| `tests/recovery/engine.test.ts` | Tests against the actual Engine with explicit fixtures | Extend here for copilot/runtime boundary tests. |

Important distinction: `packages/domain/src/reconcile.ts` exports a pure reconciler, but the inspected runtime Engine does not import/call it. Domain tests exercise that module separately. Do not assume changes there automatically affect the application. Add the copilot around the actual `Engine.view()` path. Unifying reconciliation is optional separate work, requiring behavioral tests; it is not a prerequisite for this feature.

Line numbers are a navigation aid, not a promise that the file has not changed.

## 5. Product: Recovery Copilot

User story:

> As an operation participant, I want Janus to explain an interruption, identify what is known or missing, and produce a source-linked recovery plan so I can review the appropriate next step.

This is not a generic chat window. The core interaction is:

1. Open an authorized operation.
2. Click **Analyze recovery**.
3. Janus fetches validated checkpoint/live-state evidence through its existing engine.
4. Dolphin interprets the structured history and drafts a fact/incident assessment with evidence references.
5. SERV Reasoning synthesizes a structured recovery plan from that assessment AND the underlying normalized evidence and deterministic verdict.
6. Application validation rejects unsupported references, claims, or proposed actions.
7. User sees summary, differences, unresolved questions, source-linked steps, and the original deterministic execution state.
8. User revalidates and uses the normal existing wallet-review flow for any permitted transaction.

A compelling demo should include a changed successor, an unknown transaction outcome, and chain-success/memory-sync-pending recovery. The model must correctly distinguish them.

## 6. Verify Dolphin and SERV before choosing APIs

Official references:

- Event: https://www.openserv.ai/hackathon-2
- SERV documentation: https://docs.openserv.ai/
- SERV documentation index: https://docs.openserv.ai/llms.txt
- Dolphin partner link supplied by the event: https://dphn.ai/

All tracks require SERV Reasoning. The Dolphin track concerns decentralized open-source models. The event allows meaningful additions to existing projects with clear disclosure of work done during the hackathon.

Do not assume that a model called Dolphin on an arbitrary inference service qualifies. Do not assume that self-hosting an open model with Dolphin-related software establishes decentralized execution. Verify the partner-approved model, endpoint, hosting/access path, authentication, and evidence expected for this track.

The previous research did not establish a working Dolphin inference endpoint or SERV-to-Dolphin routing support. Make those explicit integration gates:

- First prove a minimal real SERV Reasoning request.
- Prove a minimal request through the approved Dolphin route.
- Determine whether Dolphin can be used directly through SERV or whether separate supported calls are required.
- If separate calls are supported, use Dolphin for evidence/history interpretation and SERV for structured planning with the original evidence included.
- If SERV can route to the approved Dolphin model, use the supported single-route architecture and record its actual behavior.
- Do not invent API capabilities, assert private deployment guarantees, or silently fall back to a closed model while claiming Dolphin compliance.
- If blocked, show a small reproducible failure and continue independent local work with clearly labeled fixtures. Do not switch tracks without owner agreement.

Read current provider docs and lock the actual versions used. Do not install new agent frameworks solely because available skills recommend them: preserve this existing app unless a demonstrated integration constraint requires a change.

## 7. Evidence and assessment contract

Build a normalized `RecoveryEvidenceBundle` with:

- Operation ID, network, package/control/proposal identifiers.
- Checkpoint sequence and source reference/hash.
- Current live proposal stage/revision and fetched time.
- Chain clock, expiry, administrator and successor facts.
- Prepared/submitted transaction digest and verified/unresolved effects state where applicable.
- Deterministic verdict and allowed next action, if any.
- Relevant bounded journal entries and approved preference, scoped to the authenticated user.
- A source catalog with stable IDs mapping facts to actual validated values.
- A digest/hash identifying the bundle version and requesting actor/authorization context.

Use a deliberate allowlist. Do not serialize whole database rows, sessions, transaction signing payloads, server environment, private keys, delegate credentials, or unrestricted raw memory into prompts. Private operation data may be disclosed to model providers: explain the providers and scope before requesting analysis, and obtain appropriate user authorization. Use synthetic or intentionally public examples for initial provider tests.

Proposed structured assessment schema:

```ts
type RecoveryAssessment = {
  schemaVersion: 1;
  operationId: string;
  evidenceHash: string;
  deterministicVerdict: string;
  summary: string;
  findings: Array<{
    statement: string;
    status: 'verified' | 'uncertain';
    sourceIds: string[];
  }>;
  questions: string[];
  steps: Array<{
    kind: 'inspect' | 'wait' | 'review' | 'revalidate' | 'request_wallet_review';
    instruction: string;
    sourceIds: string[];
  }>;
};
```

Validate with Zod and independent application rules. For example:

- Missing source IDs and fabricated transaction digests cannot become verified facts.
- The assessment must match operation, actor scope, bundle hash, and current evidence version.
- The model cannot turn `mismatch`, `unresolved`, `expired`, or unavailable evidence into permission to sign.
- Reject unsupported successor substitutions, inferred approval, invented fee/financial promises, and automatic resubmission advice.
- Cap output size, model retries, requests per actor, and total cost per analysis.
- Do not demand private chain-of-thought. Save final structured assessments, cited facts, validation results, provider metadata, and bounded execution events.

Where factual claims cannot be mechanically validated, label them as interpretation and keep the source facts separately visible. Never portray an LLM's self-rated confidence as calibrated reliability.

## 8. Isolated modules and API

Suggested new modules:

```text
packages/copilot/src/
  schemas.ts                 # evidence/output schemas
  evidence.ts                # allowlisted builder from actual Engine view
  dolphin.ts                 # verified provider integration
  serv.ts                    # verified SERV Reasoning integration
  validate.ts                # references, identity, action boundaries
  analyze.ts                 # bounded orchestrator
apps/web/src/components/
  RecoveryCopilot.tsx
tests/copilot/
  evidence.test.ts
  validation.test.ts
  assessment.test.ts
docs/
  openserv-integration.md
  openserv-prior-work.md
  openserv-evaluation.md
  openserv-demo.md
```

Suggested endpoints:

```text
POST /api/operations/:id/copilot/assess
GET  /api/operations/:id/copilot/assessments/:assessmentId
```

POST requires verified participant authentication, not merely an operation's public flag. GET checks authorization every time and defaults to private. Do not expose private journal/provider prompts through public evidence pages.

Return a job ID for long analysis, with queued/running/completed/failed/invalid/stale states. Deduplicate per operation, actor, evidence hash, and prompt/model version to prevent repeated charges. A durable job must contain only necessary authorized data and operate exclusively in the new app's storage. Handle restart and provider timeout without duplicate uncontrolled calls.

Initially persist assessment records in the new local database. Keep generated assessments separate from authoritative checkpoints and approved preferences. Do not extend the existing `MemoryRecord.kind` enum just to put arbitrary model output in critical checkpoint storage. Saving assessments to Walrus is optional later work after data-access and provenance design.

Add only documented logical environment variables for provider URLs, keys, model names, enablement, timeouts, and budgets. Use placeholders until credentials are provisioned. Never copy original secrets or expose new keys in frontend variables.

## 9. UI requirements

Keep the existing Janus logo, colors, navigation, wallet flow, two-pane evidence cockpit, and deterministic verdict.

Add a **Recovery Copilot** panel containing:

- Analyze recovery button and short provider-disclosure copy.
- Loading/job state and bounded retry controls.
- Plain summary of the interruption.
- What is verified versus uncertain.
- Source links expanding the actual checkpoint, live field, journal entry, or transaction evidence.
- Proposed review steps and unanswered questions.
- Provider/model identifiers and assessment time.
- Clear “Advisory assessment” labeling separate from the deterministic verdict.
- A stale banner and reanalyze/revalidate action after any operation/actor/revision changes.

Do not replace existing sign/review buttons with a model-generated action button. The existing revalidation/preparation pipeline remains mandatory.

Extract the new panel into its own component rather than expanding the already dense `main.tsx` further. Preserve mobile layouts and accessible status/focus behavior. Avoid a broad unrelated frontend rewrite.

## 10. Testing and meaningful evaluation

In the isolated copy, establish the existing baseline using typecheck, unit tests, build, and appropriate browser checks. Inspect test scripts first to ensure fixture-only tests cannot connect to production data or providers. Record current results, not only inherited documentation.

Extend tests around actual `Engine.view()` snapshots and routes. Use explicit fixtures for:

- Valid pending handover and wrong actor.
- Successor/revision mismatch.
- Missing/unavailable memory and unavailable chain.
- Expired/cancelled proposal.
- Transaction outcome unknown.
- Chain confirmed while memory finalization is pending.
- Completed handover, with no repeated action recommended.
- Injected instructions inside operation labels/journal/memory text.
- Fabricated source references, malformed JSON, model timeout, rate limit, stale output, account switching, and cross-user access.

Confirm that copilot availability never changes deterministic permission or transaction count. Provider failure must leave the core app functional.

Prepare a manually labeled evaluation set with around 20–30 distinct scenarios if feasible. Report actual source-reference validity, unsupported verified claims, prohibited-action recommendations, schema failures, end-to-end latency, and recorded usage/cost. Evaluate real outputs; fixture successes do not establish model quality.

If comparing Dolphin-only versus Dolphin+SERV, hold scenarios and model settings constant where possible, disclose differences and repeat runs appropriately. Report measured results without promising improvement. Never fabricate private reasoning traces or provider metadata.

## 11. Implementation order and exit gates

1. Inspect source and git state; create isolated copy and record inherited commit.
2. Isolate DB/keys/memory scope/ports; establish fixture test baseline.
3. Prove approved Dolphin access and real SERV requests with non-sensitive inputs.
4. Build evidence schema and allowlisted collector from actual runtime view.
5. Implement bounded provider adapters, structured plan validation and private assessment storage/jobs.
6. Add authenticated API routes and the cockpit panel.
7. Test runtime boundary, privacy, stale output, failures, and no-action-on-model-output invariants.
8. Run real integration/evaluation scenarios under an owner-approved budget.
9. Record a working local demo and prepare public repository setup/write-up/X-post draft.

Do not rebuild existing contracts, redeploy infrastructure, or migrate memory merely to add this advisory feature. Isolated testnet operation creation can happen later with owner-approved wallet actions.

## 12. Submission and provenance

Describe the baseline honestly: Janus on Sui with Walrus memory and Tatum verification existed before this OpenServ work. The new contribution is the tested Dolphin/SERV recovery-analysis feature, associated evidence UX, and evaluation results.

OpenServ's published checklist accepts a public repo, demo link or video, short write-up, and X-post link. A hosted app URL is not explicitly mandatory there. The interactive submission form's later fields were not independently verified during the earlier inspection. Recheck it before submission. A working local implementation with reproducible setup and a genuine video is our initial delivery target; hosting is optional unless subsequently required.

Keep the submitted Walrus deployment stable. Do not claim inherited features or previous memory counts as new OpenServ work. Publishing, account acceptance, paid actions, and submission need applicable owner authorization.

## 13. Definition of done

- Separate working app with original source untouched and isolated runtime storage.
- Existing Janus wallet/recovery workflow preserved.
- Genuine partner-approved Dolphin use and genuine SERV Reasoning use verified.
- Evidence-linked recovery assessment available in the actual cockpit.
- Model output cannot override deterministic execution permissions.
- Actor privacy, stale evidence, prompt injection, and failure states tested.
- Existing and new tests executed with exact results reported.
- Real model evaluations and cost/latency results recorded honestly.
- New work clearly attributed and distinguished from Walrus submission.
- Public-repository-ready setup instructions, short write-up, and local demo recording prepared.

Proceed with routine reversible implementation choices in the isolated copy. Ask the owner only for necessary credentials, provider/track clarification, budget, wallet interactions, or publication authorization. If blocked on provider access, produce a concrete diagnostic and continue independent fixture/UI work without claiming the integration works.


