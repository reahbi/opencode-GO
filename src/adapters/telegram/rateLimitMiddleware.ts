import type { Context, NextFunction } from 'grammy'
import { LIMITS } from '../../app/policies/limits.js'

interface RateLimitEntry {
  count: number
  resetAt: number
  warned: boolean
}

export function createRateLimitMiddleware() {
  const limits = new Map<number, RateLimitEntry>()

  // Cleanup old entries every 5 minutes
  setInterval(() => {
    const now = Date.now()
    for (const [userId, entry] of limits) {
      if (now > entry.resetAt) {
        limits.delete(userId)
      }
    }
  }, 5 * 60_000)

  return async (ctx: Context, next: NextFunction) => {
    const userId = ctx.from?.id
    if (!userId) return next()

    // Only rate-limit message events (not callbacks, etc.)
    if (!ctx.message) return next()

    const now = Date.now()
    let entry = limits.get(userId)

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + LIMITS.RATE_LIMIT_COOLDOWN_MS, warned: false }
      limits.set(userId, entry)
    }

    entry.count++

    if (entry.count > LIMITS.RATE_LIMIT_PER_MINUTE) {
      if (!entry.warned) {
        entry.warned = true
        const remaining = Math.ceil((entry.resetAt - now) / 1000)
        await ctx.reply(`⚠️ Rate limit exceeded. Please wait ${remaining}s.`, { parse_mode: 'HTML' })
      }
      return // Drop the message
    }

    return next()
  }
}
