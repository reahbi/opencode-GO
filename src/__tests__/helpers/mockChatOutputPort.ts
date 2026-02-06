import type { ChatOutputPort } from '../../domain/ports/ChatOutputPort.js'
import type { OutputHandle, Button } from '../../domain/models.js'
import { mock } from 'bun:test'

export function createMockChatOutputPort(overrides: Partial<ChatOutputPort> = {}): ChatOutputPort {
  const sendText: ChatOutputPort['sendText'] = mock(() =>
    Promise.resolve<OutputHandle>('msg-1'),
  )

  const editText: ChatOutputPort['editText'] = mock(() => Promise.resolve())

  const sendFile: ChatOutputPort['sendFile'] = mock(() => Promise.resolve())

  const sendVoice: ChatOutputPort['sendVoice'] = mock(() => Promise.resolve())

  const sendInteraction: ChatOutputPort['sendInteraction'] = mock(
    (_chatId: number, _text: string, _buttons: Button[]) =>
      Promise.resolve<OutputHandle>('interaction-1'),
  )

  const editInteraction: ChatOutputPort['editInteraction'] = mock(() => Promise.resolve())

  const sendTypingAction: ChatOutputPort['sendTypingAction'] = mock(() => Promise.resolve())

  const defaults: ChatOutputPort = {
    sendText,
    editText,
    sendFile,
    sendVoice,
    sendInteraction,
    editInteraction,
    sendTypingAction,
  }

  return { ...defaults, ...overrides }
}
