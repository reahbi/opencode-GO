import type { Context, NextFunction } from 'grammy'
import { logger } from '../../shared/logger.js'

export function createGroupMiddleware(botUsername: string, groupChatEnabled: boolean) {
  const normalizedBotUsername = botUsername.replace(/^@/, '').toLowerCase()

  return async (ctx: Context, next: NextFunction) => {
    if (ctx.callbackQuery) {
      return next()
    }

    const chatType = ctx.chat?.type
    if (chatType === 'private') {
      return next()
    }

    if (!groupChatEnabled) {
      logger.debug('group', 'Group chat disabled; ignoring update')
      return
    }

    if (chatType !== 'group' && chatType !== 'supergroup') {
      logger.debug('group', 'Non-group chat ignored')
      return
    }

    const message = ctx.message
    const text = message?.text
    const entities = message?.entities

    // Allow all slash commands through (broadcast to all bots)
    // e.g. "/new", "/abort", "/list" — grammy handles @suffix filtering
    if (text && entities?.some((e) => e.type === 'bot_command' && e.offset === 0)) {
      return next()
    }

    if (!text || !entities?.length) {
      logger.debug('group', 'Group message without entities ignored')
      return
    }

    const isTargeted = entities.some((entity) => {
      if (entity.type !== 'mention' && entity.type !== 'bot_command') return false
      const entityText = text.substring(entity.offset, entity.offset + entity.length).toLowerCase()

      if (entity.type === 'mention') {
        return entityText === `@${normalizedBotUsername}`
      }

      return entityText.endsWith(`@${normalizedBotUsername}`)
    })

    if (isTargeted) {
      return next()
    }

    logger.debug('group', 'Group message not targeted at bot; ignored')
  }
}
