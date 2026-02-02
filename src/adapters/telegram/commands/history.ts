import type { Context } from 'grammy'

type SessionCommands = {
  exportSessionHistory(chatId: number, sessionId?: string): Promise<{ content: string; title: string; format: 'md' | 'html' } | null>
}

type ChatOutputPort = {
  sendText(chatId: number, text: string): Promise<unknown>
  sendFile(chatId: number, content: Buffer, filename: string, caption?: string): Promise<void>
}

export function historyCommand(sessionCommands: SessionCommands, output: ChatOutputPort) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    await output.sendText(chatId, '📝 대화내역을 생성 중...')

    const result = await sessionCommands.exportSessionHistory(chatId)
    if (!result) {
      await output.sendText(chatId, '대화내역이 없거나 활성 세션이 없습니다.')
      return
    }

    const buf = Buffer.from(result.content, 'utf-8')
    const safeTitle = result.title.replace(/[^a-zA-Z0-9가-힣_-]/g, '_').slice(0, 40)
    const ext = result.format
    await output.sendFile(chatId, buf, `${safeTitle}.${ext}`, `📜 ${result.title}`)
  }
}
