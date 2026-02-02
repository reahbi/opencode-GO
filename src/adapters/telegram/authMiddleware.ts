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
        `이 봇은 비공개 봇입니다.\n\n` +
        `봇 소유자라면:\n` +
        `1. 아래 Telegram ID를 .env의 ALLOWED_USER_IDS에 추가하세요\n` +
        `2. 봇을 재시작하세요\n\n` +
        `당신의 Telegram ID: <code>${userId}</code>`,
        { parse_mode: 'HTML' },
      )
      return
    }

    logger.warn('telegram', `Unauthorized access attempt by user ${userId}`)
  }
}
