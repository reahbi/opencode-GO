import type { Context } from 'grammy'

type SessionCommands = {
  exportSessionHistory(chatId: number, sessionId?: string, threadId?: number): Promise<{ content: string; title: string; format: 'md' | 'html' } | null>
}

type ChatOutputPort = {
  sendText(chatId: number, text: string): Promise<unknown>
  sendFile(chatId: number, content: Buffer, filename: string, caption?: string): Promise<void>
}

export function historyCommand(sessionCommands: SessionCommands, output: ChatOutputPort) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
    const threadId = isGroup ? ctx.message?.message_thread_id : undefined

    await output.sendText(chatId, '📝 Generating history...')

    const result = await sessionCommands.exportSessionHistory(chatId, undefined, threadId)
    if (!result) {
      await output.sendText(chatId, 'No history or no active session.')
      return
    }

    const buf = Buffer.from(result.content, 'utf-8')
    const safeTitle = result.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
    const ext = result.format
    await output.sendFile(chatId, buf, `${safeTitle}.${ext}`, `📜 ${result.title}`)
  }
}
