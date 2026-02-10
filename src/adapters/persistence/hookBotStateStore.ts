import type { StateStore } from '../../domain/ports/StateStore.js'
import type { ChatState } from '../../domain/models.js'
import { createDefaultChatState } from '../../domain/models.js'

export function createHookBotStateStore(): StateStore {
  const states = new Map<number, ChatState>()
  const locks = new Map<number, Promise<void>>()

  return {
    async getChatState(chatId: number): Promise<ChatState> {
      const existing = states.get(chatId)
      if (existing) return structuredClone(existing)
      return createDefaultChatState()
    },

    async saveChatState(chatId: number, state: ChatState): Promise<void> {
      states.set(chatId, structuredClone(state))
    },

    async withChatLock<T>(chatId: number, fn: () => Promise<T>): Promise<T> {
      const previous = locks.get(chatId) || Promise.resolve()

      const current = (async () => {
        await previous
        return await fn()
      })()

      locks.set(chatId, current.then(() => undefined, () => undefined))

      return current
    },
  }
}
