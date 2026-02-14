/** Base class for all Claude-Go domain errors */
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

export class QueryError extends AppError {
  constructor(message: string, cause?: unknown) {
    super('QUERY_ERROR', message)
    if (cause) this.cause = cause
  }
}

export class QueryAbortedError extends AppError {
  constructor() {
    super('QUERY_ABORTED', 'Query was aborted by user.')
  }
}


