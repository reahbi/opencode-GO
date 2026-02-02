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
  messageHandle?: string
  questions?: Array<{ text: string; options: string[] }>
  collectedAnswers?: (string[] | null)[]
  currentQuestionIndex?: number
  phase?: 'answering' | 'confirm'
}

export interface UserSettings {
  summaryMode: boolean
  summaryModel: { providerID: string; modelID: string } | null
  summaryThreshold: number
  outputMode: 'formatted' | 'raw'
  historyFormat: 'md' | 'html'
  historyLimit: number | null
}

export interface ChatState {
  activeProjectDirectory: string | null
  activeSessionId: string | null
  activeAgent: string | null
  lastPrompt: string | null
  pendingInteractions: PendingInteraction[]
  settings: UserSettings
  awaitingInput: 'threshold' | 'question' | 'histlimit' | null
  awaitingInteractionId: string | null
}

export function createDefaultUserSettings(): UserSettings {
  return {
    summaryMode: false,
    summaryModel: null,
    summaryThreshold: 6000,
    outputMode: 'formatted',
    historyFormat: 'html',
    historyLimit: null,
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
    awaitingInteractionId: null,
  }
}

/** A single message part for session history export */
export type HistoryPart =
  | { type: 'text'; text: string }
  | { type: 'tool'; tool: string; title: string; status: string }
  | { type: 'subtask'; description: string; agent: string }

/** A message in session history */
export interface HistoryMessage {
  role: 'user' | 'assistant'
  createdAt: number
  parts: HistoryPart[]
}
