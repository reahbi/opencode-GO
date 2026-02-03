import type {
  ChatState,
  SessionRef,
  UserSettings,
  PendingInteraction,
  HistoryMessage,
  HistoryPart,
  BotRegistryEntry,
} from '../../domain/models.js'
import type {
  OpenCodeEvent,
  AgentOutput,
  PermissionAsked,
  QuestionAsked,
  QuestionInfo,
} from '../../domain/events.js'
import { createDefaultChatState, createDefaultUserSettings } from '../../domain/models.js'

export function buildChatState(overrides: Partial<ChatState> = {}): ChatState {
  const defaults = createDefaultChatState()
  return {
    ...defaults,
    ...overrides,
    settings: {
      ...createDefaultUserSettings(),
      ...overrides.settings,
    },
  }
}

export function buildSessionRef(overrides: Partial<SessionRef> = {}): SessionRef {
  const defaults: SessionRef = {
    id: 'ses-1',
    title: 'Test Session',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }

  return { ...defaults, ...overrides }
}

export function buildUserSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  const defaults = createDefaultUserSettings()
  return { ...defaults, ...overrides }
}

export function buildPendingInteraction(
  overrides: Partial<PendingInteraction> = {},
): PendingInteraction {
  const defaults: PendingInteraction = {
    interactionId: 'int-1',
    sessionId: 'ses-1',
    requestId: 'req-1',
    type: 'permission',
    expiresAt: Date.now() + 300000,
  }

  return { ...defaults, ...overrides }
}

export function buildAgentOutput(overrides: Partial<AgentOutput> = {}): AgentOutput {
  const defaults: AgentOutput = {
    sessionId: 'ses-1',
    parts: [{ type: 'text', content: 'test output' }],
  }

  return { ...defaults, ...overrides }
}

export function buildPermissionEvent(overrides: Partial<PermissionAsked> = {}): OpenCodeEvent {
  const defaults: PermissionAsked = {
    requestId: 'req-1',
    sessionId: 'ses-1',
    permission: 'read',
    patterns: [],
    title: 'Permission requested',
  }

  return {
    type: 'permission.asked',
    data: { ...defaults, ...overrides },
  }
}

export function buildQuestionEvent(overrides: Partial<QuestionAsked> = {}): OpenCodeEvent {
  const defaultQuestion: QuestionInfo = {
    id: 'q-1',
    text: 'Test question',
    options: ['Option A', 'Option B'],
  }

  const defaults: QuestionAsked = {
    requestId: 'req-1',
    sessionId: 'ses-1',
    questions: [defaultQuestion],
  }

  return {
    type: 'question.asked',
    data: {
      ...defaults,
      ...overrides,
      questions: overrides.questions ?? defaults.questions,
    },
  }
}

export function buildHistoryMessage(overrides: Partial<HistoryMessage> = {}): HistoryMessage {
  const defaultParts: HistoryPart[] = [{ type: 'text', text: 'test message' }]
  const defaults: HistoryMessage = {
    role: 'assistant',
    createdAt: Date.now(),
    parts: defaultParts,
  }

  return { ...defaults, ...overrides }
}

const botRegistryEntryDefaults = {
  instanceName: 'bot-1',
  botUsername: 'test-bot',
  botRole: 'standalone',
  projectDir: '/tmp/project',
  serverUrl: 'http://127.0.0.1:4096',
  lastSeen: Date.now(),
} satisfies BotRegistryEntry

export function buildBotRegistryEntry(
  overrides: Partial<BotRegistryEntry> = {},
): BotRegistryEntry {
  return { ...botRegistryEntryDefaults, ...overrides }
}
