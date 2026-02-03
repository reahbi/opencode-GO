import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatState } from '../../domain/models.js'
import { createDefaultChatState } from '../../domain/models.js'
import { mock } from 'bun:test'

export function createMockStateStore(
  initialState: Partial<ChatState> = {},
): StateStore & { _store: Map<number, ChatState> } {
  const store = new Map<number, ChatState>()
  let defaultAgent: string | null = null

  const getChatState: StateStore['getChatState'] = mock(async (chatId) => {
    const existing = store.get(chatId)
    if (existing) {
      return existing
    }

    const base = createDefaultChatState()
    return {
      ...base,
      ...initialState,
      settings: {
        ...base.settings,
        ...initialState.settings,
      },
    }
  })

  const saveChatState: StateStore['saveChatState'] = mock(async (chatId, state) => {
    store.set(chatId, state)
  })

  const withChatLock: StateStore['withChatLock'] = mock(async (_chatId, fn) => fn())

  const getDefaultAgent: StateStore['getDefaultAgent'] = mock(async () => defaultAgent)

  const setDefaultAgent: StateStore['setDefaultAgent'] = mock(async (agent) => {
    defaultAgent = agent
  })

  return {
    getChatState,
    saveChatState,
    withChatLock,
    getDefaultAgent,
    setDefaultAgent,
    _store: store,
  }
}
