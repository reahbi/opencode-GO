import { Bot, InlineKeyboard, InputFile } from 'grammy'
import type { Context } from 'grammy'
import type { HookNotificationPort } from '../../domain/ports/HookNotificationPort.js'
import type { HookNotification, HookBotConfig } from '../../domain/hookBotTypes.js'
import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import { logger } from '../../shared/logger.js'
import { escapeHtml, sanitizeTelegramHtml, stripHtml } from '../../shared/formatResponse.js'
import { routeDelivery } from '../../app/policies/deliveryRouter.js'
import { structuralExtract } from '../../shared/structuralExtract.js'
import { LIMITS } from '../../app/policies/limits.js'

type BotInstance = Bot<Context>

// ── Bot Factory ──────────────────────────────────────────────

export function createHookBot(token: string): BotInstance {
  const bot = new Bot<Context>(token)

  bot.api.config.use((prev, method, payload, signal) => {
    if (!('parse_mode' in payload) || payload.parse_mode === undefined) {
      (payload as Record<string, unknown>).parse_mode = 'HTML'
    }
    return prev(method, payload, signal)
  })

  return bot
}

// ── Request Tracking ─────────────────────────────────────────

interface TrackedRequest {
  directory: string
  projectIndex: number
  timer: ReturnType<typeof setTimeout>
}

const requestMap = new Map<string, TrackedRequest>()

function trackRequest(requestId: string, directory: string, projectIndex: number): void {
  const existing = requestMap.get(requestId)
  if (existing) clearTimeout(existing.timer)

  const timer = setTimeout(() => {
    requestMap.delete(requestId)
  }, LIMITS.INTERACTION_TTL_MS)

  requestMap.set(requestId, { directory, projectIndex, timer })
}

function getTrackedRequest(requestId: string): TrackedRequest | undefined {
  return requestMap.get(requestId)
}

function removeTrackedRequest(requestId: string): void {
  const existing = requestMap.get(requestId)
  if (existing) {
    clearTimeout(existing.timer)
    requestMap.delete(requestId)
  }
}

// ── Duration Formatting ──────────────────────────────────────

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  const remainingMins = minutes % 60
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`
}

// ── Notification Adapter ─────────────────────────────────────

export function createHookBotNotificationAdapter(
  bot: BotInstance,
  chatId: number,
  openCode: OpenCodePort,
  config: HookBotConfig,
): HookNotificationPort {

  // ── Delivery helpers (mirrors sessionWatcher pattern) ──────

  async function sendText(text: string, parseMode?: string): Promise<void> {
    await bot.api.sendMessage(chatId, text, parseMode ? { parse_mode: parseMode as 'HTML' } : {})
  }

  async function sendFile(content: Uint8Array, filename: string, caption?: string): Promise<void> {
    const file = new InputFile(Buffer.from(content), filename)
    await bot.api.sendDocument(chatId, file, { caption })
  }

  async function deliverFormatted(content: string): Promise<void> {
    const plan = routeDelivery(content)
    switch (plan.strategy) {
      case 'inline':
        await sendText(plan.messages![0], 'MarkdownV2')
        break
      case 'chunk': {
        const msgs = plan.messages!
        for (const msg of msgs) {
          await sendText(msg, 'MarkdownV2')
        }
        break
      }
      case 'file': {
        const preview = structuralExtract(content).slice(0, 2000)
        await sendText(preview + '\n\n<i>... (full response attached)</i>', 'HTML')
        await sendFile(Buffer.from(plan.fileContent!, 'utf-8'), 'response.md', 'Full response attached.')
        break
      }
    }
  }

  async function deliverSafe(content: string): Promise<void> {
    try {
      await deliverFormatted(content)
      return
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : ''
      if (!errMsg.includes("can't parse entities") && !errMsg.includes('MESSAGE_TOO_LONG')) {
        throw err
      }
      logger.warn('hookbot', `Delivery failed (${errMsg.slice(0, 80)}), forcing file delivery`)
    }

    const preview = structuralExtract(content).slice(0, 2000)
    await sendText(preview + '\n\n<i>... (full response attached)</i>', 'HTML')
    await sendFile(Buffer.from(content, 'utf-8'), 'response.md', 'Full response attached.')
  }

  // ── Notification dispatch ──────────────────────────────────

  async function notifyCompletion(n: Extract<HookNotification, { type: 'completion' }>): Promise<void> {
    const header = `✅ <b>Session completed</b>\n📁 ${escapeHtml(n.projectName)}${n.sessionTitle ? `\n📝 ${escapeHtml(n.sessionTitle)}` : ''}\n⏱ ${formatDuration(n.duration)}`
    await sendText(header, 'HTML')

    if (n.lastMessage) {
      await deliverSafe(n.lastMessage)
    }
  }

  async function notifyStall(n: Extract<HookNotification, { type: 'stall' }>): Promise<void> {
    const text = `⚠️ Session stalled in ${escapeHtml(n.projectName)}\nSession: <code>${escapeHtml(n.sessionId)}</code>\nInactive for ${formatDuration(n.inactiveDuration)}`
    await sendText(text, 'HTML')
  }

  async function notifyError(n: Extract<HookNotification, { type: 'error' }>): Promise<void> {
    const text = `❌ Session error in ${escapeHtml(n.projectName)}\nSession: <code>${escapeHtml(n.sessionId)}</code>\nError: ${escapeHtml(n.error)}`
    await sendText(text, 'HTML')
  }

  async function notifyPermission(n: Extract<HookNotification, { type: 'permission' }>): Promise<void> {
    const projectIndex = config.projects.findIndex(p => p.directory === n.directory)
    trackRequest(n.requestId, n.directory, projectIndex)

    const patternsText = n.patterns.length > 0 ? n.patterns.map(p => escapeHtml(p)).join(', ') : 'N/A'
    const text = `🔐 Permission requested\n📁 ${escapeHtml(n.projectName)}\n🔧 ${escapeHtml(n.title)}\nPatterns: ${patternsText}`

    const keyboard = new InlineKeyboard()
      .text('✅ Once', `hp:${projectIndex}:${n.requestId}:once`)
      .text('✅ Always', `hp:${projectIndex}:${n.requestId}:always`)
      .text('❌ Reject', `hp:${projectIndex}:${n.requestId}:reject`)

    await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard })
  }

  async function notifyQuestion(n: Extract<HookNotification, { type: 'question' }>): Promise<void> {
    const projectIndex = config.projects.findIndex(p => p.directory === n.directory)
    trackRequest(n.requestId, n.directory, projectIndex)

    if (n.questions.length > 1) {
      const text = `⚠️ Multi-question request — please respond from your main bot\n📁 ${escapeHtml(n.projectName)}`
      await sendText(text, 'HTML')
      return
    }

    const q = n.questions[0]
    const text = `❓ Question from AI\n📁 ${escapeHtml(n.projectName)}\n${escapeHtml(q.text)}`

    if (!q.options || q.options.length === 0) {
      await sendText(text + '\n\n💬 Reply from your main bot for this question', 'HTML')
      return
    }

    const keyboard = new InlineKeyboard()
    for (let i = 0; i < q.options.length; i++) {
      keyboard.text(q.options[i], `hq:${projectIndex}:${n.requestId}:0:${i}`).row()
    }

    await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard })
  }

  // ── Port implementation ────────────────────────────────────

  return {
    async notify(notification: HookNotification): Promise<void> {
      try {
        switch (notification.type) {
          case 'completion':
            await notifyCompletion(notification)
            break
          case 'stall':
            await notifyStall(notification)
            break
          case 'error':
            await notifyError(notification)
            break
          case 'permission':
            await notifyPermission(notification)
            break
          case 'question':
            await notifyQuestion(notification)
            break
        }
      } catch (err) {
        logger.error('hookbot', `Failed to deliver ${notification.type} notification: ${err instanceof Error ? err.message : 'unknown'}`)
      }
    },
  }
}

// ── Auth Guard Middleware ─────────────────────────────────────

export function createHookBotAuthGuard(configuredChatId: number) {
  return async (ctx: Context, next: () => Promise<void>) => {
    if (ctx.chat?.id !== configuredChatId) return
    await next()
  }
}

// ── Callback Handlers ────────────────────────────────────────

export function registerHookBotHandlers(
  bot: BotInstance,
  openCode: OpenCodePort,
  config: HookBotConfig,
): void {
  // Permission callback: hp:{projectIdx}:{requestId}:{response}
  bot.callbackQuery(/^hp:/, async (ctx) => {
    const data = ctx.callbackQuery.data
    const parts = data.split(':')
    if (parts.length < 4) {
      await ctx.answerCallbackQuery('⚠️ Invalid data')
      return
    }

    const requestId = parts[2]
    const response = parts[3] as 'once' | 'always' | 'reject'

    if (!['once', 'always', 'reject'].includes(response)) {
      await ctx.answerCallbackQuery('⚠️ Invalid response')
      return
    }

    const tracked = getTrackedRequest(requestId)
    if (!tracked) {
      await ctx.answerCallbackQuery('⏳ Expired')
      try {
        await ctx.editMessageText('⏳ Request expired')
      } catch { /* ignore edit failures */ }
      return
    }

    try {
      await openCode.replyPermission(requestId, tracked.directory, response)
      removeTrackedRequest(requestId)

      const responseLabel = response === 'once' ? '✅ Allowed once' : response === 'always' ? '✅ Allowed always' : '❌ Rejected'
      await ctx.answerCallbackQuery('✅ Sent')
      try {
        const originalText = ctx.callbackQuery.message?.text ?? ''
        await ctx.editMessageText(`${originalText}\n\n<b>${responseLabel}</b>`, { parse_mode: 'HTML' })
      } catch { /* ignore edit failures */ }
    } catch (err) {
      logger.warn('hookbot', `Permission reply failed: ${err instanceof Error ? err.message : 'unknown'}`)
      removeTrackedRequest(requestId)
      await ctx.answerCallbackQuery('⚠️ Already answered')
      try {
        const originalText = ctx.callbackQuery.message?.text ?? ''
        await ctx.editMessageText(`${originalText}\n\n<i>Answered elsewhere</i>`, { parse_mode: 'HTML' })
      } catch { /* ignore edit failures */ }
    }
  })

  // Question callback: hq:{projectIdx}:{requestId}:{qIdx}:{ansIdx}
  bot.callbackQuery(/^hq:/, async (ctx) => {
    const data = ctx.callbackQuery.data
    const parts = data.split(':')
    if (parts.length < 5) {
      await ctx.answerCallbackQuery('⚠️ Invalid data')
      return
    }

    const requestId = parts[2]
    const ansIdx = parseInt(parts[4], 10)

    const tracked = getTrackedRequest(requestId)
    if (!tracked) {
      await ctx.answerCallbackQuery('⏳ Expired')
      try {
        await ctx.editMessageText('⏳ Request expired')
      } catch { /* ignore edit failures */ }
      return
    }

    const buttons = ctx.callbackQuery.message?.reply_markup?.inline_keyboard
    const optionLabel = buttons?.[ansIdx]?.[0]?.text ?? `Option ${ansIdx + 1}`

    try {
      await openCode.replyQuestion(requestId, tracked.directory, [[optionLabel]])
      removeTrackedRequest(requestId)

      await ctx.answerCallbackQuery('✅ Sent')
      try {
        const originalText = ctx.callbackQuery.message?.text ?? ''
        await ctx.editMessageText(`${originalText}\n\n<b>Answered: ${escapeHtml(optionLabel)}</b>`, { parse_mode: 'HTML' })
      } catch { /* ignore edit failures */ }
    } catch (err) {
      logger.warn('hookbot', `Question reply failed: ${err instanceof Error ? err.message : 'unknown'}`)
      removeTrackedRequest(requestId)
      await ctx.answerCallbackQuery('⚠️ Already answered')
      try {
        const originalText = ctx.callbackQuery.message?.text ?? ''
        await ctx.editMessageText(`${originalText}\n\n<i>Answered elsewhere</i>`, { parse_mode: 'HTML' })
      } catch { /* ignore edit failures */ }
    }
  })

  bot.command('hookstatus', async (ctx) => {
    const projectList = config.projects.map((p, i) => `${i + 1}. ${escapeHtml(p.name)}`).join('\n')
    const text = `🔔 <b>Hook Bot Status</b>\n\nMonitoring ${config.projects.length} project(s):\n${projectList}\nMode: ${config.mode}`
    await ctx.reply(text, { parse_mode: 'HTML' })
  })

  bot.command('start', async (ctx) => {
    await ctx.reply('🔔 Hook Bot active. Use /hookstatus for details.', { parse_mode: 'HTML' })
  })
}
