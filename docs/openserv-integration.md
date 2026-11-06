# OpenServ / Dolphin Recovery Copilot integration

Status: implemented locally on 4 November 2026, with fixture-backed tests. After provider keys were provisioned, `npm run copilot:smoke` passed against both official endpoints, and `npm run copilot:fixture-analysis` completed a real two-provider analysis over a synthetic fixture operation. See "Real integration evidence" below. The 20–30 scenario live evaluation is still pending.

## Verified provider routes

The following were read from the official documentation on 4 November 2026. No undocumented capabilities are assumed.

### SERV Reasoning

- Base URL: `https://inference-api.openserv.ai/v1`
- Chat endpoint: `POST /v1/chat/completions`, OpenAI-compatible
- Authentication: `Authorization: Bearer $SERV_API_KEY`
- A system prompt is mandatory. A request without one is rejected.
- JSON schema output is requested through `response_format: { type: "json_schema", ... }`.
- Default model used by this app: `gpt-5.4-mini` (from the published model catalog).
- Documentation: <https://docs.openserv.ai/serv-reasoning/introduction.md>, <https://docs.openserv.ai/serv-reasoning/api/index.md>, <https://docs.openserv.ai/serv-reasoning/tutorials/structured-outputs.md>, <https://docs.openserv.ai/serv-reasoning/models.md>.

### Dolphin Network

- Base URL: `https://lighthouse.dphn.ai/run/text-v/v1`
- Chat endpoint: `POST /chat/completions`, OpenAI-compatible
- Authentication: `Authorization: Bearer $DOLPHIN_API_KEY`
- Model endpoint: `GET /models`
- Default model used by this app: `deepseek-ai/DeepSeek-V4.1-Flash`
- The published route is DeepSeek served by Dolphin's inference network. Dolphin documents fallback to zero-data-retention OpenRouter providers only after a hardware fault.
- Documentation: <https://dphn.ai/docs/dphn-api>, <https://dphn.ai/docs/coupon-credits/>.

The documentation does not describe a supported "route SERV to Dolphin" or "route Dolphin through SERV" option. The implementation therefore uses two explicit, separate provider calls rather than inventing a combined route.

## Real integration evidence

Executed locally on 5 November 2026 with provisioned keys and synthetic fixture data only:

| Check | Result |
| --- | --- |
| `npm run copilot:smoke` | Passed. Dolphin listed the configured model and both providers returned `{"ok":true}`. |
| `npm run copilot:fixture-analysis` | Passed. Dolphin interpretation then SERV plan completed, with application validation returning zero warnings. |

Fixture analysis details:

- Deterministic verdict: `ready`; 40 evidence sources; fixture-only operation.
- Dolphin: model `deepseek-ai/DeepSeek-V4.1-Flash`, request `chatcmpl-9fe8aa7bd28d6b8c`, latency 16.6 s, usage 1,483 prompt / 1,553 completion / 3,036 total tokens.
- SERV: model `gpt-5.4-mini`, request `chatcmpl-EgmGYBpBgELA3YiTYpG8ZfjfVHcKu`, latency 11.3 s, usage 2,453 prompt / 695 completion / 3,148 total tokens.
- Approximate provider cost for that single fixture analysis: **$0.0068** using published prices.
- Read-only Walrus Memory access passed with the new OpenServ delegate and the existing account. No OpenServ memory record was written during verification.
- SERV required `max_completion_tokens`; sending `max_tokens` produced a real `400 unsupported_parameter`. Dolphin accepted `max_tokens`.
- The compact model payload sends validated facts and source IDs without the full source-value catalog or memory identifiers. Full source values remain server-side for validation and UI expansion.

This is one successful synthetic integration run, not a model-quality evaluation.

A separate isolated testnet E2E also passed with three disposable wallets and a fresh `.data/janus-openserv-e2e.sqlite` database: package publication, control creation, proposal, successor-change mismatch, explicit live approval, ready assessment, acceptance, completed assessment, stale detection, counter increment, preference, memory/recovery-reference isolation, and cancellation. See `docs/openserv-evaluation.md` for the exact stages and the observed model rejections/retries.

## Runtime architecture

```
Engine.view(id, actor)                       deterministic checkpoint + live chain + verdict + journal
        |
        v
buildRecoveryEvidence(view, actor)           allowlisted RecoveryEvidenceBundle + source catalog + semantic hash
        |
        +--> Dolphin chat completion         interpret history, draft findings/questions
        |         |
        |         v
        |    validateDraft                    source IDs, identifiers, injection/action boundaries
        |
        +--> SERV chat completion            structured recovery plan from evidence + Dolphin draft + verdict
                  |
                  v
             validateAssessment               operation/hash/verdict identity, source links, action permissions
                  |
                  v
             copilot_assessments              private local SQLite record; never a memory checkpoint
```

`Engine.view()`, `restore()`, `observe()`, `prepare()`, `submit()`, and `recover()` remain the only deterministic recovery and execution path. Copilot routes never call transaction preparation, never sign, never submit, and never change operation rows or permissions.

## Evidence contract

`packages/copilot/src/evidence.ts` builds a `RecoveryEvidenceBundle` from the actual `Engine.view()` result. It includes only selected fields:

- Operation, network, control, proposal, and checkpoint identities.
- Checkpoint sequence, stage, revision, expiry, successor, memory/content hashes, prepared digest, bounded confirmed transactions.
- Live control/proposal/clock values and fetch time.
- Latest preparation digest/action/state (never bytes, signatures, session hashes, or conditions).
- Deterministic verdict, differences, and permitted next action.
- At most the configured number of recent journal entries.
- The authenticated actor's approved preference, if any.
- A stable source catalog. Operation labels, journal messages, and preference explanations are marked `untrusted: true`.

The bundle's semantic hash excludes the generated timestamp and live fetch time so exact deduplication works across repeated views. It changes when checkpoint, live proposal/control, journal IDs, verdict, preference, or preparation evidence changes.

## Isolation configuration

The OpenServ copy may use the owner's existing Walrus Memory account, but it must not reuse the submitted edition's delegate, writer key, database, namespaces, or runtime state.

| Item | OpenServ value | Effect |
| --- | --- | --- |
| Walrus Memory account | Existing owner account | Read access verified with the new OpenServ delegate |
| Walrus Memory delegate | New OpenServ credential | Server-only; not copied from the submitted edition |
| Client namespace | `WALRUS_MEMORY_NAMESPACE=janus-openserv` | Separates this app's client scope |
| Record namespaces | `WALRUS_MEMORY_RECORD_PREFIX=janus-openserv-record` | Each write uses `janus-openserv-record-<uuid>` |
| Local database | `JANUS_DATABASE_PATH=.data/janus-openserv.sqlite` | Fresh local discovery/state DB |
| Record-signing key | `JANUS_WRITER_KEY_PATH=.data/openserv-writer-private.pem` | New Ed25519 identity generated on first start |
| Session authentication | Existing design unchanged | Random session tokens stored hashed; `JANUS_SESSION_SECRET` is unused and not required |

The restore route and recovery-reference schema accept only `janus-openserv-record-*` namespaces, so a submitted-edition reference is not imported by accident. The new writer fingerprint also rejects records signed by the old writer. No global delete or rewrite is exposed.

## Provider adapters

- `dolphin.ts` — evidence/history interpretation only. It cannot authorise actions.
- `serv.ts` — structured planning using both the evidence bundle and Dolphin's validated draft. A strict JSON schema is supplied through `response_format`.
- `provider-http.ts` — raw Node `fetch`, bounded timeout, capped retries for 429/5xx only, sanitised error messages, no SDK dependency added. Uses `max_tokens` for Dolphin and `max_completion_tokens` for SERV, matching the providers' real behavior.
- Both adapters receive `compactEvidenceForModel()`: validated facts, differences, journal text, and allowed source IDs, but not the full source-value catalog or memory identifiers.
- Provider URLs are HTTPS-only and default to the official allowlisted hosts. `COPILOT_ALLOW_CUSTOM_ENDPOINTS=true` is required to use a different documented endpoint.

## Job and storage model

- `copilot_jobs` stores queued/running/completed/failed/invalid/stale jobs, provider/model/prompt versions, bounded evidence, attempts, and sanitised errors.
- `copilot_assessments` stores the validated assessment, its source bundle, provider metadata, and a snapshot for stale detection.
- Tables are created idempotently by `Store`; no migration or change to memory record kinds is required.
- Jobs are deduplicated by operation, actor, evidence hash, prompt version, and both model IDs.
- Jobs are bounded by per-actor hourly limits, output-token limits, evidence-size limits, and provider timeouts/retries.
- Restart recovery moves orphaned `running` jobs back to `queued`.
- Before storing, the worker rebuilds evidence and marks the job `stale` if the evidence hash changed while providers were running.

## API

Participant authentication is mandatory; a public operation flag is not sufficient.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/operations/:id/copilot/assess` | Enqueue analysis. Body must be `{ "approved": true }`. Returns `202` with a job ID. |
| GET | `/api/operations/:id/copilot/jobs/:jobId` | Read job state for the requesting actor. |
| GET | `/api/operations/:id/copilot/assessments` | List this actor's assessments for the operation. |
| GET | `/api/operations/:id/copilot/assessments/:assessmentId` | Read one assessment, source values, provider metadata, and stale state. |

`GET /api/config` and `/api/health` expose only non-secret copilot capabilities and the disabled reason. Keys never reach the browser.

## Validation rules

`packages/copilot/src/validate.ts` enforces:

- Zod schema validation of Dolphin and SERV outputs.
- Operation ID and evidence hash identity.
- Exact deterministic verdict preservation.
- Every finding and step must cite existing source IDs.
- Verified findings cannot be source-free.
- Unknown Sui addresses, 64-character hashes, and transaction-like digests are rejected.
- `request_wallet_review` is allowed only for a `ready` verdict, authenticated successor, and `accept` next action.
- Completed operations permit only `inspect`/`wait` steps.
- Automatic/inferred approval, automatic submission, retry/sign outside wallet review, successor substitution, fee/financial promises, and prompt-injection echoes are rejected.
- Output size and array counts are capped by schema.

Factual source values remain visible separately from model interpretation. Model self-confidence is never presented as calibration.

## Configuration

See `.env.example`:

| Variable | Default | Notes |
| --- | --- | --- |
| `WALRUS_MEMORY_NAMESPACE` | `janus-openserv` | Client-level namespace; keep isolated from the submitted edition |
| `WALRUS_MEMORY_RECORD_PREFIX` | `janus-openserv-record` | Per-record namespace prefix; validated |
| `JANUS_DATABASE_PATH` | `.data/janus-openserv.sqlite` | Must be a `.sqlite` file directly under `.data/` |
| `JANUS_WRITER_KEY_PATH` | `.data/openserv-writer-private.pem` | Must be a `.pem` file directly under `.data/` |
| `JANUS_SESSION_SECRET` | empty | Unused by current authentication; not required |
| `COPILOT_ENABLED` | `false` | Must be exactly `true` to enable |
| `DOLPHIN_API_KEY` | empty | Server-only secret |
| `DOLPHIN_BASE_URL` | official Dolphin Network base | HTTPS only |
| `DOLPHIN_MODEL` | `deepseek-ai/DeepSeek-V4.1-Flash` | Published model ID |
| `SERV_API_KEY` | empty | Server-only secret |
| `SERV_BASE_URL` | official SERV base | HTTPS only |
| `SERV_MODEL` | `gpt-5.4-mini` | Published SERV model |
| `COPILOT_ALLOW_CUSTOM_ENDPOINTS` | `false` | Requires a documented deployment change |
| `COPILOT_PROVIDER_TIMEOUT_MS` | `60000` | 2–60 seconds |
| `COPILOT_MAX_PROVIDER_RETRIES` | `1` | 0–2, only 429/5xx |
| `COPILOT_MAX_OUTPUT_TOKENS` | `4000` | Per provider call |
| `COPILOT_MAX_PROMPT_CHARS` | `40000` | Bounded evidence size |
| `COPILOT_MAX_JOBS_PER_ACTOR_PER_HOUR` | `10` | Charged-job limit |
| `COPILOT_MAX_JOURNAL_ENTRIES` | `20` | Evidence journal bound |

## Enable and verify

```powershell
# Put keys in .env, not in shell history or chat.
npm run copilot:smoke
npm run copilot:fixture-analysis
```

`copilot:smoke` lists Dolphin models, then sends one non-sensitive ping to Dolphin and one to SERV. It prints endpoint hosts, model IDs, request IDs, latency, and token usage. It does not print keys or prompts.

`copilot:fixture-analysis` creates a temporary synthetic operation, builds a real `RecoveryEvidenceBundle`, calls Dolphin and SERV, and prints the validated advisory assessment plus provider usage. It does not touch the local app database, Walrus, or Sui.

## Files added

- `packages/copilot/src/{schemas,evidence,dolphin,serv,provider-http,validate,analyze,config,errors}.ts`
- `apps/web/src/components/RecoveryCopilot.tsx`
- `tests/copilot/{support,evidence,validation,assessment}.test.ts`
- `scripts/copilot-provider-smoke.ts`
- `scripts/openserv-e2e-testnet.ts` — isolated live testnet harness; requires `OPEN_SERV_E2E_CONFIRM=yes`, funded disposable wallets, and writes test-only Walrus records under `janus-openserv-e2e-record-*`
- `docs/openserv-*.md`

## Honest limitations

- Real provider connectivity, one fixture-backed analysis, and one isolated live testnet E2E flow have been executed. The full 20-30 scenario labeled evaluation, repeated runs, and model-quality comparison have not.
- The job types and required models are recorded as configuration; the public model catalogs may change.
- Provider fallback routing and Dolphin network guarantees are described by provider documentation, not independently verified here.
- Demonstration scenarios use isolated fixtures. No production database, wallet, writer key, memory scope, or deployment was touched.
