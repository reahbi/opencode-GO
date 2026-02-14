import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { createRateLimitMiddleware } from '../../adapters/telegram/rateLimitMiddleware.js'
import { LIMITS } from '../../app/policies/limits.js'

// Minimal grammy Context/NextFunction stubs
function makeCtx(
  userId: number | undefined,
  opts: { hasMessage?: boolean; callbackData?: string } = {},
) {
  const hasMessage = opts.hasMessage ?? true
  return {
    from: userId != null ? { id: userId } : undefined,
    message: hasMessage ? { text: 'hello' } : undefined,
    callbackQuery: opts.callbackData
      ? { data: opts.callbackData, from: userId != null ? { id: userId } : undefined }
      : undefined,
    reply: mock(async (_text: string, _opts?: unknown) => {}),
    answerCallbackQuery: mock(async (_opts?: unknown) => {}),
  } as any
}

describe('rateLimitMiddleware', () => {
  let middleware: ReturnType<typeof createRateLimitMiddleware>

  beforeEach(() => {
    middleware = createRateLimitMiddleware()
  })

  it('allows messages under the rate limit', async () => {
    const ctx = makeCtx(100)
    const next = mock(async () => {})

    await middleware(ctx, next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('allows messages up to the limit', async () => {
    const next = mock(async () => {})

    for (let i = 0; i < LIMITS.RATE_LIMIT_PER_MINUTE; i++) {
      const ctx = makeCtx(200)
      await middleware(ctx, next)
    }

    expect(next).toHaveBeenCalledTimes(LIMITS.RATE_LIMIT_PER_MINUTE)
  })

  it('blocks messages exceeding the limit', async () => {
    const next = mock(async () => {})

    // Fill up the limit
    for (let i = 0; i < LIMITS.RATE_LIMIT_PER_MINUTE; i++) {
      await middleware(makeCtx(300), next)
    }

    // This one should be blocked
    const blockedCtx = makeCtx(300)
    await middleware(blockedCtx, next)

    expect(next).toHaveBeenCalledTimes(LIMITS.RATE_LIMIT_PER_MINUTE) // not +1
  })

  it('sends warning only once when rate limited', async () => {
    const next = mock(async () => {})

    // Fill up the limit
    for (let i = 0; i < LIMITS.RATE_LIMIT_PER_MINUTE; i++) {
      await middleware(makeCtx(400), next)
    }

    // First exceeded message — should warn
    const ctx1 = makeCtx(400)
    await middleware(ctx1, next)
    expect(ctx1.reply).toHaveBeenCalledTimes(1)

    // Second exceeded message — no second warning
    const ctx2 = makeCtx(400)
    await middleware(ctx2, next)
    expect(ctx2.reply).toHaveBeenCalledTimes(0)
  })

  it('passes through when ctx.from is undefined', async () => {
    const ctx = makeCtx(undefined)
    const next = mock(async () => {})

    await middleware(ctx, next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('passes through for non-message events (callbacks)', async () => {
    const ctx = makeCtx(500, { hasMessage: false, callbackData: 'q:int-1:0:0' })
    const next = mock(async () => {})

    await middleware(ctx, next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('blocks non-question callbacks exceeding callback limit', async () => {
    const next = mock(async () => {})

    for (let i = 0; i < LIMITS.RATE_LIMIT_CALLBACKS_PER_MINUTE; i++) {
      await middleware(makeCtx(750, { hasMessage: false, callbackData: 'git:refresh' }), next)
    }

    const blocked = makeCtx(750, { hasMessage: false, callbackData: 'git:refresh' })
    await middleware(blocked, next)

    expect(next).toHaveBeenCalledTimes(LIMITS.RATE_LIMIT_CALLBACKS_PER_MINUTE)
    expect(blocked.answerCallbackQuery).toHaveBeenCalledTimes(1)
  })

  it('tracks users independently', async () => {
    const next = mock(async () => {})

    // User A sends max messages
    for (let i = 0; i < LIMITS.RATE_LIMIT_PER_MINUTE; i++) {
      await middleware(makeCtx(600), next)
    }

    // User B should still be allowed
    const ctxB = makeCtx(601)
    await middleware(ctxB, next)
    expect(next).toHaveBeenCalledTimes(LIMITS.RATE_LIMIT_PER_MINUTE + 1)
  })

  it('warning message includes remaining seconds', async () => {
    const next = mock(async () => {})

    for (let i = 0; i < LIMITS.RATE_LIMIT_PER_MINUTE; i++) {
      await middleware(makeCtx(700), next)
    }

    const ctx = makeCtx(700)
    await middleware(ctx, next)

    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const callArgs = (ctx.reply as any).mock.calls[0]
    expect(callArgs[0]).toContain('Rate limit exceeded')
    expect(callArgs[0]).toMatch(/wait \d+s/)
  })
})
