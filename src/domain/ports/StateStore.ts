import type { ChatState } from '../models.js'

export interface StateStore {
  getChatState(chatId: number): Promise<ChatState>
  saveChatState(chatId: number, state: ChatState): Promise<void>
  withChatLock<T>(chatId: number, fn: () => Promise<T>): Promise<T>
}
