# OpenServ demo plan

Target: a short, honest local walkthrough of the real cockpit plus the advisory Recovery Copilot. No production deployment, funded transaction, or provider claim is required for the local recording.

## Preconditions

1. Fresh local `.data` directory in `C:\Projects\Janus-openserv`.
2. Testnet-only wallet approval flow, with two distinct Sui accounts.
3. For a live-provider demo, `COPILOT_ENABLED=true` and both provider keys set. Run `npm run copilot:smoke` first.
4. If keys are unavailable, record the clearly disabled-provider state and use fixture evidence for the copilot boundary. Do not imply that a model call happened.

## Scenarios

### 1. Changed successor

- Administrator proposes a handover to successor A.
- A different live successor B is applied through the normal testnet flow.
- Open the cockpit. The deterministic verdict is `mismatch`, and stale actions are blocked.
- Run **Analyze recovery**.
- Expected advisory behavior: the summary identifies the remembered/live successor difference; verified findings cite `checkpoint.successor`, `live.proposal.successor`, and `verdict.difference.*`; no wallet-review step is offered for the mismatch.
- Revalidate. Show that the deterministic actions remain unchanged.

### 2. Unknown transaction outcome

- Prepare a proposal, then interrupt or lose the provider response.
- The cockpit shows `unresolved` and blocks replacement transactions.
- Run **Analyze recovery**.
- Expected: the assessment calls the outcome unresolved, cites the prepared digest, and recommends inspecting/revalidating rather than resubmitting.
- Show the normal **Recover known digest** control. The model cannot trigger it.

### 3. Chain success, memory synchronization pending

- Simulate chain confirmation with `memory_sync_pending` (fixture or isolated testnet fault).
- Run **Analyze recovery**.
- Expected: the plan says no repeat transaction is needed and points to memory synchronization/repair.

### 4. Completed handover

- Show a completed operation.
- Analyze. Expected: no repeated action recommendation; only inspect/wait is permitted by application validation.

### 5. Provider failure

- Disable or misconfigure a key, or force a timeout.
- The job ends `failed`, the cockpit remains usable, and the deterministic verdict and wallet controls are unchanged.

## Capture checklist

- Show the provider disclosure and the **Advisory assessment** label.
- Expand at least one source reference and show the underlying validated value.
- Show provider/model identifiers and analysis time.
- Show the stale banner after changing evidence without reanalyzing.
- Show that **Review acceptance** or **Review proposal** still comes from the deterministic cockpit, not from the model.
- State clearly whether the recording used real provider output or labeled fixtures.
