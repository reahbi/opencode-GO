import { Bot, InlineKeyboard, InputFile } from 'grammy'
import type { Context } from 'grammy'
import { promises as fs } from 'node:fs'
import { resolve as pathResolve } from 'node:path'
import type { HookNotificationPort } from '../../domain/ports/HookNotificationPort.js'
import type { HookNotification, HookBotConfig } from '../../domain/hookBotTypes.js'
import type { QuestionAsked } from '../../domain/events.js'
import { logger } from '../../shared/logger.js'
import { escapeHtml, sanitizeTelegramHtml, stripHtml } from '../../shared/formatResponse.js'
import { routeDelivery } from '../../app/policies/deliveryRouter.js'
import { structuralExtract } from '../../shared/structuralExtract.js'
import { LIMITS } from '../../app/policies/limits.js'
import { pm2Save } from '../../shared/pm2.js'
import { parseCallback } from './ui/callbacks.js'

type BotInstance = Bot<Context>

type HookBotWizardStep = 'token' | 'mode' | 'project_select' | 'chatid'

type HookBotWizardState = {
  step: HookBotWizardStep
  token?: string
  username?: string
  mode?: 'all' | 'selected'
  selectedProjects: { directory: string; name: string }[]
  availableProjects: { directory: string; name: string }[]
}

const hookBotWizards = new Map<number, HookBotWizardState>()

function getHookConfigPath(): string {
  const raw = process.env.HOOK_CONFIG_PATH || 'data/hook-config.json'
  return pathResolve(process.cwd(), raw)
}

/** Discover projects from server or registry file */
async function discoverAvailableProjects(cfg: HookBotConfig): Promise<Array<{ directory: string; name: string }>> {
  // Try server first
  if (cfg.serverUrl) {
    try {
      const projects = await fetchServerProjects(cfg)
      if (projects.length > 0) return projects
    } catch {
      // fall through
    }
  }

  // Fall back to registry file
  const registryPaths = [
    pathResolve(process.cwd(), 'data', 'registry.json'),
    pathResolve(process.env.STATE_DIR || 'data', 'registry.json'),
  ]
  for (const registryPath of registryPaths) {
    try {
      const raw = await fs.readFile(registryPath, 'utf-8')
      const parsed = JSON.parse(raw) as { bots?: Record<string, { projectDir?: string; instanceName?: string }> }
      const entries = Object.values(parsed.bots ?? {})
      const projects = entries
        .filter(e => e.projectDir && e.projectDir.length > 1)
        .map(e => ({
          directory: e.projectDir!,
          name: e.instanceName || e.projectDir!.split('/').pop() || e.projectDir!,
        }))
      if (projects.length > 0) return projects
    } catch {
      // try next
    }
  }

  // Fall back to config.projects
  if (cfg.projects && cfg.projects.length > 0) {
    return cfg.projects
  }

  return []
}

async function readHookConfig(): Promise<HookBotConfig | null> {
  try {
    const raw = await fs.readFile(getHookConfigPath(), 'utf-8')
    return JSON.parse(raw) as HookBotConfig
  } catch {
    return null
  }
}

async function writeHookConfig(config: HookBotConfig): Promise<void> {
  const filePath = getHookConfigPath()
  const tmpPath = `${filePath}.tmp.${Math.random().toString(36).slice(2)}`
  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
  await fs.rename(tmpPath, filePath)
}

export async function verifyTelegramToken(token: string): Promise<{ username: string } | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(LIMITS.TELEGRAM_API_TIMEOUT_MS),
    })
    const data = await res.json() as { ok: boolean; result?: { username?: string } }
    if (!data.ok || !data.result?.username) return null
    return { username: data.result.username }
  } catch {
    return null
  }
}

export async function fetchServerProjects(cfg: HookBotConfig): Promise<Array<{ directory: string; name: string }>> {
  const headers: Record<string, string> = {}
  if (cfg.serverPassword) {
    headers['Authorization'] = `Basic ${Buffer.from(`${cfg.serverUsername}:${cfg.serverPassword}`).toString('base64')}`
  }
  const res = await fetch(`${cfg.serverUrl}/project`, {
    headers,
    signal: AbortSignal.timeout(LIMITS.TELEGRAM_API_TIMEOUT_MS),
  })
  if (!res.ok) return []
  const projects = await res.json() as Array<{ worktree?: string; name?: string }>
  return projects
    .filter(p => typeof p.worktree === 'string' && p.worktree.length > 0 && p.worktree !== '/')
    .map(p => ({
      directory: p.worktree!,
      name: p.name || p.worktree!.split('/').pop() || p.worktree!,
    }))
}

function hookBotSettingsText(cfg: HookBotConfig | null): string {
  if (!cfg) {
    return [
      '<b>📡 Hook Bot Settings</b>',
      '',
      'Status: <b>Not configured</b>',
      '',
      `Config path: <code>${escapeHtml(getHookConfigPath())}</code>`,
    ].join('\n')
  }

  const modeText = cfg.mode === 'selected'
    ? `📁 Selected (${cfg.projects.length})`
    : '📡 All'
  const projectLine = cfg.mode === 'selected'
    ? `Projects: ${(cfg.projects.map(p => p.name).join(', ') || 'none')}`
    : 'Projects: all (server-wide discovery enabled)'

  return [
    '<b>📡 Hook Bot Settings</b>',
    '',
    `Mode: ${modeText}`,
    `Chat ID: <code>${cfg.chatId}</code>`,
    projectLine,
    '',
    `Config path: <code>${escapeHtml(getHookConfigPath())}</code>`,
  ].join('\n')
}

function hookBotSettingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔄 Reconfigure', 'hbs:reconfigure')
    .row()
    .text('🔄 Restart (PM2)', 'hbs:restart')
    .text('🗑 Remove', 'hbs:remove')
}

function hookBotWizardModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📡 All (recommended)', 'hbs:mode:all')
    .row()
    .text('📁 Selected projects', 'hbs:mode:selected')
    .row()
    .text('❌ Cancel', 'hbs:cancel')
}

function hookBotWizardProjectsKeyboard(
  available: Array<{ directory: string; name: string }>,
  selectedDirs: Set<string>,
): InlineKeyboard {
  const kb = new InlineKeyboard()
  kb.text('📡 All projects', 'hbs:mode:all').row()
  for (const p of available) {
    const isSelected = selectedDirs.has(p.directory)
    kb.text(`${isSelected ? '✅' : '⬜'} ${p.name}`, `hbs_proj:${p.directory}:${isSelected ? 'deselect' : 'select'}`).row()
  }
  kb.text('✅ Done', 'hbs:projects_done').row()
  kb.text('❌ Cancel', 'hbs:cancel')
  return kb
}

async function restartHookBotPm2(): Promise<{ ok: boolean; message: string }> {
  const pm2Name = 'claude-go-hookbot'
  try {
    const proc = Bun.spawn(['pm2', 'restart', pm2Name], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
    const exitCode = await proc.exited
    if (exitCode === 0) {
      await pm2Save()
      return { ok: true, message: `✅ Restarted <code>${escapeHtml(pm2Name)}</code>.` }
    }
    const stderr = await new Response(proc.stderr).text()
    return { ok: false, message: `❌ PM2 restart failed (exit ${exitCode})\n<pre>${escapeHtml(stderr.slice(0, 500))}</pre>` }
  } catch (err) {
    return { ok: false, message: `❌ PM2 restart error: ${escapeHtml(err instanceof Error ? err.message : 'unknown')}` }
  }
}

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

export type HookBotInteractiveFlow = {
  handleQuestionEvent(chatId: number, event: QuestionAsked, actorUserId?: number, directory?: string): Promise<void>
  handleQuestionAnswer(chatId: number, interactionId: string, questionIndex: number, answerIndex: number): Promise<void>
  handleQuestionToggle(chatId: number, interactionId: string, questionIndex: number, answerIndex: number): Promise<void>
  handleQuestionNext(chatId: number, interactionId: string, questionIndex: number): Promise<void>
  handleQuestionSkip(chatId: number, interactionId: string, questionIndex: number): Promise<void>
  handleQuestionBack(chatId: number, interactionId: string, questionIndex: number): Promise<void>
  handleQuestionType(chatId: number, interactionId: string, questionIndex: number): Promise<void>
  handleQuestionConfirm(chatId: number, interactionId: string): Promise<void>
  handleQuestionReset(chatId: number, interactionId: string): Promise<void>
  handleFreeTextAnswer(chatId: number, text: string): Promise<boolean>
}

export function createHookBotNotificationAdapter(
  bot: BotInstance,
  chatId: number,
  config: HookBotConfig,
  interactiveFlow?: HookBotInteractiveFlow,
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
        const preview = structuralExtract(content).slice(0, LIMITS.PREVIEW_MAX_CHARS)
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

    const preview = structuralExtract(content).slice(0, LIMITS.PREVIEW_MAX_CHARS)
    await sendText(preview + '\n\n<i>... (full response attached)</i>', 'HTML')
    await sendFile(Buffer.from(content, 'utf-8'), 'response.md', 'Full response attached.')
  }

  // ── Notification dispatch ──────────────────────────────────

  async function notifyCompletion(n: Extract<HookNotification, { type: 'completion' }>): Promise<void> {
    const lines: string[] = []
    lines.push('✅ <b>Session completed</b>')
    lines.push(`📁 ${escapeHtml(n.projectName)}`)
    if (n.sessionTitle) {
      lines.push(`📝 ${escapeHtml(n.sessionTitle)}`)
    }
    if (n.duration !== null) {
      lines.push(`⏱ ${formatDuration(n.duration)}`)
    }

    // Keep completion as a single Telegram message.
    // For poll-based notifications, sending header + content separately is confusing.
    if (n.lastMessage && n.lastMessage.trim()) {
      const raw = stripHtml(n.lastMessage).trim()
      const maxTotal = LIMITS.COMPLETION_SAFE_LENGTH
      const header = lines.join('\n')

      const label = '<b>Last message</b>'
      const suffix = '\n<i>(truncated)</i>'
      const overhead = `\n\n${label}\n<pre></pre>`.length
      const available = Math.max(0, maxTotal - header.length - overhead)

      let preview = raw
      let truncated = false
      if (preview.length > available) {
        truncated = true
        const keep = Math.max(0, available - suffix.length - 3)
        preview = keep > 0 ? `${preview.slice(0, keep)}...` : ''
      }

      let combined = `${header}\n\n${label}\n<pre>${escapeHtml(preview)}</pre>`
      if (truncated) {
        combined += suffix
      }

      await sendText(sanitizeTelegramHtml(combined), 'HTML')
      if (truncated) {
        await sendFile(Buffer.from(n.lastMessage, 'utf-8'), 'completion-response.md', '📎 Full response attached.')
      }
      return
    }

    await sendText(lines.join('\n'), 'HTML')
  }

  async function notifyStall(n: Extract<HookNotification, { type: 'stall' }>): Promise<void> {
    const text = `⚠️ Session stalled in ${escapeHtml(n.projectName)}\nSession: <code>${escapeHtml(n.sessionId)}</code>\nInactive for ${formatDuration(n.inactiveDuration)}`
    await sendText(text, 'HTML')
  }

  async function notifyError(n: Extract<HookNotification, { type: 'error' }>): Promise<void> {
    const text = `❌ Session error in ${escapeHtml(n.projectName)}\nSession: <code>${escapeHtml(n.sessionId)}</code>\nError: ${escapeHtml(n.error)}`
    await sendText(text, 'HTML')
  }

  async function notifyTurn(n: Extract<HookNotification, { type: 'turn' }>): Promise<void> {
    const maxTotal = LIMITS.COMPLETION_SAFE_LENGTH

    // Build header
    const headerLines: string[] = []
    headerLines.push(`💬 <b>Turn completed</b>`)
    headerLines.push(`📁 ${escapeHtml(n.projectName)}`)

    if (n.userPrompt) {
      const rawPrompt = stripHtml(n.userPrompt).trim()
      const promptPreview = rawPrompt.slice(0, 200)
      headerLines.push(`\n👤 <b>User</b>\n<pre>${escapeHtml(promptPreview)}${rawPrompt.length > 200 ? '...' : ''}</pre>`)
    }

    if (n.costUsd !== undefined && n.costUsd > 0) {
      headerLines.push(`\n💰 $${n.costUsd.toFixed(4)}`)
    }

    const header = headerLines.join('\n')

    if (!n.assistantResponse || !n.assistantResponse.trim()) {
      await sendText(sanitizeTelegramHtml(header), 'HTML')
      return
    }

    const rawResponse = stripHtml(n.assistantResponse).trim()

    // Dynamic space calculation (ope-go style)
    const label = '\n\n🤖 <b>Assistant</b>'
    const preWrap = '\n<pre></pre>'
    const suffix = '\n<i>(truncated)</i>'
    const overhead = label.length + preWrap.length
    const available = Math.max(0, maxTotal - header.length - overhead)

    if (rawResponse.length <= available) {
      // Fits inline
      const combined = `${header}${label}\n<pre>${escapeHtml(rawResponse)}</pre>`
      await sendText(sanitizeTelegramHtml(combined), 'HTML')
    } else {
      // Doesn't fit inline — send preview + .md file
      const preview = rawResponse.slice(0, Math.min(LIMITS.PREVIEW_MAX_CHARS, available - suffix.length - 3))
      const inlineMsg = `${header}${label}\n<pre>${escapeHtml(preview)}...</pre>${suffix}`
      await sendText(sanitizeTelegramHtml(inlineMsg), 'HTML')
      await sendFile(Buffer.from(n.assistantResponse, 'utf-8'), 'turn-response.md', '📎 Full response attached.')
    }
  }

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
          case 'turn':
            await notifyTurn(notification)
            break
          case 'question': {
            if (!interactiveFlow) {
              logger.warn('hookbot', 'Question notification received but no interactiveFlow configured')
              break
            }
            const qEvent: QuestionAsked = {
              requestId: notification.requestId,
              sessionId: notification.sessionId,
              questions: notification.questions.map((q, i) => ({
                id: `hookbot-q-${notification.requestId}-${i}`,
                text: q.text,
                options: q.options,
                multiple: q.multiple,
              })),
            }
            await interactiveFlow.handleQuestionEvent(chatId, qEvent, undefined, notification.directory)
            break
          }
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

interface HookBotExtras {
  watcher: { startWatching(projects: Array<{ directory: string; name: string }>): Promise<void>; getStatus(): { projects: Array<{ directory: string; name: string; connected: boolean; busyCount: number }> } }
  discoverAndWatch: () => Promise<number>
  interactiveFlow?: HookBotInteractiveFlow
}

export function registerHookBotHandlers(
  bot: BotInstance,
  config: HookBotConfig,
  extras?: HookBotExtras,
): void {
  const chatId = config.chatId
  const iFlow = extras?.interactiveFlow

  // Question callbacks: q:{interactionId}:{...}
  bot.callbackQuery(/^q:/, async (ctx) => {
    if (!iFlow) {
      await ctx.answerCallbackQuery('⚠️ Not configured')
      return
    }
    const parsed = parseCallback(ctx.callbackQuery.data)
    logger.debug('hookbot', `Callback parsed: type=${parsed.type}, data=${ctx.callbackQuery.data}`)
    await ctx.answerCallbackQuery()

    switch (parsed.type) {
      case 'question_answer':
        await iFlow.handleQuestionAnswer(chatId, parsed.interactionId, parsed.questionIndex, parsed.answerIndex)
        break
      case 'question_toggle':
        await iFlow.handleQuestionToggle(chatId, parsed.interactionId, parsed.questionIndex, parsed.answerIndex)
        break
      case 'question_next':
        await iFlow.handleQuestionNext(chatId, parsed.interactionId, parsed.questionIndex)
        break
      case 'question_skip':
        await iFlow.handleQuestionSkip(chatId, parsed.interactionId, parsed.questionIndex)
        break
      case 'question_back':
        await iFlow.handleQuestionBack(chatId, parsed.interactionId, parsed.questionIndex)
        break
      case 'question_type':
        await iFlow.handleQuestionType(chatId, parsed.interactionId, parsed.questionIndex)
        break
      case 'question_confirm':
        await iFlow.handleQuestionConfirm(chatId, parsed.interactionId)
        break
      case 'question_reset':
        await iFlow.handleQuestionReset(chatId, parsed.interactionId)
        break
      default:
        break
    }
  })

  bot.command('hookstatus', async (ctx) => {
    if (extras) {
      const status = extras.watcher.getStatus()
      const lines = status.projects.map((p, i) => {
        const icon = p.connected ? '🟢' : '🔴'
        const busyInfo = p.busyCount > 0 ? ` (${p.busyCount} busy)` : ''
        return `${i + 1}. ${icon} ${escapeHtml(p.name)}${busyInfo}`
      })
      const text = `🔔 <b>Hook Bot Status</b>\n\nMonitoring ${status.projects.length} project(s):\n${lines.join('\n')}\nMode: ${config.mode}`
      await ctx.reply(text, { parse_mode: 'HTML' })
    } else {
      const projectList = config.projects.map((p, i) => `${i + 1}. ${escapeHtml(p.name)}`).join('\n')
      const text = `🔔 <b>Hook Bot Status</b>\n\nMonitoring ${config.projects.length} project(s):\n${projectList}\nMode: ${config.mode}`
      await ctx.reply(text, { parse_mode: 'HTML' })
    }
  })

  bot.command('start', async (ctx) => {
    await ctx.reply('🔔 Hook Bot active. Use /hookstatus for details.', { parse_mode: 'HTML' })
  })

  bot.command('scan', async (ctx) => {
    if (!extras) {
      await ctx.reply('⚠️ Scan not available in this mode.', { parse_mode: 'HTML' })
      return
    }
    try {
      const found = await extras.discoverAndWatch()
      if (found > 0) {
        await ctx.reply(`🔍 Found ${found} new project(s). Now monitoring ${config.projects.length} total.`, { parse_mode: 'HTML' })
      } else {
        await ctx.reply(`✅ No new projects found. Monitoring ${config.projects.length} project(s).`, { parse_mode: 'HTML' })
      }
    } catch (err) {
      await ctx.reply(`❌ Scan failed: ${escapeHtml(err instanceof Error ? err.message : 'unknown')}`, { parse_mode: 'HTML' })
    }
  })

  async function renderSettings(ctx: Context): Promise<void> {
    const cfg = await readHookConfig()
    await ctx.reply(hookBotSettingsText(cfg), { parse_mode: 'HTML', reply_markup: hookBotSettingsKeyboard() })
  }

  bot.command('settings', renderSettings)
  bot.command('setting', renderSettings)

  bot.command('cancel', async (ctx) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    if (hookBotWizards.has(chatId)) {
      hookBotWizards.delete(chatId)
      await ctx.reply('❌ Cancelled.', { parse_mode: 'HTML' })
    } else {
      await ctx.reply('Nothing to cancel.', { parse_mode: 'HTML' })
    }
  })

  bot.callbackQuery(/^hbs:/, async (ctx) => {
    const data = ctx.callbackQuery.data
    const chatId = ctx.chat?.id ?? ctx.callbackQuery.message?.chat.id
    await ctx.answerCallbackQuery().catch(() => {})
    if (!chatId) return

    const parts = data.split(':')
    const action = parts[1]

    if (action === 'cancel') {
      hookBotWizards.delete(chatId)
      await ctx.editMessageText('❌ Cancelled.', { parse_mode: 'HTML' }).catch(async () => {
        await ctx.reply('❌ Cancelled.', { parse_mode: 'HTML' })
      })
      return
    }

    if (action === 'restart') {
      const res = await restartHookBotPm2()
      await ctx.reply(res.message, { parse_mode: 'HTML' })
      return
    }

    if (action === 'remove') {
      const kb = new InlineKeyboard()
        .text('✅ Yes, remove', 'hbs:remove_yes')
        .text('❌ Cancel', 'hbs:cancel')
      await ctx.reply('🗑 <b>Remove hook bot config?</b>\nThis will delete <code>data/hook-config.json</code> and stop PM2 process <code>claude-go-hookbot</code>.', {
        parse_mode: 'HTML',
        reply_markup: kb,
      })
      return
    }

    if (action === 'remove_yes') {
      const configPath = getHookConfigPath()
      try { await fs.unlink(configPath) } catch { /* ignore */ }
      try {
        const proc = Bun.spawn(['pm2', 'delete', 'claude-go-hookbot'], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
        await proc.exited
      } catch { /* ignore */ }
      await pm2Save()
      await ctx.reply('✅ Removed hook bot config and stopped PM2 process. Reconfigure with /settings.', { parse_mode: 'HTML' })
      return
    }

    if (action === 'reconfigure') {
      hookBotWizards.set(chatId, { step: 'token', selectedProjects: [], availableProjects: [] })
      await ctx.reply(
        [
          '<b>📡 Hook Bot Reconfigure</b>',
          '',
          'Send the hook bot token from BotFather.',
          '',
          'Note: if you change the token to a different bot, you must chat with that new bot after restart.',
          '',
          'Type /cancel to cancel.',
        ].join('\n'),
        { parse_mode: 'HTML' },
      )
      return
    }

    if (action === 'mode') {
      const mode = parts[2]
      const wizard = hookBotWizards.get(chatId)
      if (!wizard) {
        await ctx.reply('❌ No wizard in progress. Use /settings → Reconfigure.', { parse_mode: 'HTML' })
        return
      }
      if (mode !== 'all' && mode !== 'selected') {
        await ctx.reply('❌ Invalid mode.', { parse_mode: 'HTML' })
        return
      }

      wizard.mode = mode
      if (mode === 'all') {
        wizard.step = 'chatid'
        hookBotWizards.set(chatId, wizard)
        await ctx.reply(
          `Send the chat ID for notifications.\nDefault: <code>${chatId}</code> (this chat)\n\nSend <code>default</code> to use current chat, or enter a numeric chat ID.`,
          { parse_mode: 'HTML' },
        )
        return
      }

      // selected
      const currentCfg = await readHookConfig()
      const baseCfg = currentCfg ?? config
      const projects = await discoverAvailableProjects(baseCfg)
      wizard.availableProjects = projects
      wizard.selectedProjects = []
      wizard.step = 'project_select'
      hookBotWizards.set(chatId, wizard)
      const selectedDirs = new Set<string>()
      await ctx.reply(
        'Select projects to monitor (toggle):',
        { parse_mode: 'HTML', reply_markup: hookBotWizardProjectsKeyboard(projects, selectedDirs) },
      )
      return
    }

    if (action === 'projects_done') {
      const wizard = hookBotWizards.get(chatId)
      if (!wizard || wizard.step !== 'project_select') {
        await ctx.reply('❌ No project selection in progress.', { parse_mode: 'HTML' })
        return
      }
      if (wizard.selectedProjects.length === 0) {
        await ctx.reply('⚠️ No projects selected. Select at least one, or choose All.', { parse_mode: 'HTML' })
        return
      }
      wizard.step = 'chatid'
      hookBotWizards.set(chatId, wizard)
      await ctx.reply(
        `Send the chat ID for notifications.\nDefault: <code>${chatId}</code> (this chat)\n\nSend <code>default</code> to use current chat, or enter a numeric chat ID.`,
        { parse_mode: 'HTML' },
      )
      return
    }
  })

  bot.callbackQuery(/^hbs_proj:/, async (ctx) => {
    const data = ctx.callbackQuery.data
    const chatId = ctx.chat?.id ?? ctx.callbackQuery.message?.chat.id
    await ctx.answerCallbackQuery().catch(() => {})
    if (!chatId) return

    const wizard = hookBotWizards.get(chatId)
    if (!wizard || wizard.step !== 'project_select') {
      await ctx.reply('❌ No wizard in progress. Use /settings → Reconfigure.', { parse_mode: 'HTML' })
      return
    }

    const rest = data.slice('hbs_proj:'.length)
    const sepIdx = rest.lastIndexOf(':')
    if (sepIdx <= 0) return
    const projectDir = rest.slice(0, sepIdx)
    const act = rest.slice(sepIdx + 1)

    if (act === 'select') {
      if (!wizard.selectedProjects.some(p => p.directory === projectDir)) {
        const name = wizard.availableProjects.find(p => p.directory === projectDir)?.name
          || projectDir.split('/').pop()
          || projectDir
        wizard.selectedProjects.push({ directory: projectDir, name })
      }
    } else if (act === 'deselect') {
      wizard.selectedProjects = wizard.selectedProjects.filter(p => p.directory !== projectDir)
    }

    hookBotWizards.set(chatId, wizard)
    const selectedDirs = new Set(wizard.selectedProjects.map(p => p.directory))
    await ctx.editMessageReplyMarkup({ reply_markup: hookBotWizardProjectsKeyboard(wizard.availableProjects, selectedDirs) }).catch(() => {})
  })

  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const text = ctx.message.text.trim()
    if (text.startsWith('/')) return

    if (iFlow) {
      const handled = await iFlow.handleFreeTextAnswer(chatId, text)
      if (handled) return
    }

    const wizard = hookBotWizards.get(chatId)
    if (!wizard) return

    if (wizard.step === 'token') {
      const token = text
      const verified = await verifyTelegramToken(token)
      if (!verified) {
        await ctx.reply('❌ Invalid token. Please try again, or /cancel.', { parse_mode: 'HTML' })
        return
      }
      wizard.token = token
      wizard.username = verified.username
      wizard.step = 'mode'
      hookBotWizards.set(chatId, wizard)
      await ctx.reply(
        `✅ <b>@${escapeHtml(verified.username)}</b> verified\n\nChoose mode:`,
        { parse_mode: 'HTML', reply_markup: hookBotWizardModeKeyboard() },
      )
      return
    }

    if (wizard.step === 'chatid') {
      const trimmed = text.toLowerCase()
      const targetChatId = trimmed === 'default'
        ? chatId
        : parseInt(trimmed, 10)

      if (!Number.isFinite(targetChatId)) {
        await ctx.reply('❌ Invalid chat ID. Enter a number or <code>default</code>.', { parse_mode: 'HTML' })
        return
      }

      const baseCfg = (await readHookConfig()) ?? config
      const newCfg: HookBotConfig = {
        botToken: wizard.token || baseCfg.botToken,
        chatId: targetChatId,
        projects: (wizard.mode === 'selected' ? wizard.selectedProjects : []),
        serverUrl: baseCfg.serverUrl,
        serverUsername: baseCfg.serverUsername,
        serverPassword: baseCfg.serverPassword,
        mode: (wizard.mode ?? 'all'),
      }

      await writeHookConfig(newCfg)
      hookBotWizards.delete(chatId)

      const kb = new InlineKeyboard().text('🔄 Restart hookbot (PM2)', 'hbs:restart')
      await ctx.reply(
        [
          '✅ <b>Saved hook bot config.</b>',
          `Bot: <b>@${escapeHtml(wizard.username || 'unknown')}</b>`,
          `Mode: <b>${escapeHtml(newCfg.mode)}</b>`,
          `Chat ID: <code>${newCfg.chatId}</code>`,
          '',
          'Restart is required to apply changes.',
        ].join('\n'),
        { parse_mode: 'HTML', reply_markup: kb },
      )
    }
  })
}
