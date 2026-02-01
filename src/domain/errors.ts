/** Base class for all OpenCaddy domain errors */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotAuthorizedError extends AppError {
  constructor(userId: number) {
    super('NOT_AUTHORIZED', `User ${userId} is not authorized`)
  }
}

export class NoActiveSessionError extends AppError {
  constructor() {
    super('NO_ACTIVE_SESSION', 'No active session. Use /new to start one or /resume to continue.')
  }
}

export class NoActiveProjectError extends AppError {
  constructor() {
    super('NO_ACTIVE_PROJECT', 'No active project. Use /connect to select one.')
  }
}

export class SessionNotFoundError extends AppError {
  constructor(sessionId: string) {
    super('SESSION_NOT_FOUND', `Session ${sessionId} not found`)
  }
}

export class ProjectNotFoundError extends AppError {
  constructor(directory: string) {
    super('PROJECT_NOT_FOUND', `Project at ${directory} not found`)
  }
}

export class OpenCodeConnectionError extends AppError {
  constructor(url: string, cause?: unknown) {
    super('OPENCODE_CONNECTION_ERROR', `Cannot connect to OpenCode at ${url}`)
    if (cause) this.cause = cause
  }
}

export class OpenCodeApiError extends AppError {
  constructor(method: string, status: number, message: string) {
    super('OPENCODE_API_ERROR', `OpenCode ${method} failed (${status}): ${message}`)
  }
}

export class InteractionExpiredError extends AppError {
  constructor(interactionId: string) {
    super('INTERACTION_EXPIRED', `Interaction ${interactionId} has expired`)
  }
}

export class InteractionNotFoundError extends AppError {
  constructor(interactionId: string) {
    super('INTERACTION_NOT_FOUND', `Interaction ${interactionId} not found`)
  }
}
