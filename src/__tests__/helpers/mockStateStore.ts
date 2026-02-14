import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatState } from '../../domain/models.js'
import { createDefaultChatState } from '../../domain/models.js'
import { mock } from 'bun:test'

export function createMockStateStore(
  initialState: Partial<ChatState> = {},
): StateStore & { _store: Map<string, ChatState> } {
  const store = new Map<string, ChatState>()

  const getStateKey = (chatId: number, threadId?: number): string =>
    threadId ? `${chatId}:${threadId}` : String(chatId)

  const getChatState: StateStore['getChatState'] = mock(async (chatId, threadId) => {
    const existing = store.get(getStateKey(chatId, threadId))
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

  const saveChatState: StateStore['saveChatState'] = mock(async (chatId, state, threadId) => {
    store.set(getStateKey(chatId, threadId), state)
  })

  const withChatLock: StateStore['withChatLock'] = mock(async (_chatId, fn) => fn())

  return {
    getChatState,
    saveChatState,
    withChatLock,
    _store: store,
  }
}
