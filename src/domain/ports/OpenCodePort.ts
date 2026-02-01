import type { SessionRef, AgentInfo } from '../models.js'
import type { AgentOutput } from '../events.js'
import type { EventHandler } from '../events.js'

export interface ModelInfo {
  providerID: string
  modelID: string
  name: string
}

export interface OpenCodePort {
  createSession(directory: string, title: string): Promise<SessionRef>
  getSession(sessionId: string, directory: string): Promise<SessionRef | null>
  listSessions(directory: string): Promise<SessionRef[]>
  deleteSession(sessionId: string, directory: string): Promise<void>
  sendPrompt(sessionId: string, directory: string, text: string, agent?: string): Promise<AgentOutput>
  sendPromptAsync(
    sessionId: string,
    directory: string,
    text: string,
    model?: { providerID: string; modelID: string },
  ): Promise<void>
  abortSession(sessionId: string, directory: string): Promise<void>
  listAgents(directory: string): Promise<AgentInfo[]>
  listModels(directory: string): Promise<ModelInfo[]>
  streamEvents(directory: string, handler: EventHandler, signal: AbortSignal): Promise<void>
  replyPermission(requestId: string, directory: string, response: 'once' | 'always' | 'reject'): Promise<void>
  replyQuestion(requestId: string, directory: string, answers: string[][]): Promise<void>
  rejectQuestion(requestId: string, directory: string): Promise<void>
  healthCheck(): Promise<boolean>
}
