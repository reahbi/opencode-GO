import type { Context } from 'grammy'
import type { createDebateFlow } from '../../../app/usecases/debateFlow.js'

export function reviewCommand(debateFlow: ReturnType<typeof createDebateFlow>) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const target = ctx.match?.toString().trim()
    await debateFlow.startReview(chatId, target || undefined)
  }
}
