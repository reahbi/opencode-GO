import type { ClaudeEvent } from '../events.js'
import type { ImageAttachment } from '../models.js'

export interface ModelInfo {
  id: string
  name: string
}

export interface AgentDefinition {
  name: string
  description?: string
  systemPrompt?: string
}

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface QueryOptions {
  prompt: string
  sessionId?: string
  /** True when this is the first message in a new session (use sessionId, not resume) */
  isNewSession?: boolean
  cwd: string
  model?: string
  images?: ImageAttachment[]
  agents?: Record<string, AgentDefinition>
  mcpServers?: Record<string, McpServerConfig>
  maxBudgetUsd?: number
  maxThinkingTokens?: number
  systemPrompt?: string
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}

export interface QueryHandle {
  messages: AsyncGenerator<ClaudeEvent, void, unknown>
  abort(): void
  sessionId: string | null
  /** Rewind files to the state before the given message UUID. Returns true if successful. */
  rewindFiles?(uuid: string): Promise<boolean>
}

export interface ClaudeAgentPort {
  runQuery(options: QueryOptions): QueryHandle
  getSupportedModels(): Promise<ModelInfo[]>
}
