import { PROMPT_VERSION } from './schemas.js';

export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
};

export type CopilotConfig = {
  enabled: boolean;
  disabledReason: string | null;
  dolphin: ProviderConfig;
  serv: ProviderConfig;
  maxOutputTokens: number;
  maxPromptChars: number;
  maxJobsPerActorPerHour: number;
  journalLimit: number;
};

export type CopilotCapabilities = {
  enabled: boolean;
  reason: string | null;
  provider: string;
  dolphinModel: string;
  servModel: string;
  dolphinEndpointHost: string;
  servEndpointHost: string;
  promptVersion: string;
  disclosure: string;
};

const DOLPHIN_BASE_URL = 'https://lighthouse.dphn.ai/run/text-v/v1';
const SERV_BASE_URL = 'https://inference-api.openserv.ai/v1';
const DOLPHIN_MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash';
const SERV_MODEL = 'gpt-5.4-mini';

const integer = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

function checkedEndpoint(raw: string, official: string, allowCustom: boolean): { url?: URL; reason?: string } {
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash) return { reason: 'Provider URL must not include credentials, query parameters, or fragments' };
    if (url.protocol !== 'https:') return { reason: 'Provider URL must use HTTPS' };
    if (url.port && url.port !== '443') return { reason: 'Provider URL must use the default HTTPS port' };
    const canonical = new URL(official);
    if (!allowCustom && (url.hostname !== canonical.hostname || url.pathname.replace(/\/$/, '') !== canonical.pathname.replace(/\/$/, ''))) {
      return { reason: `Provider URL must match the official route ${canonical.hostname}${canonical.pathname}` };
    }
    return { url };
  } catch {
    return { reason: 'Provider URL is invalid' };
  }
}

export function copilotConfigFromEnv(env: NodeJS.ProcessEnv = process.env): { config: CopilotConfig; capabilities: CopilotCapabilities } {
  const flag = env.COPILOT_ENABLED === 'true';
  const allowCustom = env.COPILOT_ALLOW_CUSTOM_ENDPOINTS === 'true';
  const dolphinKey = env.DOLPHIN_API_KEY?.trim() ?? '';
  const servKey = env.SERV_API_KEY?.trim() ?? '';
  const dolphinEndpoint = checkedEndpoint(env.DOLPHIN_BASE_URL?.trim() || DOLPHIN_BASE_URL, DOLPHIN_BASE_URL, allowCustom);
  const servEndpoint = checkedEndpoint(env.SERV_BASE_URL?.trim() || SERV_BASE_URL, SERV_BASE_URL, allowCustom);

  let disabledReason: string | null = null;
  if (!flag) disabledReason = 'COPILOT_ENABLED is not set to true';
  else if (!dolphinKey) disabledReason = 'DOLPHIN_API_KEY is not configured';
  else if (!servKey) disabledReason = 'SERV_API_KEY is not configured';
  else if (!dolphinEndpoint.url) disabledReason = `Dolphin endpoint rejected: ${dolphinEndpoint.reason}`;
  else if (!servEndpoint.url) disabledReason = `SERV endpoint rejected: ${servEndpoint.reason}`;

  const dolphin: ProviderConfig = {
    baseUrl: (dolphinEndpoint.url?.toString() ?? DOLPHIN_BASE_URL).replace(/\/$/, ''),
    apiKey: dolphinKey,
    model: env.DOLPHIN_MODEL?.trim() || DOLPHIN_MODEL,
    timeoutMs: integer(env.COPILOT_PROVIDER_TIMEOUT_MS, 60_000, 2_000, 60_000),
    maxRetries: integer(env.COPILOT_MAX_PROVIDER_RETRIES, 1, 0, 2),
  };
  const serv: ProviderConfig = {
    baseUrl: (servEndpoint.url?.toString() ?? SERV_BASE_URL).replace(/\/$/, ''),
    apiKey: servKey,
    model: env.SERV_MODEL?.trim() || SERV_MODEL,
    timeoutMs: integer(env.COPILOT_PROVIDER_TIMEOUT_MS, 60_000, 2_000, 60_000),
    maxRetries: integer(env.COPILOT_MAX_PROVIDER_RETRIES, 1, 0, 2),
  };
  const config: CopilotConfig = {
    enabled: disabledReason === null,
    disabledReason,
    dolphin,
    serv,
    maxOutputTokens: integer(env.COPILOT_MAX_OUTPUT_TOKENS, 4000, 200, 4000),
    maxPromptChars: integer(env.COPILOT_MAX_PROMPT_CHARS, 40_000, 4_000, 120_000),
    maxJobsPerActorPerHour: integer(env.COPILOT_MAX_JOBS_PER_ACTOR_PER_HOUR, 10, 1, 100),
    journalLimit: integer(env.COPILOT_MAX_JOURNAL_ENTRIES, 20, 0, 50),
  };
  const capabilities: CopilotCapabilities = {
    enabled: config.enabled,
    reason: disabledReason,
    provider: 'Dolphin Network + SERV Reasoning',
    dolphinModel: dolphin.model,
    servModel: serv.model,
    dolphinEndpointHost: dolphinEndpoint.url?.host ?? new URL(DOLPHIN_BASE_URL).host,
    servEndpointHost: servEndpoint.url?.host ?? new URL(SERV_BASE_URL).host,
    promptVersion: PROMPT_VERSION,
    disclosure: 'Janus sends a minimized, source-labeled evidence bundle to Dolphin Network for history interpretation and to SERV Reasoning for planning. It excludes wallet keys, sessions, unsigned transaction bytes, raw memory envelopes, and provider credentials. This is advisory only; wallet review and every deterministic check remain mandatory.',
  };
  return { config, capabilities };
}

export function disabledCapabilities(reason = 'Recovery Copilot is not configured'): CopilotCapabilities {
  return {
    enabled: false,
    reason,
    provider: 'Dolphin Network + SERV Reasoning',
    dolphinModel: DOLPHIN_MODEL,
    servModel: SERV_MODEL,
    dolphinEndpointHost: new URL(DOLPHIN_BASE_URL).host,
    servEndpointHost: new URL(SERV_BASE_URL).host,
    promptVersion: PROMPT_VERSION,
    disclosure: 'Recovery Copilot is disabled. No operation evidence is sent to model providers.',
  };
}
