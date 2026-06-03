// ─── Base ─────────────────────────────────────────────────────────────────────

export class OracleError extends Error {
  public readonly code: string;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = 'OracleError';
    this.code = code;
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

// ─── MCP ─────────────────────────────────────────────────────────────────────

export class MCPUnavailableError extends OracleError {
  public readonly serverName: string;

  constructor(serverName: string, cause?: unknown) {
    super(
      `MCP server "${serverName}" is unavailable`,
      'MCP_UNAVAILABLE',
      cause,
    );
    this.name = 'MCPUnavailableError';
    this.serverName = serverName;
  }
}

export class MCPTimeoutError extends OracleError {
  constructor(serverName: string, toolName: string) {
    super(
      `MCP tool "${toolName}" on server "${serverName}" timed out`,
      'MCP_TIMEOUT',
    );
    this.name = 'MCPTimeoutError';
  }
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

export class RateLimitError extends OracleError {
  public readonly resource: string;
  public readonly retryAfterMs: number;

  constructor(resource: string, retryAfterMs: number) {
    super(`Rate limit exceeded for "${resource}"`, 'RATE_LIMIT');
    this.name = 'RateLimitError';
    this.resource = resource;
    this.retryAfterMs = retryAfterMs;
  }
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

export class ScoringError extends OracleError {
  constructor(message: string, cause?: unknown) {
    super(message, 'SCORING_ERROR', cause);
    this.name = 'ScoringError';
  }
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

export class DeliveryError extends OracleError {
  public readonly recipient: string;
  public readonly attempt: number;

  constructor(recipient: string, attempt: number, cause?: unknown) {
    super(
      `Failed to deliver brief to "${recipient}" (attempt ${attempt})`,
      'DELIVERY_ERROR',
      cause,
    );
    this.name = 'DeliveryError';
    this.recipient = recipient;
    this.attempt = attempt;
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

export class ConfigError extends OracleError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}
