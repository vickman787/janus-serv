# Prior work and OpenServ contribution

## Baseline (before this OpenServ copy)

Janus on Sui existed before this work. The source copy records commit `8f1ee11090d83b8903ef777fdf321703b4bd4bbf` and includes:

- Sui Testnet handover contract source and compiled artifacts.
- Wallet signature authentication, sessions, participant checks, proposal/acceptance/successor-change/cancel/expiry actions, and an administrator-only counter.
- Tatum gRPC chain evidence and Walrus Memory signed records with validated restore.
- Durable unsigned preparations, known-digest recovery, leases, memory-sync repair, and a recovery worker.
- Dashboard, operation cockpit, evidence, journal, preferences, memory browsing, status, guide, and recovery-reference import/export.
- Existing domain, API, recovery, and browser fixture tests.

The Walrus edition was submitted separately by the owner. Its repository, deployment, data, writer identity, and runtime are intentionally not reused or modified here.

## New work in this OpenServ copy

- Verified the official Dolphin Network and SERV Reasoning integration routes from provider documentation.
- Added a normalized, allowlisted `RecoveryEvidenceBundle` built from the actual `Engine.view()` runtime path.
- Added separate Dolphin (interpretation) and SERV Reasoning (structured planning) adapters using the documented OpenAI-compatible endpoints.
- Added strict application validation for source references, evidence identity, verdict preservation, action boundaries, identifiers, prompt injection, and financial/approval claims.
- Added durable copilot jobs and private assessments in the new local SQLite database, with deduplication, rate limits, stale detection, restart recovery, and provider failure isolation.
- Added authenticated participant-only API routes.
- Added the Recovery Copilot cockpit panel, showing advisory findings, source evidence, review steps, open questions, provider/model metadata, stale state, and revalidation controls.
- Added fixture tests for the runtime boundary, validation, privacy, stale output, provider failure, and rate limits.
- Added a non-sensitive provider smoke diagnostic and this documentation set.

## What is not claimed

- No inherited feature is presented as new OpenServ work.
- Real provider connectivity, one synthetic fixture analysis, and an isolated live testnet E2E flow have been executed; no broad model-quality or production-operation result is claimed.
- The deterministic recovery and signing pipeline remains untouched. Model output is advisory and cannot grant permission or replace wallet review.
