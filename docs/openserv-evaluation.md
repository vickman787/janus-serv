# OpenServ evaluation record

## Executed on 5 November 2026 (isolated local copy)

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | Passed |
| Production build | `npm run build` | Passed. Vite warned only about the existing >500 kB client bundle. |
| Copilot fixture suite | `npx vitest run tests/copilot` | 25/25 passed |
| Full fixture suite | `npm test` | 109/109 passed across 11 files |
| Cockpit browser fixtures | `npx playwright test tests/e2e/cockpit.spec.ts` | 20/20 passed at 360, 390, 430, 1280, and 1440 px |
| Provider smoke | `npm run copilot:smoke` | Passed against both official endpoints |
| Real fixture analysis | `npm run copilot:fixture-analysis` | Passed; Dolphin then SERV produced a validated assessment |
| Isolated testnet E2E | `OPEN_SERV_E2E_CONFIRM=yes npx tsx --env-file-if-exists=.env scripts/openserv-e2e-testnet.ts` | Passed across disposable testnet wallets, package/control deployment, proposal/mismatch/approval, acceptance, copilot, stale state, counter, preference, memory, recovery reference, and cancellation |

The first baseline run, before the copilot changes, had 82/84 passing with two 30-second test timeouts in the subprocess recovery cases (`before_broadcast`, `after_broadcast`). The same cases passed in the final full runs. The timeout was environmental; the final result is reported rather than the weaker first attempt.

## Real provider integration

Synthetic fixture operation only; no production database, wallet, or private operation data was sent.

- Dolphin listed `deepseek-ai/DeepSeek-V4.1-Flash`.
- Dolphin fixture analysis: request `chatcmpl-9fe8aa7bd28d6b8c`, latency 16.6 s, 1,483 prompt + 1,553 completion = 3,036 tokens.
- SERV fixture analysis: model `gpt-5.4-mini`, request `chatcmpl-EgmGYBpBgELA3YiTYpG8ZfjfVHcKu`, latency 11.3 s, 2,453 prompt + 695 completion = 3,148 tokens.
- Application validation: zero warnings; all cited source IDs existed; verdict preserved as `ready`.
- Approximate combined provider cost for that run: **$0.0068** at published prices.
- First smoke attempt returned a real SERV `400`: `max_tokens` is unsupported for `gpt-5.4-mini`; the adapter now sends `max_completion_tokens` to SERV while keeping `max_tokens` for Dolphin.
- Full evidence prompts caused Dolphin to consume its token budget in reasoning with an empty final content field. The adapters now send compact facts plus allowed source IDs, and the output budget is 4,000 tokens. The fixture analysis then returned valid JSON.

This establishes real connectivity and one end-to-end output. It is not a quality evaluation.

## Isolated testnet E2E

The test harness generated three disposable Sui testnet wallets, funded them from the faucet, and started a separate API on port `4411` with:

- `JANUS_DATABASE_PATH=.data/janus-openserv-e2e.sqlite`
- `JANUS_WRITER_KEY_PATH=.data/openserv-e2e-writer.pem`
- `WALRUS_MEMORY_NAMESPACE=janus-openserv-e2e`
- `WALRUS_MEMORY_RECORD_PREFIX=janus-openserv-e2e-record`
- `JANUS_RUNTIME_ORIGIN=http://127.0.0.1:4410`

The final run passed these live stages:

1. Package publication on Sui testnet: `0xcc9aa6182b34e745a4b5292e2fe63cc5ca371dd9666e1de98dd53dc7a3acac72`.
2. Demonstration control creation: `0x156224d738c076ab2604686dce1fde398ea1499fe22b6a1dabfbaca2d243038a`.
3. Proposal creation: operation `487dc4e5-efdd-408b-80b0-670db9b79c43`.
4. Successor change produced a real `mismatch`; explicit administrator approval restored `waiting_actor`.
5. Successor view became `ready`; Recovery Copilot returned a validated `ready` assessment with a wallet-review step.
6. Successor acceptance completed the handover.
7. The pre-acceptance assessment became `stale`.
8. A completed-state assessment returned only `inspect`/`wait`, with no wallet-review step.
9. Administrator-only counter increment reached `1`.
10. Preference write/read round-tripped with `reviewStyle=concise`.
11. Memory listing returned 11 test records; recovery-reference and memory namespaces were all `janus-openserv-e2e-record-*`.
12. A second operation was proposed and cancelled successfully.

Model reliability findings from the live runs:

- One completed-state SERV output recommended wallet review and was rejected by application validation. The SERV prompt was tightened to forbid wallet review outside `ready`.
- In the final run, one completed-state Dolphin draft cited the nonexistent source ID `operation.proposalId`; application validation rejected it. A bounded retry produced a valid assessment.
- This is evidence that validation catches hallucinated references and prohibited actions, not evidence that the model is reliable without it.

Two validated assessment calls used approximately 4,900 + 3,880 and 3,867 + 3,868 provider tokens. Combined cost for those two was roughly **$0.014**; including the rejected retry, total provider spend was still on the order of a few cents. The test-only Walrus records remain under the e2e namespace and cannot necessarily be deleted. No submitted Janus-sui record was read, modified, or deleted.

## Fixture scenarios covered

The new tests use explicit chain/memory fixtures and the actual `Engine` and `Engine.view()` path.

- Valid pending handover with an authenticated successor.
- Non-participant evidence/assessment access.
- Changed live successor, producing `mismatch` and a changed evidence hash.
- Unknown transaction outcome represented by the deterministic verdict and preparation state.
- Chain success with memory synchronization pending (inherited recovery tests).
- Completed handover with repeated-action steps rejected.
- Memory unavailable and chain unavailable evidence boundaries.
- Operation label, journal, and preference text marked as untrusted.
- Injected instruction text rejected by application validation.
- Fabricated source IDs, addresses, 64-character hashes, and transaction-like digests rejected.
- Malformed JSON/model schema failures rejected.
- Verdict substitution rejected.
- Automatic/inferred approval, fee promises, and repeated transaction actions rejected.
- Provider timeout/failure leaves the cockpit operational and does not change transaction count.
- Evidence changed during provider analysis marks the job stale.
- Cross-actor assessment reads return not found; non-participants cannot enqueue.
- Duplicate evidence deduplicates without a second provider call.
- Per-actor charged-job rate limit.
- Interrupted `running` job recovery after restart.
- Separate Dolphin then SERV calls with stored provider metadata.
- Model output never changes deterministic permissions; an invalid role attempt still fails after analysis.

## Not evaluated

One isolated live flow plus one fixture analysis do not establish model quality or robustness. Still unmeasured:

- Source-reference validity rates across varied, labeled scenarios.
- Unsupported verified-claim rates from production models.
- Prohibited-action recommendation rates across adversarial cases.
- End-to-end latency distribution (observed calls were roughly 4–27 s per provider).
- Model-quality differences between Dolphin-only and Dolphin+SERV.

The 20–30 scenario labeled evaluation and repeated runs remain pending. Use `npm run copilot:smoke` to confirm providers, then run the live scenario set and report measured results separately from these results.

## Privacy observations

- Stored prompts are not exposed by API responses; only the validated assessment, allowlisted sources, and provider metadata are returned.
- API responses are participant-only and scoped to the requesting actor.
- Provider keys are server-only and never returned by `/api/config` or `/api/health`.
- Unsigned bytes, signatures, session hashes, raw memory envelopes, and private keys are not part of the evidence bundle.
