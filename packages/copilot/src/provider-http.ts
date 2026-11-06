import { ProviderError } from './errors.js';
import type { ProviderConfig } from './config.js';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatJsonRequest = {
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  responseFormat?: unknown;
};

export type ChatResult = {
  content: string;
  finishReason: string | null;
  requestId: string | null;
  usage: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null };
  latencyMs: number;
  endpointHost: string;
  at: string;
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function usageValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function statusError(provider: 'dolphin' | 'serv', status: number): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('Provider authentication or access was rejected', provider, 'provider_auth', false, status);
  if (status === 402) return new ProviderError('Provider credit balance is insufficient', provider, 'provider_credits', false, status);
  if (status === 404) return new ProviderError('Provider endpoint or model is unavailable', provider, 'provider_model', false, status);
  if (status === 429) return new ProviderError('Provider rate limit reached', provider, 'provider_rate_limit', true, status);
  if (status >= 500) return new ProviderError('Provider is temporarily unavailable', provider, 'provider_unavailable', true, status);
  return new ProviderError('Provider rejected the request', provider, 'provider_request', false, status);
}

export async function chatCompletion(provider: 'dolphin' | 'serv', config: ProviderConfig, request: ChatJsonRequest): Promise<ChatResult> {
  const endpoint = `${config.baseUrl}/chat/completions`;
  const body = JSON.stringify({
    model: config.model,
    messages: request.messages,
    ...(provider === 'serv' ? { max_completion_tokens: request.maxTokens } : { max_tokens: request.maxTokens }),
    temperature: request.temperature ?? 0.1,
    ...(request.responseFormat ? { response_format: request.responseFormat } : {}),
  });

  let lastError: unknown;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw statusError(provider, response.status);
      let data: {
        id?: unknown;
        choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown; reasoning_content?: unknown } }>;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown; input_tokens?: unknown; output_tokens?: unknown };
      };
      try { data = JSON.parse(text); }
      catch { throw new ProviderError('Provider returned malformed JSON', provider, 'invalid_output'); }
      const choice = data.choices?.[0];
      const content = choice?.message?.content;
      const promptTokens = usageValue(data.usage?.prompt_tokens) ?? usageValue(data.usage?.input_tokens);
      const completionTokens = usageValue(data.usage?.completion_tokens) ?? usageValue(data.usage?.output_tokens);
      if (typeof content !== 'string' || !content.trim()) {
        const keys = choice?.message ? Object.keys(choice.message).join(',') : 'none';
        const reasoning = typeof choice?.message?.reasoning_content === 'string' ? `, reasoning_chars=${choice.message.reasoning_content.length}` : '';
        throw new ProviderError(
          `Provider returned an empty completion (finish_reason=${String(choice?.finish_reason ?? 'unknown')}, message_keys=${keys}, completion_tokens=${completionTokens ?? 'unknown'}${reasoning})`,
          provider,
          'invalid_output',
        );
      }
      return {
        content,
        finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
        requestId: typeof data.id === 'string' ? data.id.slice(0, 200) : null,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: usageValue(data.usage?.total_tokens) ?? (promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null),
        },
        latencyMs: Date.now() - started,
        endpointHost: new URL(config.baseUrl).host,
        at: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'invalid_output') throw error;
      if (error instanceof ProviderError) lastError = error;
      else if ((error as { name?: string })?.name === 'AbortError') lastError = new ProviderError('Provider request timed out', provider, 'provider_timeout');
      else lastError = new ProviderError('Provider network request failed', provider, 'provider_unavailable', true);
      const retryable = lastError instanceof ProviderError && lastError.retryable;
      if (!retryable || attempt >= config.maxRetries) throw lastError;
      await delay(400 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof ProviderError ? lastError : new ProviderError('Provider request failed', provider);
}

export function parseJsonContent(provider: 'dolphin' | 'serv', content: string): unknown {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) text = fenced[1].trim();
  try { return JSON.parse(text); } catch { /* try a balanced object below */ }

  // Models sometimes wrap JSON in a short explanation. Extract only a
  // complete, balanced object; truncated or prose-only output still fails.
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0, inString = false, escaped = false;
    for (let index = start; index < text.length; index++) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') { inString = true; continue; }
      if (character === '{') depth++;
      else if (character === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, index + 1)); } catch { break; }
        }
      }
    }
  }
  throw new ProviderError('Provider output is not valid JSON', provider, 'invalid_output');
}

export async function listDolphinModels(config: ProviderConfig): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: { authorization: `Bearer ${config.apiKey}`, accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw statusError('dolphin', response.status);
    const data = JSON.parse(await response.text()) as { data?: Array<{ id?: unknown }> };
    return (data.data ?? []).map(model => typeof model.id === 'string' ? model.id : '').filter(Boolean);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if ((error as { name?: string })?.name === 'AbortError') throw new ProviderError('Dolphin model listing timed out', 'dolphin', 'provider_timeout');
    throw new ProviderError('Dolphin model listing failed', 'dolphin', 'provider_unavailable');
  } finally {
    clearTimeout(timer);
  }
}
