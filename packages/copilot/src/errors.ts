export class CopilotError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'copilot_error') {
    super(message);
    this.name = 'CopilotError';
  }
}

export class CopilotValidationError extends CopilotError {
  constructor(message: string, readonly reasons: string[]) {
    super(message, 502, 'invalid_output');
    this.name = 'CopilotValidationError';
  }
}

export class ProviderError extends CopilotError {
  constructor(message: string, readonly provider: 'dolphin' | 'serv', code = 'provider_unavailable', readonly retryable = false, readonly httpStatus?: number) {
    super(message, code === 'invalid_output' ? 502 : 503, code);
    this.name = 'ProviderError';
  }
}
