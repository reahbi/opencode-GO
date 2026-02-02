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

export class SessionNotFoundError extends AppError {
  constructor(sessionId: string) {
    super('SESSION_NOT_FOUND', `세션을 찾을 수 없습니다 (${sessionId}). /list 로 세션 목록을 확인하세요.`)
  }
}

export class OpenCodeConnectionError extends AppError {
  constructor(url: string, cause?: unknown) {
    super('OPENCODE_CONNECTION_ERROR', `OpenCode 서버에 연결할 수 없습니다 (${url}). 서버가 실행 중인지 확인하세요.`)
    if (cause) this.cause = cause
  }
}

export class OpenCodeApiError extends AppError {
  constructor(method: string, status: number, message: string) {
    super('OPENCODE_API_ERROR', `OpenCode API 오류 — ${method} (${status}): ${message}`)
  }
}


