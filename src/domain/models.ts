/** Opaque handle for platform-specific message IDs */
export type OutputHandle = string

/** Reference to a session */
export interface SessionRef {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export type SessionStatus =
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'retry'; attempt: number; message: string; next: number }

/** Summary of an agent */
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
  /** Callback data for inline button action */
  callbackData?: string
  /** URL for link button (opens in browser) */
  url?: string
}

/** Pending interactive request (question) */
export interface PendingInteraction {
  interactionId: string
  sessionId: string
  requestId: string
  type: 'question'
  expiresAt: number
  messageHandle?: string
  questions?: Array<{ text: string; options: string[]; multiple?: boolean }>
  collectedAnswers?: (string[] | null)[]
  currentQuestionIndex?: number
  phase?: 'answering' | 'confirm'
  creatorUserId?: number
  directory?: string
}

/** Queued message for delivery when session becomes idle */
export interface QueuedMessage {
  text: string
  timestamp: number
  actorUserId?: number
}

export interface UserSettings {
  summaryMode: boolean
  summaryModel: { providerID: string; modelID: string } | null
  summaryThreshold: number
  outputMode: 'formatted' | 'raw'
  historyFormat: 'md' | 'html'
  historyLimit: number | null
  reviewMode?: boolean
  voiceMode: boolean
  voiceAutoMode: boolean
  voiceSummaryLength: number
  voiceSpeed: number
  voiceGender: 'female' | 'male'
  voiceLanguage: 'ko' | 'en'
  userExpertise: 'vibe' | 'developer' | 'beginner'
}

/** State for cloudflared tunnel */
export interface TunnelState {
  isActive: boolean
  url: string | null
  port: number
  startedAt: number
}

export interface LastAssistantResponse {
  content: string
  sessionId: string
  timestamp: number
}

export interface VoiceResponse {
  id: string
  content: string
  createdAt: number
  directory: string
}

export interface ChatState {
  activeProjectDirectory: string | null
  activeSessionId: string | null
  activeAgent: string | null
  customAgentId?: string | null
  lastPrompt: string | null
  pendingInteractions: PendingInteraction[]
  settings: UserSettings
  awaitingInput: 'threshold' | 'question' | 'histlimit' | 'debaterounds' | 'addbot_token' | 'addbot_project' | 'makeagent_describe' | 'makeagent_name' | 'makeagent_edit' | 'tunnel_port' | 'addhookbot_token' | 'addhookbot_chatid' | null
  awaitingInteractionId: string | null
  queuedMessages: QueuedMessage[]
  lastAssistantMessageId?: string
  redoAvailable?: boolean
  tunnelState?: TunnelState
  lastAssistantResponse?: LastAssistantResponse
  voiceResponses?: VoiceResponse[]
  /** Total cost accumulated in the current session (USD) */
  sessionCostUsd?: number
  /** Whether Extended Thinking was active in the last query */
  lastThinkingEnabled?: boolean
}

export function createDefaultUserSettings(): UserSettings {
  return {
    summaryMode: true,
    summaryModel: { providerID: 'google', modelID: 'antigravity-gemini-3-flash' },
    summaryThreshold: 3000,
    outputMode: 'formatted',
    historyFormat: 'html',
    historyLimit: null,
    voiceMode: false,
    voiceAutoMode: false,
    voiceSummaryLength: 800,
    voiceSpeed: 1.0,
    voiceGender: 'female',
    voiceLanguage: 'ko',
    userExpertise: 'developer',
  }
}

export function createDefaultChatState(): ChatState {
  return {
    activeProjectDirectory: null,
    activeSessionId: null,
    activeAgent: null,
    customAgentId: null,
    lastPrompt: null,
    pendingInteractions: [],
    settings: createDefaultUserSettings(),
    awaitingInput: null,
    awaitingInteractionId: null,
    queuedMessages: [],
    voiceResponses: [],
  }
}

export interface GroupSettings {
  debateRounds: number
}

export function createDefaultGroupSettings(): GroupSettings {
  return {
    debateRounds: 6,
  }
}

export interface BotRegistryEntry {
  instanceName: string
  botUsername: string
  botUserId?: number
  botRole: 'writer' | 'reader' | 'standalone'
  projectDir: string
  serverUrl: string
  lastSeen: number
  currentAgent?: string | null
}

export interface CustomAgent {
  id: string
  name: string
  description: string
  systemPrompt: string
  createdAt: number
  updatedAt: number
}

/** Image attachment for multimodal prompts */
export interface ImageAttachment {
  mime: string
  data: string // Base64 encoded data (without data URL prefix)
  filename?: string
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
