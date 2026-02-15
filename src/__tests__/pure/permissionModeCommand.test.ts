import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createDefaultChatState, type ChatState } from '../../domain/models.js'
import {
  askCommand,
  bypassCommand,
  planCommand,
} from '../../adapters/telegram/commands/permissionMode.js'

type StateStoreLike = {
  getChatState(chatId: number, threadId?: number): Promise<ChatState>
  saveChatState(chatId: number, state: ChatState, threadId?: number): Promise<void>
  withChatLock<T>(chatId: number, fn: () => Promise<T>): Promise<T>
}

function scopeKey(chatId: number, threadId?: number): string {
  return threadId === undefined ? String(chatId) : `${chatId}:${threadId}`
}

function createMemoryStateStore(): StateStoreLike {
  const states = new Map<string, ChatState>()

  return {
    async getChatState(chatId: number, threadId?: number): Promise<ChatState> {
      const key = scopeKey(chatId, threadId)
      const current = states.get(key)
      if (current) return current
      const fresh = createDefaultChatState()
      states.set(key, fresh)
      return fresh
    },
    async saveChatState(chatId: number, state: ChatState, threadId?: number): Promise<void> {
      states.set(scopeKey(chatId, threadId), state)
    },
    async withChatLock<T>(_chatId: number, fn: () => Promise<T>): Promise<T> {
      return fn()
    },
  }
}

function createCtx(opts?: {
  chatId?: number
  chatType?: 'private' | 'group' | 'supergroup'
  messageThreadId?: number
}) {
  const chatId = opts?.chatId ?? 100
  const chatType = opts?.chatType ?? 'private'

  return {
    chat: { id: chatId, type: chatType },
    message: {
      message_thread_id: opts?.messageThreadId,
      text: '/plan',
    },
    reply: mock(async (_text: string) => {}),
  } as any
}

describe('permissionMode command', () => {
  let store: StateStoreLike

  beforeEach(() => {
    store = createMemoryStateStore()
  })

  it('sets permission mode to plan and confirms in reply', async () => {
    const ctx = createCtx()

    await planCommand(store as any)(ctx)

    const chatState = await store.getChatState(100)
    expect(chatState.settings.permissionMode).toBe('plan')
    expect(ctx.reply).toHaveBeenCalledTimes(1)
    expect(ctx.reply.mock.calls[0][0]).toContain('plan')
  })

  it('sets permission mode to ask and confirms in reply', async () => {
    const ctx = createCtx()

    await askCommand(store as any)(ctx)

    const chatState = await store.getChatState(100)
    expect(chatState.settings.permissionMode).toBe('ask')
    expect(ctx.reply.mock.calls[0][0]).toContain('ask')
  })

  it('sets permission mode to bypass and confirms in reply', async () => {
    await askCommand(store as any)(createCtx())

    const ctx = createCtx()
    await bypassCommand(store as any)(ctx)

    const chatState = await store.getChatState(100)
    expect(chatState.settings.permissionMode).toBe('bypass')
    expect(ctx.reply.mock.calls[0][0]).toContain('bypass')
  })

  it('isolates permission mode per group thread', async () => {
    const chatId = 900
    await planCommand(store as any)(
      createCtx({ chatId, chatType: 'supergroup', messageThreadId: 11 }),
    )
    await askCommand(store as any)(
      createCtx({ chatId, chatType: 'supergroup', messageThreadId: 22 }),
    )

    const thread11 = await store.getChatState(chatId, 11)
    const thread22 = await store.getChatState(chatId, 22)

    expect(thread11.settings.permissionMode).toBe('plan')
    expect(thread22.settings.permissionMode).toBe('ask')
  })
})
