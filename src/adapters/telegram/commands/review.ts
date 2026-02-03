import type { Context } from 'grammy'
import type { createDebateFlow } from '../../../app/usecases/debateFlow.js'
import { logger } from '../../../shared/logger.js'

export function reviewCommand(debateFlow: ReturnType<typeof createDebateFlow>, botRole: 'writer' | 'reader' | 'standalone') {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    // Single initiator gate: only writer bot processes bare /review in groups
    const chatType = ctx.chat?.type
    const isGroup = chatType === 'group' || chatType === 'supergroup'

    if (isGroup) {
      const entities = ctx.message?.entities || []
      const commandEntity = entities.find(e => e.type === 'bot_command')
      const isAddressed = commandEntity && ctx.message?.text?.includes('@')

      if (!isAddressed && botRole !== 'writer') {
        logger.debug('review', `Ignoring bare /review in group (botRole=${botRole})`)
        return
      }
    }

    const target = ctx.match?.toString().trim()
    await debateFlow.startReview(chatId, target || undefined)
  }
}
