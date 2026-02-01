import type { OutputHandle, Button } from '../models.js'

export interface ChatOutputPort {
  sendText(chatId: number, text: string, parseMode?: string): Promise<OutputHandle>
  editText(chatId: number, handle: OutputHandle, text: string, parseMode?: string): Promise<void>
  sendFile(chatId: number, content: Buffer, filename: string, caption?: string): Promise<void>
  sendInteraction(chatId: number, text: string, buttons: Button[]): Promise<OutputHandle>
  sendTypingAction(chatId: number): Promise<void>
}
