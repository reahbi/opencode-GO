/** Base class for all OpenCode-Go domain errors */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class SessionNotFoundError extends AppError {
  constructor(sessionId: string) {
    super('SESSION_NOT_FOUND', `Session not found (${sessionId}). Use /list to view available sessions.`)
  }
}

export class OpenCodeConnectionError extends AppError {
  constructor(url: string, cause?: unknown) {
    super('OPENCODE_CONNECTION_ERROR', `Cannot connect to OpenCode server (${url}). Please check if the server is running.`)
    if (cause) this.cause = cause
  }
}

export class OpenCodeApiError extends AppError {
  constructor(method: string, status: number, message: string) {
    super('OPENCODE_API_ERROR', `OpenCode API error — ${method} (${status}): ${message}`)
  }
}


