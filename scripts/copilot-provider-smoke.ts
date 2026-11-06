import { copilotConfigFromEnv } from '../packages/copilot/src/config.js';
import { DolphinProvider } from '../packages/copilot/src/dolphin.js';
import { ServProvider } from '../packages/copilot/src/serv.js';
import { CopilotError, ProviderError } from '../packages/copilot/src/errors.js';

const { config, capabilities } = copilotConfigFromEnv();
if (!config.enabled) {
  console.error(JSON.stringify({ ok: false, stage: 'configuration', reason: capabilities.reason }, null, 2));
  process.exitCode = 2;
} else {
  const dolphin = new DolphinProvider(config.dolphin);
  const serv = new ServProvider(config.serv);
  let stage = 'dolphin:models';
  try {
    const models = await dolphin.models();
    stage = 'dolphin:ping';
    const dolphinPing = await dolphin.ping();
    stage = 'serv:ping';
    const servPing = await serv.ping();
    console.log(JSON.stringify({
      ok: true,
      dolphin: {
        endpointHost: dolphinPing.meta.endpointHost,
        model: dolphinPing.meta.model,
        listedModel: models.includes(config.dolphin.model) ? config.dolphin.model : null,
        requestId: dolphinPing.meta.requestId,
        latencyMs: dolphinPing.meta.latencyMs,
        usage: dolphinPing.meta.usage,
        nonSensitiveReply: dolphinPing.content.slice(0, 120),
      },
      serv: {
        endpointHost: servPing.meta.endpointHost,
        model: servPing.meta.model,
        requestId: servPing.meta.requestId,
        latencyMs: servPing.meta.latencyMs,
        usage: servPing.meta.usage,
        nonSensitiveReply: servPing.content.slice(0, 120),
      },
    }, null, 2));
  } catch (error) {
    const value = error instanceof CopilotError
      ? {
        ok: false, stage, code: error.code, message: error.message,
        provider: error instanceof ProviderError ? error.provider : null,
        httpStatus: error instanceof ProviderError ? error.httpStatus ?? null : null,
      }
      : { ok: false, stage, code: 'unexpected_error', message: 'Provider smoke test failed without exposing provider payloads' };
    console.error(JSON.stringify(value, null, 2));
    process.exitCode = 1;
  }
}
