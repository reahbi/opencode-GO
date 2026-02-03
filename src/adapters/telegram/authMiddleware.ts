import type { Context, NextFunction } from 'grammy'
import { logger } from '../../shared/logger.js'

export function createAuthMiddleware(allowedUserIds: number[]) {
  return async (ctx: Context, next: NextFunction) => {
    const userId = ctx.from?.id
    if (!userId) return

    if (allowedUserIds.includes(userId)) {
      return next()
    }

    // Allow /start to respond with setup instructions for unauthorized users
    const messageText = ctx.message?.text ?? ''
    if (messageText.startsWith('/start')) {
      await ctx.reply(
        `This is a private bot.\n\n` +
        `If you are the owner:\n` +
        `1. Add the Telegram ID below to ALLOWED_USER_IDS in .env\n` +
        `2. Restart the bot\n\n` +
        `Your Telegram ID: <code>${userId}</code>`,
        { parse_mode: 'HTML' },
      )
      return
    }

    logger.warn('telegram', `Unauthorized access attempt by user ${userId}`)
  }
}
