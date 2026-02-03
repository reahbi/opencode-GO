import type { Context } from 'grammy'
import type { createDebateFlow } from '../../../app/usecases/debateFlow.js'
import { logger } from '../../../shared/logger.js'

export function debateCommand(debateFlow: ReturnType<typeof createDebateFlow>, botRole: 'writer' | 'reader' | 'standalone') {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const chatType = ctx.chat?.type
    const isGroup = chatType === 'group' || chatType === 'supergroup'

    if (isGroup) {
      const entities = ctx.message?.entities || []
      const commandEntity = entities.find(e => e.type === 'bot_command')
      const isAddressed = commandEntity && ctx.message?.text?.includes('@')

      if (!isAddressed && botRole !== 'writer') {
        logger.debug('debate', `Ignoring bare /debate in group (botRole=${botRole})`)
        return
      }
    }

    const input = ctx.match?.toString().trim()
    if (!input) {
      await ctx.reply('Usage: /debate [rounds] <topic>')
      return
    }

    let overrideRounds: number | undefined
    let topic = input
    const firstSpace = input.indexOf(' ')
    if (firstSpace > 0) {
      const maybeRounds = parseInt(input.slice(0, firstSpace), 10)
      if (Number.isFinite(maybeRounds) && maybeRounds > 0 && String(maybeRounds) === input.slice(0, firstSpace)) {
        overrideRounds = maybeRounds
        topic = input.slice(firstSpace + 1).trim()
      }
    }

    if (!topic) {
      await ctx.reply('Usage: /debate [rounds] <topic>')
      return
    }

    await debateFlow.startDebate(chatId, topic, overrideRounds)
  }
}
