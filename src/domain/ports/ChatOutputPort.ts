import type { OutputHandle, Button } from '../models.js'

export interface ChatOutputPort {
  sendText(chatId: number, text: string, parseMode?: string): Promise<OutputHandle>
  editText(chatId: number, handle: OutputHandle, text: string, parseMode?: string): Promise<void>
  sendFile(chatId: number, content: Uint8Array, filename: string, caption?: string): Promise<void>
  sendAudio(chatId: number, audio: Uint8Array, filename: string, caption?: string): Promise<void>
  sendInteraction(chatId: number, text: string, buttons: Button[]): Promise<OutputHandle>
  editInteraction(chatId: number, handle: OutputHandle, text: string, buttons: Button[]): Promise<void>
  sendTypingAction(chatId: number): Promise<void>
}
