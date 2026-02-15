import { loadEnvConfig } from './config/env.js'
import { createBot, createChatOutputAdapter } from './adapters/telegram/bot.js'
import { createAuthMiddleware } from './adapters/telegram/authMiddleware.js'
import { createRateLimitMiddleware } from './adapters/telegram/rateLimitMiddleware.js'
import { createGroupMiddleware } from './adapters/telegram/groupMiddleware.js'
import { createAwaitingInputMiddleware } from './adapters/telegram/awaitingInputMiddleware.js'
import { createClaudeAgentAdapter } from './adapters/claude/claudeAgentAdapter.js'
import { createJsonSessionStore as createSessionStore } from './adapters/claude/jsonSessionStore.js'
import { createClaudeSummaryService } from './adapters/claude/claudeSummaryService.js'
import { createJsonStateStore } from './adapters/persistence/jsonStateStore.js'
import { createFileCoordinationAdapter } from './adapters/coordination/fileCoordinationAdapter.js'
import { createFileRegistryAdapter } from './adapters/coordination/fileRegistryAdapter.js'
import { createFileCustomAgentAdapter } from './adapters/coordination/fileCustomAgentAdapter.js'
import { createFileGroupSettingsAdapter } from './adapters/coordination/fileGroupSettingsAdapter.js'
import { createChatQueue } from './app/queue/chatQueue.js'
import { createDebateFlow } from './app/usecases/debateFlow.js'
import { createTunnelManager } from './app/usecases/tunnelManager.js'
import { createVoiceFlow } from './app/usecases/voiceFlow.js'
import { createEdgeTtsAdapter } from './adapters/tts/edgeTtsAdapter.js'
import { createOpenAIWhisperAdapter } from './adapters/whisper/openaiWhisperAdapter.js'
import { registerCommands } from './adapters/telegram/commands/index.js'
import { logger, setInstancePrefix } from './shared/logger.js'
import { LIMITS } from './app/policies/limits.js'
import { promises as fs } from 'node:fs'
import { resolve as pathResolve } from 'node:path'
import type { HookBotConfig } from './domain/hookBotTypes.js'

async function main() {
  const config = loadEnvConfig()

  try {
    await fs.access(config.defaultProject)
  } catch {
    throw new Error(`DEFAULT_PROJECT path does not exist: ${config.defaultProject}`)
  }

  if (process.env.INSTANCE_NAME) {
    setInstancePrefix(config.instanceName)
  }

  logger.info('bot', `Starting Claude-Go v1.0 [${config.instanceName}]...`)

  const bot = createBot(config.botToken)
  const output = createChatOutputAdapter(bot)
  const claude = createClaudeAgentAdapter({
    model: config.claudeModel,
    claudeCodePath: config.claudeCodePath,
  })
  const sessionStore = createSessionStore(config.stateDir)
  const summary = createClaudeSummaryService(config.claudeCodePath, config.summaryModel)
  const state = createJsonStateStore(config.stateDir)
  const queue = createChatQueue()
  const tunnel = createTunnelManager()

  const tts = createEdgeTtsAdapter()
  const voiceFlow = createVoiceFlow({ summary, tts, output, state })

  const transcription = config.openaiApiKey
    ? createOpenAIWhisperAdapter(config.openaiApiKey, config.openaiApiBaseUrl)
    : undefined

  const botInfo = await bot.api.getMe()
  const botUsername = botInfo.username ?? ''

  bot.use(createAuthMiddleware(config.allowedUserIds))
  bot.use(createRateLimitMiddleware())
  bot.use(createGroupMiddleware(botUsername, config.groupChatEnabled))
  bot.use(createAwaitingInputMiddleware(state))

  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id
    if (chatId && config.defaultProject) {
      const chatState = await state.getChatState(chatId)
      let changed = false
      let resetSessionContext = false
      if (!chatState.activeProjectDirectory) {
        chatState.activeProjectDirectory = config.defaultProject
        changed = true
      } else if (chatState.activeProjectDirectory !== config.defaultProject) {
        try {
          await fs.access(chatState.activeProjectDirectory)
        } catch {
          logger.warn(
            'state',
            `Invalid project directory in state for chat ${chatId}: ${chatState.activeProjectDirectory}. Resetting to ${config.defaultProject}`,
          )
          chatState.activeProjectDirectory = config.defaultProject
          changed = true
          resetSessionContext = true
        }
      }
      if (!chatState.activeAgent && config.defaultAgent) {
        chatState.activeAgent = config.defaultAgent
        changed = true
      }
      if (!chatState.customAgentId && config.defaultCustomAgent) {
        chatState.customAgentId = config.defaultCustomAgent
        changed = true
      }
      if (resetSessionContext) {
        chatState.activeSessionId = null
        chatState.pendingInteractions = []
        chatState.awaitingInput = null
        chatState.awaitingInteractionId = null
      }
      if (changed) await state.saveChatState(chatId, chatState)
    }
    return next()
  })

  let coordination = undefined
  if (config.coordinationDir) {
    await fs.mkdir(config.coordinationDir, { recursive: true })
    coordination = createFileCoordinationAdapter(config.coordinationDir)
    logger.info('coordination', `Coordination dir: ${config.coordinationDir}`)
  }

  // Registry: use coordinationDir if available (shared between bots), fallback to stateDir
  const registryDir = config.coordinationDir || config.stateDir
  await fs.mkdir(registryDir, { recursive: true })
  const registry = createFileRegistryAdapter(registryDir)
  const customAgents = createFileCustomAgentAdapter(registryDir)

  // Group settings: shared between bots via coordination dir
  const groupSettings = config.coordinationDir
    ? createFileGroupSettingsAdapter(config.coordinationDir)
    : createFileGroupSettingsAdapter(config.stateDir)

  // Auto-register this bot instance (preserve existing currentAgent if any)
  const existingBots = await registry.list()
  const existingEntry = existingBots.find(b => b.instanceName === config.instanceName)
  const initialAgent = existingEntry?.currentAgent ?? config.defaultAgent ?? null

  await registry.register({
    instanceName: config.instanceName,
    botUsername,
    botUserId: botInfo.id,
    botRole: config.botRole,
    projectDir: config.defaultProject,
    serverUrl: '',
    lastSeen: Date.now(),
    currentAgent: initialAgent,
  })
  logger.info('registry', `Registered as ${config.instanceName} (@${botUsername})`)

  // Heartbeat: update lastSeen periodically
  const heartbeatInterval = setInterval(async () => {
    try {
      const bots = await registry.list()
      const current = bots.find(b => b.instanceName === config.instanceName)
      await registry.register({
        instanceName: config.instanceName,
        botUsername,
        botUserId: botInfo.id,
        botRole: config.botRole,
        projectDir: config.defaultProject,
        serverUrl: '',
        lastSeen: Date.now(),
        currentAgent: current?.currentAgent ?? config.defaultAgent ?? null,
      })
    } catch (error) {
      logger.warn('registry', `Heartbeat failed: ${error instanceof Error ? error.message : 'unknown'}`)
    }
  }, LIMITS.REGISTRY_HEARTBEAT_INTERVAL_MS)

  // Create debate flow if coordination is available
  let debateFlow = undefined
  if (coordination && config.botRole !== 'standalone' && registry) {
    debateFlow = createDebateFlow({
      claude,
      state,
      output,
      coordination,
      registry,
      groupSettings,
      botRole: config.botRole,
      instanceName: config.instanceName,
      projectDir: config.defaultProject,
    })
  }

  // Start polling at boot
  if (debateFlow) {
    debateFlow.startPolling()
    logger.info('bot', 'Coordination polling started')
  }

  // Hook bot per-turn notification: read hook-config.json and create lightweight sender
  let hookNotify: ((turn: { sessionId: string; directory: string; userPrompt: string; assistantResponse: string; costUsd?: number }) => void) | undefined
  try {
    const hookConfigPath = pathResolve(process.cwd(), process.env.HOOK_CONFIG_PATH || 'data/hook-config.json')
    const hookRaw = await fs.readFile(hookConfigPath, 'utf-8')
    const hookCfg = JSON.parse(hookRaw) as HookBotConfig
    if (hookCfg.botToken && hookCfg.chatId) {
      const projectName = config.instanceName
      const apiBase = `https://api.telegram.org/bot${hookCfg.botToken}`
      const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').trim()
      const MAX_SAFE = 3900
      const FILE_THRESHOLD = 15000
      const PREVIEW_CHARS = 2000

      const sendMsg = (text: string) =>
        fetch(`${apiBase}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: hookCfg.chatId, text, parse_mode: 'HTML' }),
        }).catch(err => logger.warn('hookbot', `Hook notify failed: ${err instanceof Error ? err.message : 'unknown'}`))

      const sendDoc = (content: string, filename: string, caption: string) => {
        const form = new FormData()
        form.append('chat_id', String(hookCfg.chatId))
        form.append('document', new Blob([content], { type: 'text/markdown' }), filename)
        form.append('caption', caption)
        return fetch(`${apiBase}/sendDocument`, { method: 'POST', body: form })
          .catch(err => logger.warn('hookbot', `Hook file send failed: ${err instanceof Error ? err.message : 'unknown'}`))
      }

      hookNotify = (turn) => {
        const headerLines = [
          `💬 <b>Turn completed</b>`,
          `📁 ${escHtml(projectName)}`,
        ]
        if (turn.userPrompt) {
          const rawPrompt = stripHtml(turn.userPrompt).slice(0, 200)
          headerLines.push(`\n👤 <b>User</b>\n<pre>${escHtml(rawPrompt)}${turn.userPrompt.length > 200 ? '...' : ''}</pre>`)
        }
        if (turn.costUsd && turn.costUsd > 0) {
          headerLines.push(`\n💰 $${turn.costUsd.toFixed(4)}`)
        }
        const header = headerLines.join('\n')

        if (!turn.assistantResponse?.trim()) {
          void sendMsg(header)
          return
        }

        const rawResponse = stripHtml(turn.assistantResponse)
        const label = '\n\n🤖 <b>Assistant</b>'
        const preWrap = '\n<pre></pre>'
        const suffix = '\n<i>(truncated)</i>'
        const overhead = label.length + preWrap.length
        const available = Math.max(0, MAX_SAFE - header.length - overhead)

        if (rawResponse.length <= available) {
          void sendMsg(`${header}${label}\n<pre>${escHtml(rawResponse)}</pre>`)
        } else if (rawResponse.length > FILE_THRESHOLD) {
          const preview = rawResponse.slice(0, PREVIEW_CHARS)
          void sendMsg(`${header}${label}\n<pre>${escHtml(preview)}...</pre>${suffix}`)
            .then(() => sendDoc(turn.assistantResponse, 'turn-response.md', '📎 Full response attached.'))
        } else {
          const keep = Math.max(0, available - suffix.length - 3)
          const preview = keep > 0 ? `${rawResponse.slice(0, keep)}...` : rawResponse.slice(0, available)
          void sendMsg(`${header}${label}\n<pre>${escHtml(preview)}</pre>${suffix}`)
        }
      }
      logger.info('hookbot', `Per-turn notifications enabled → chat ${hookCfg.chatId}`)
    }
  } catch {
    // No hook config or invalid — skip silently
  }

  registerCommands({
    bot,
    claude,
    sessionStore,
    summary,
    state,
    output,
    queue,
    instanceName: config.instanceName,
    botUsername,
    coordination,
    botRole: config.botRole,
    registry,
    customAgents,
    groupSettings,
    config: {
      maxThinkingTokens: config.maxThinkingTokens,
      maxBudgetUsd: config.maxBudgetUsd,
    },
    debateFlow,
    tunnel,
    voiceFlow,
    transcription,
    hookNotify,
  })

  bot.catch((err) => {
    logger.error('bot', `Bot error: ${err.error instanceof Error ? err.error.message : err.error}`)
  })

  logger.info('bot', `Instance: ${config.instanceName}`)
  logger.info('bot', `Role: ${config.botRole}`)
  logger.info('bot', `Group chat: ${config.groupChatEnabled ? 'enabled' : 'disabled'}`)
  logger.info('bot', `State dir: ${config.stateDir}`)
  logger.info('bot', `Default project: ${config.defaultProject}`)
  logger.info('bot', `Allowed users: ${config.allowedUserIds.length > 0 ? config.allowedUserIds.join(', ') : 'all'}`)

  logger.info('bot', 'Claude Agent SDK initialized (in-process)')

  // Graceful shutdown
  async function shutdown(signal: string) {
    logger.info('bot', `Received ${signal}, shutting down...`)
    clearInterval(heartbeatInterval)
    try {
      await tunnel.stopAll()
      logger.info('tunnel', 'All tunnels stopped')
    } catch (error) {
      logger.warn('tunnel', `Tunnel cleanup failed: ${error instanceof Error ? error.message : 'unknown'}`)
    }
    try {
      await registry.unregister(config.instanceName)
      logger.info('registry', `Unregistered ${config.instanceName}`)
    } catch (error) {
      logger.warn('registry', `Unregister failed: ${error instanceof Error ? error.message : 'unknown'}`)
    }
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await bot.api.setMyCommands([
    { command: 'new', description: 'Create new AI session' },
    { command: 'list', description: 'View session list' },
    { command: 'resume', description: 'Resume session' },
    { command: 'abort', description: 'Abort current task' },
    { command: 'history', description: 'Export session history' },
    { command: 'queue', description: 'Queue message while AI busy' },
    { command: 'clearqueue', description: 'Clear queued messages' },
    { command: 'showqueue', description: 'Show queue status' },
    { command: 'undo', description: 'Undo last AI response' },
    { command: 'redo', description: 'Redo undone response' },
    { command: 'status', description: 'Check current status' },
    { command: 'plan', description: 'Set permission mode to plan' },
    { command: 'ask', description: 'Set permission mode to ask' },
    { command: 'bypass', description: 'Set permission mode to bypass' },
    { command: 'git', description: 'Git status, diff, log' },
    { command: 'agents', description: 'Select AI agent/model' },
    { command: 'settings', description: 'Summary, output format, etc.' },
    { command: 'groupsettings', description: 'Group settings (debate, bots)' },
    { command: 'bots', description: 'List registered bots' },
    { command: 'addbot', description: 'Add a new bot instance' },
    { command: 'makeagent', description: 'Create a custom system-prompt agent' },
    { command: 'tunnel', description: 'Create tunnel to localhost' },
    { command: 'restart', description: 'Restart PM2 processes' },
    { command: 'addhookbot', description: 'Setup hook bot for session notifications' },
    { command: 'help', description: 'Help' },
  ])

  await bot.start({
    drop_pending_updates: true,
    onStart: () => logger.info('bot', `Claude-Go is running! (@${botUsername})`),
  })
}

main().catch((err) => {
  logger.error('bot', 'Fatal error:', err)
  process.exit(1)
})
