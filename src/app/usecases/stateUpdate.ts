import type { ChatState } from '../../domain/models.js'
import type { StateStore } from '../../domain/ports/StateStore.js'

export async function updateChatState<T>(
  stateStore: StateStore,
  chatId: number,
  mutator: (state: ChatState) => Promise<T> | T,
  threadId?: number,
): Promise<T> {
  return stateStore.withChatLock(chatId, async () => {
    const state = await stateStore.getChatState(chatId, threadId)
    const result = await mutator(state)
    await stateStore.saveChatState(chatId, state, threadId)
    return result
  })
}
