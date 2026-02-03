/** Completed agent output from a prompt */
export interface AgentOutput {
  sessionId: string
  parts: AgentOutputPart[]
}

export type AgentOutputPart =
  | { type: 'text'; content: string }
  | { type: 'tool'; tool: string; title: string; status: 'completed' | 'error' }

/** Permission request from OpenCode */
export interface PermissionAsked {
  requestId: string
  sessionId: string
  permission: string
  patterns: string[]
  title: string
}

/** Question request from OpenCode */
export interface QuestionAsked {
  requestId: string
  sessionId: string
  questions: QuestionInfo[]
}

export interface QuestionInfo {
  id: string
  text: string
  options?: string[]
}

/** Session became idle */
export interface SessionIdle {
  sessionId: string
}

/** Session is busy (actively processing) */
export interface SessionBusy {
  sessionId: string
}

/** Session is retrying after an error */
export interface SessionRetry {
  sessionId: string
  attempt: number
  message: string
  next: number
}

/** Session error */
export interface SessionError {
  sessionId: string
  error: string
}

/** Discriminated union of all domain events from OpenCode */
export interface MessageUpdated {
  sessionId: string
  messageId: string
  role: 'user' | 'assistant'
}

export type OpenCodeEvent =
  | { type: 'agent.output'; data: AgentOutput }
  | { type: 'permission.asked'; data: PermissionAsked }
  | { type: 'question.asked'; data: QuestionAsked }
  | { type: 'session.idle'; data: SessionIdle }
  | { type: 'session.busy'; data: SessionBusy }
  | { type: 'session.retry'; data: SessionRetry }
  | { type: 'session.error'; data: SessionError }
  | { type: 'message.updated'; data: MessageUpdated }
  | { type: 'message.part.updated'; data: { sessionId: string; partId: string; messageId: string; content: string; finished: boolean } }

/** Handler callback for domain events */
export type EventHandler = (event: OpenCodeEvent) => void | Promise<void>
