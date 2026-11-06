import { copilotConfigFromEnv } from '../packages/copilot/src/config.js';
import { analyzeRecovery } from '../packages/copilot/src/analyze.js';
import { DolphinProvider } from '../packages/copilot/src/dolphin.js';
import { ServProvider } from '../packages/copilot/src/serv.js';
import { buildRecoveryEvidence } from '../packages/copilot/src/evidence.js';
import { CopilotError, ProviderError } from '../packages/copilot/src/errors.js';
import { readyFixture } from '../tests/copilot/support.js';

const { config, capabilities } = copilotConfigFromEnv();
if (!config.enabled) {
  console.error(JSON.stringify({ ok: false, stage: 'configuration', reason: capabilities.reason }, null, 2));
  process.exitCode = 2;
} else {
  const setup = await readyFixture();
  try {
    const view = await setup.f.engine.view(setup.operationId, setup.successor);
    const evidence = buildRecoveryEvidence(view, setup.successor, { journalLimit: config.journalLimit });
    const result = await analyzeRecovery(evidence, {
      dolphin: new DolphinProvider(config.dolphin),
      serv: new ServProvider(config.serv),
      config,
    });
    console.log(JSON.stringify({
      ok: true,
      fixtureOnly: true,
      operationId: evidence.operationId,
      evidenceHash: evidence.evidenceHash,
      deterministicVerdict: evidence.verdict.code,
      provider: {
        dolphin: { model: result.provider.dolphin.model, requestId: result.provider.dolphin.requestId, latencyMs: result.provider.dolphin.latencyMs, usage: result.provider.dolphin.usage },
        serv: { model: result.provider.serv.model, requestId: result.provider.serv.requestId, latencyMs: result.provider.serv.latencyMs, usage: result.provider.serv.usage },
      },
      validation: { warnings: result.warnings, sourceCount: evidence.sources.length },
      assessment: result.assessment,
    }, null, 2));
  } catch (error) {
    const value = error instanceof CopilotError
      ? {
        ok: false, stage: 'analysis', code: error.code, message: error.message,
        provider: error instanceof ProviderError ? error.provider : null,
        httpStatus: error instanceof ProviderError ? error.httpStatus ?? null : null,
        reasons: 'reasons' in error ? error.reasons : [],
      }
      : { ok: false, stage: 'analysis', code: 'unexpected_error', message: 'Fixture provider analysis failed without exposing provider payloads' };
    console.error(JSON.stringify(value, null, 2));
    process.exitCode = 1;
  } finally {
    setup.f.db.close();
  }
}
