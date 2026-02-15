import { describe, expect, it, mock } from 'bun:test'
import { createDefaultChatState, createDefaultUserSettings } from '../../domain/models.js'
import { agentSubText, settingsCommand } from '../../adapters/telegram/commands/settings.js'
import { statusCommand } from '../../adapters/telegram/commands/status.js'
import { helpCommand } from '../../adapters/telegram/commands/help.js'

describe('Task 4 telegram command sync', () => {
  it('renders permission mode in settings agent submenu text', () => {
    const text = agentSubText(
      [{ name: 'claude-sonnet-4-5' }],
      'claude-sonnet-4-5',
      { ...createDefaultUserSettings(), permissionMode: 'plan' },
      'standalone',
    )

    expect(text).toContain('Permission Mode: <code>plan</code>')
  })

  it('shows permission mode in /status output', async () => {
    const chatState = createDefaultChatState()
    chatState.settings.permissionMode = 'ask'

    const state = {
      getChatState: mock(async () => chatState),
    }

    const reply = mock(async (_text: string) => {})
    const ctx = {
      chat: { id: 10, type: 'private' },
      message: {},
      reply,
    } as any

    await statusCommand(state as any)(ctx)

    expect(reply).toHaveBeenCalledTimes(1)
    expect(reply.mock.calls[0][0]).toContain('Permission mode: <code>ask</code>')
  })

  it('reads thread-scoped state in /settings render path for group chats', async () => {
    const threadState = createDefaultChatState()
    threadState.settings.permissionMode = 'ask'
    const getChatState = mock(async (_chatId: number, threadId?: number) => {
      expect(threadId).toBe(77)
      return threadState
    })

    const reply = mock(async (_text: string, _opts: unknown) => {})
    const ctx = {
      chat: { id: 10, type: 'supergroup' },
      message: { message_thread_id: 77 },
      reply,
    } as any

    await settingsCommand({ getChatState } as any)(ctx)

    expect(getChatState).toHaveBeenCalledTimes(1)
    expect(reply).toHaveBeenCalledTimes(1)
    expect(reply.mock.calls[0][0]).toContain('⚙️ Settings')
  })

  it('includes /plan /ask /bypass in /help output', async () => {
    const reply = mock(async (_text: string) => {})
    const ctx = { reply } as any

    await helpCommand()(ctx)

    const text = reply.mock.calls[0][0] as string
    expect(text).toContain('/plan')
    expect(text).toContain('/ask')
    expect(text).toContain('/bypass')
  })
})
