import type { Context, NextFunction } from 'grammy'
import { logger } from '../../shared/logger.js'

export function createAuthMiddleware(allowedUserIds: number[]) {
  return async (ctx: Context, next: NextFunction) => {
    const userId = ctx.from?.id
    if (!userId) return

    if (allowedUserIds.includes(userId)) {
      return next()
    }

    logger.warn('telegram', `Unauthorized access attempt by user ${userId}`)
  }
}
