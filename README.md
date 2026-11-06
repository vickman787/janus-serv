# Janus — OpenServ development copy

This is a clean source copy of the owner's Sui/Walrus Janus, prepared for a separate OpenServ hackathon integration. Dolphin and SERV Reasoning are **not integrated yet**.

## Start here

Open this directory as the project root in your AI coding tool. Give the agent this instruction:

> Read `OPEN_SERV_BUILD_INSTRUCTIONS.md` and `SOURCE_COPY_MANIFEST.json`. This clean copy is already the new implementation workspace; do not copy the project again. Inspect the existing code, establish an isolated fixture-test baseline, verify the official Dolphin and SERV integration routes, and add the Recovery Copilot described in the instructions. Preserve the current wallet and deterministic recovery behavior. Never modify the original `C:\Projects\Janus-sui` or connect this copy to its production database, writer identity, or worker. Continue useful local work if provider credentials are not yet available, and report real integration results honestly.

## Included

- Application and package source; Sui Move source and committed compiled artifacts.
- Tests, test/build configuration, package manifest and lockfile.
- Development scripts and selected architecture/recovery/reference documentation.
- The logo and favicon directly referenced by the interface.
- License, environment template, source-copy provenance, and the OpenServ implementation brief.

## Deliberately excluded

Production `.env`, `.data`, credentials, writer keys, databases, operation/job/session state, original Git history/remotes, `node_modules`, built output, downloaded tools, videos, screenshots, unused brand variants, and generated submission evidence.

The source files were verified by SHA256 against the original at copy time. See `SOURCE_COPY_MANIFEST.json`. Inherited documentation describes the source edition and is not proof that this new copy has run or passed tests.

## Before running

The source requires Node.js 24 or newer. Dependencies have not been installed here. Inspect the scripts and then use `npm ci` in THIS directory. Establish fixture-only tests before provisioning real providers.

Configure a new environment and fresh local storage. Use distinct development ports if the old application is running. The inherited frontend/API defaults are 4310/4311; they have not been changed in this copy. The backend uses a `.data` directory relative to the working directory, so always start it from this new project root. Never point it at the original data folder.

Do not execute live probes, deploy contracts, run funded/provider calls, or use real wallets until the correct isolated configuration and applicable owner authorization are in place. No application server, wallet flow, provider call, or paid operation was run while preparing this copy.

Initialize a new Git repository here before implementation and use a separate future remote. The original repository and deployment remain unchanged.

## Implementation entry point

The runtime evidence comes from `Engine.view()` in `apps/api/src/engine.ts`. Its result combines restored checkpoint, live chain evidence, deterministic verdict, journal, and approved preference. Add an advisory analysis layer around that result; keep transaction preparation and signing permissions deterministic.

See `OPEN_SERV_BUILD_INSTRUCTIONS.md` for the exact file map, provider verification gates, UI requirements, evaluation, and acceptance criteria.

## OpenServ implementation status

The Recovery Copilot is implemented locally around the actual `Engine.view()` path. It uses separate, documented provider calls:

- Dolphin Network: `https://lighthouse.dphn.ai/run/text-v/v1`, model `deepseek-ai/DeepSeek-V4.1-Flash`, for evidence/history interpretation.
- SERV Reasoning: `https://inference-api.openserv.ai/v1`, model `gpt-5.4-mini`, for strict-schema recovery planning.

Provider smoke, a synthetic fixture analysis, and an isolated live testnet E2E flow now pass against both official endpoints. The E2E covers package/control deployment, proposal, successor mismatch and approval, acceptance, copilot ready/completed assessments, stale detection, counter, preference, memory isolation, and cancellation. Fixture tests, typecheck, and build pass; the broader 20–30 scenario evaluation is still pending. See `docs/openserv-evaluation.md`. The deterministic wallet/recovery path is unchanged and model output cannot grant signing permission.

This copy is isolated from the submitted Walrus edition: it uses a fresh local database (`.data/janus-openserv.sqlite`), a new record-signing key (`.data/openserv-writer-private.pem`), and `janus-openserv-record-*` memory namespaces. The existing Walrus Memory account is accessed only through the new OpenServ delegate credential. No Janus-sui record is modified or deleted. Session authentication is unchanged and `JANUS_SESSION_SECRET` is not required.

To enable providers locally:

```powershell
Copy-Item .env.example .env
# Fill DOLPHIN_API_KEY and SERV_API_KEY, set COPILOT_ENABLED=true.
npm run copilot:smoke
npm run dev:api
npm run dev:web
```

Without both keys, `/api/config` reports the copilot disabled and no evidence is sent. Further detail:

- `docs/openserv-integration.md` — verified routes, architecture, data boundary, API, validation, configuration.
- `docs/openserv-prior-work.md` — inherited Walrus work versus the new OpenServ contribution.
- `docs/openserv-evaluation.md` — executed results and the real-model evaluation still pending.
- `docs/openserv-demo.md` — demo scenarios and capture checklist.

## Demo video

A narrated demo from the isolated Sui testnet run is included at [`demo-delivery/Janus-OpenServ-Recovery-Copilot-Demo.mp4`](demo-delivery/Janus-OpenServ-Recovery-Copilot-Demo.mp4), with captions, script, description and poster in the same folder. Narration is synthetic (ElevenLabs); the footage is a real testnet run with disposable wallets, not a mocked success state.
