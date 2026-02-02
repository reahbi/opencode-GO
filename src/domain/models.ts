/** Opaque handle for platform-specific message IDs */
export type OutputHandle = string

/** Reference to an OpenCode session */
export interface SessionRef {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

/** Summary of an OpenCode agent */
export interface AgentInfo {
  name: string
  description?: string
  mode: 'subagent' | 'primary' | 'all'
}

/** Reference to a registered project */
export interface ProjectRef {
  id: string
  name: string
  directory: string
}

/** Button for interactive prompts */
export interface Button {
  label: string
  callbackData: string
}

/** Pending interactive request (permission or question) */
export interface PendingInteraction {
  interactionId: string
  sessionId: string
  requestId: string
  type: 'permission' | 'question'
  expiresAt: number
}

export interface UserSettings {
  summaryMode: boolean
  summaryModel: { providerID: string; modelID: string } | null
  summaryThreshold: number
  outputMode: 'formatted' | 'raw'
}

export interface ChatState {
  activeProjectDirectory: string | null
  activeSessionId: string | null
  activeAgent: string | null
  lastPrompt: string | null
  pendingInteractions: PendingInteraction[]
  settings: UserSettings
  awaitingInput: 'threshold' | null
}

export function createDefaultUserSettings(): UserSettings {
  return {
    summaryMode: false,
    summaryModel: null,
    summaryThreshold: 6000,
    outputMode: 'formatted',
  }
}

export function createDefaultChatState(): ChatState {
  return {
    activeProjectDirectory: null,
    activeSessionId: null,
    activeAgent: null,
    lastPrompt: null,
    pendingInteractions: [],
    settings: createDefaultUserSettings(),
    awaitingInput: null,
  }
}
