import { loadEnvConfig } from './config/env.js'
import { createBot, createChatOutputAdapter } from './adapters/telegram/bot.js'
import { createAuthMiddleware } from './adapters/telegram/authMiddleware.js'
import { createGroupMiddleware } from './adapters/telegram/groupMiddleware.js'
import { createAwaitingInputMiddleware } from './adapters/telegram/awaitingInputMiddleware.js'
import { createOpenCodeAdapter } from './adapters/opencode/opencodeAdapter.js'
import { createJsonStateStore } from './adapters/persistence/jsonStateStore.js'
import { createFileCoordinationAdapter } from './adapters/coordination/fileCoordinationAdapter.js'
import { createFileRegistryAdapter } from './adapters/coordination/fileRegistryAdapter.js'
import { createFileGroupSettingsAdapter } from './adapters/coordination/fileGroupSettingsAdapter.js'
import { createChatQueue } from './app/queue/chatQueue.js'
import { createDebateFlow } from './app/usecases/debateFlow.js'
import { createTunnelManager } from './app/usecases/tunnelManager.js'
import { createVoiceFlow } from './app/usecases/voiceFlow.js'
import { createEdgeTtsAdapter } from './adapters/tts/edgeTtsAdapter.js'
import { createSummaryService } from './adapters/opencode/summaryService.js'
import { registerCommands } from './adapters/telegram/commands/index.js'
import { logger, setInstancePrefix } from './shared/logger.js'
import { LIMITS } from './app/policies/limits.js'
import { promises as fs } from 'node:fs'

async function main() {
  const config = loadEnvConfig()

  if (process.env.INSTANCE_NAME) {
    setInstancePrefix(config.instanceName)
  }

  logger.info('bot', `Starting OpenCode-Go v2.1 [${config.instanceName}]...`)

  const bot = createBot(config.botToken)
  const output = createChatOutputAdapter(bot)
  const openCode = createOpenCodeAdapter(config.openCodeServerUrl, config.openCodeServerUsername, config.openCodeServerPassword)
  const state = createJsonStateStore(config.stateDir)
  const queue = createChatQueue()
  const tunnel = createTunnelManager()

  const tts = createEdgeTtsAdapter()
  const summary = createSummaryService(openCode)
  const voiceFlow = createVoiceFlow({ summary, tts, output, state })

  const botInfo = await bot.api.getMe()
  const botUsername = botInfo.username ?? ''

  bot.use(createAuthMiddleware(config.allowedUserIds))
  bot.use(createGroupMiddleware(botUsername, config.groupChatEnabled))
  bot.use(createAwaitingInputMiddleware(state))

  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id
    if (chatId && config.defaultProject) {
      const chatState = await state.getChatState(chatId)
      let changed = false
      if (!chatState.activeProjectDirectory) {
        chatState.activeProjectDirectory = config.defaultProject
        changed = true
      }
      if (!chatState.activeAgent && config.defaultAgent) {
        chatState.activeAgent = config.defaultAgent
        changed = true
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
    serverUrl: config.openCodeServerUrl,
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
        serverUrl: config.openCodeServerUrl,
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
      openCode,
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

  registerCommands({
    bot,
    openCode,
    state,
    output,
    queue,
    instanceName: config.instanceName,
    botUsername,
    coordination,
    botRole: config.botRole,
    registry,
    groupSettings,
    serverUrl: config.openCodeServerUrl,
    serverUsername: config.openCodeServerUsername,
    serverPassword: config.openCodeServerPassword ?? undefined,
    debateFlow,
    tunnel,
    voiceFlow,
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

  const healthy = await openCode.healthCheck()
  if (healthy) {
    logger.info('bot', 'OpenCode server is reachable')
  } else {
    logger.warn('bot', 'OpenCode server is not reachable. Bot will start anyway.')
  }

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
    { command: 'git', description: 'Git status, diff, log' },
    { command: 'agents', description: 'Select AI agent/model' },
    { command: 'settings', description: 'Summary, output format, etc.' },
    { command: 'groupsettings', description: 'Group settings (debate, bots)' },
    { command: 'bots', description: 'List registered bots' },
    { command: 'tunnel', description: 'Create tunnel to localhost' },
    { command: 'help', description: 'Help' },
  ])

  await bot.start({
    drop_pending_updates: true,
    onStart: () => logger.info('bot', `OpenCode-Go is running! (@${botUsername})`),
  })
}

main().catch((err) => {
  logger.error('bot', 'Fatal error:', err)
  process.exit(1)
})
