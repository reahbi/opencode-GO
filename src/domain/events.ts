import type { TokenUsage } from './ports/ClaudeAgentPort.js'

/** Discriminated union of all events from Claude Agent SDK query */
export type ClaudeEvent =
  | { type: 'text.delta'; sessionId: string; content: string }
  | { type: 'text.done'; sessionId: string; content: string; uuid: string }
  | { type: 'thinking'; sessionId: string; content: string }
  | { type: 'tool.use'; sessionId: string; toolName: string; input: unknown; toolUseId: string }
  | { type: 'tool.result'; sessionId: string; toolUseId: string; output: string }
  | { type: 'result'; sessionId: string; subtype: 'success' | 'error'; usage?: TokenUsage; costUsd?: number; errorMessage?: string }
  | { type: 'system.init'; sessionId: string; model: string; tools: string[] }
  | { type: 'error'; sessionId: string; message: string }

/** Handler callback for domain events */
export type EventHandler = (event: ClaudeEvent) => void | Promise<void>

// ── Legacy types kept for backward compatibility during migration ──

/** Question request detected from AskUserQuestion tool */
export interface QuestionAsked {
  requestId: string
  sessionId: string
  questions: QuestionInfo[]
}

export interface QuestionInfo {
  id: string
  text: string
  options?: string[]
  multiple?: boolean
}
