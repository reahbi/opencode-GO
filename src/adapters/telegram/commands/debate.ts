import type { Context } from 'grammy'
import type { createDebateFlow } from '../../../app/usecases/debateFlow.js'

export function debateCommand(debateFlow: ReturnType<typeof createDebateFlow>) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const topic = ctx.match?.toString().trim()
    if (!topic) {
      await ctx.reply('사용법: /debate <주제>')
      return
    }
    await debateFlow.startDebate(chatId, topic)
  }
}
