import type { Context, NextFunction } from 'grammy'
import { LIMITS } from '../../app/policies/limits.js'

interface RateLimitEntry {
  count: number
  resetAt: number
  warned: boolean
}

export function createRateLimitMiddleware() {
  const messageLimits = new Map<number, RateLimitEntry>()
  const callbackLimits = new Map<number, RateLimitEntry>()

  // Cleanup old entries every 5 minutes
  const cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [userId, entry] of messageLimits) {
      if (now > entry.resetAt) {
        messageLimits.delete(userId)
      }
    }
    for (const [userId, entry] of callbackLimits) {
      if (now > entry.resetAt) {
        callbackLimits.delete(userId)
      }
    }
  }, 5 * 60_000)
  cleanupTimer.unref()

  function getOrCreateEntry(
    bucket: Map<number, RateLimitEntry>,
    userId: number,
    now: number,
  ): RateLimitEntry {
    let entry = bucket.get(userId)
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + LIMITS.RATE_LIMIT_COOLDOWN_MS, warned: false }
      bucket.set(userId, entry)
    }
    return entry
  }

  return async (ctx: Context, next: NextFunction) => {
    const userId = ctx.from?.id
    if (!userId) return next()

    const now = Date.now()

    if (ctx.callbackQuery) {
      const callbackData = ctx.callbackQuery.data ?? ''
      if (callbackData.startsWith('q:')) {
        return next()
      }

      const entry = getOrCreateEntry(callbackLimits, userId, now)
      entry.count++

      if (entry.count > LIMITS.RATE_LIMIT_CALLBACKS_PER_MINUTE) {
        if (!entry.warned) {
          entry.warned = true
          const remaining = Math.ceil((entry.resetAt - now) / 1000)
          await ctx.answerCallbackQuery({ text: `Rate limit exceeded. Wait ${remaining}s.` }).catch(() => {})
        }
        return
      }

      return next()
    }

    if (!ctx.message) return next()

    const entry = getOrCreateEntry(messageLimits, userId, now)
    entry.count++

    if (entry.count > LIMITS.RATE_LIMIT_PER_MINUTE) {
      if (!entry.warned) {
        entry.warned = true
        const remaining = Math.ceil((entry.resetAt - now) / 1000)
        await ctx.reply(`⚠️ Rate limit exceeded. Please wait ${remaining}s.`, { parse_mode: 'HTML' })
      }
      return
    }

    return next()
  }
}
