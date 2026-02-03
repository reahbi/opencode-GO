import { loadEnvConfig } from './config/env.js'
import { createBot, createChatOutputAdapter } from './adapters/telegram/bot.js'
import { createAuthMiddleware } from './adapters/telegram/authMiddleware.js'
import { createGroupMiddleware } from './adapters/telegram/groupMiddleware.js'
import { createOpenCodeAdapter } from './adapters/opencode/opencodeAdapter.js'
import { createJsonStateStore } from './adapters/persistence/jsonStateStore.js'
import { createFileCoordinationAdapter } from './adapters/coordination/fileCoordinationAdapter.js'
import { createFileRegistryAdapter } from './adapters/coordination/fileRegistryAdapter.js'
import { createChatQueue } from './app/queue/chatQueue.js'
import { createDebateFlow } from './app/usecases/debateFlow.js'
import { registerCommands } from './adapters/telegram/commands/index.js'
import { logger, setInstancePrefix } from './shared/logger.js'
import { LIMITS } from './app/policies/limits.js'
import { promises as fs } from 'node:fs'

async function main() {
  const config = loadEnvConfig()

  if (process.env.INSTANCE_NAME) {
    setInstancePrefix(config.instanceName)
  }

  logger.info('bot', `Starting OpenCaddy v2.1 [${config.instanceName}]...`)

  const bot = createBot(config.botToken)
  const output = createChatOutputAdapter(bot)
  const openCode = createOpenCodeAdapter(config.openCodeServerUrl, config.openCodeServerUsername, config.openCodeServerPassword)
  const state = createJsonStateStore(config.stateDir, config.defaultAgent ?? undefined)
  const queue = createChatQueue()

  const botInfo = await bot.api.getMe()
  const botUsername = botInfo.username ?? ''

  bot.use(createAuthMiddleware(config.allowedUserIds))
  bot.use(createGroupMiddleware(botUsername, config.groupChatEnabled))

  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id
    if (chatId && config.defaultProject) {
      const chatState = await state.getChatState(chatId)
      let changed = false
      if (!chatState.activeProjectDirectory) {
        chatState.activeProjectDirectory = config.defaultProject
        changed = true
      }
      if (!chatState.activeAgent) {
        const defaultAgent = await state.getDefaultAgent()
        if (defaultAgent) {
          chatState.activeAgent = defaultAgent
          changed = true
        }
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

  // Auto-register this bot instance
  await registry.register({
    instanceName: config.instanceName,
    botUsername,
    botRole: config.botRole,
    projectDir: config.defaultProject,
    serverUrl: config.openCodeServerUrl,
    lastSeen: Date.now(),
  })
  logger.info('registry', `Registered as ${config.instanceName} (@${botUsername})`)

  // Heartbeat: update lastSeen periodically
  const heartbeatInterval = setInterval(async () => {
    try {
      await registry.register({
        instanceName: config.instanceName,
        botUsername,
        botRole: config.botRole,
        projectDir: config.defaultProject,
        serverUrl: config.openCodeServerUrl,
        lastSeen: Date.now(),
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
    serverUrl: config.openCodeServerUrl,
    serverUsername: config.openCodeServerUsername,
    serverPassword: config.openCodeServerPassword ?? undefined,
    debateFlow,
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
    { command: 'new', description: '새 AI 세션 생성' },
    { command: 'list', description: '세션 목록 보기' },
    { command: 'resume', description: '세션 재개' },
    { command: 'abort', description: '현재 작업 중단' },
    { command: 'history', description: '세션 대화 이력 내보내기' },
    { command: 'status', description: '현재 상태 확인' },
    { command: 'agents', description: 'AI 에이전트/모델 선택' },
    { command: 'settings', description: '요약, 출력 형식 등 설정' },
    { command: 'help', description: '도움말' },
  ])

  await bot.start({
    drop_pending_updates: true,
    onStart: () => logger.info('bot', `OpenCaddy is running! (@${botUsername})`),
  })
}

main().catch((err) => {
  logger.error('bot', 'Fatal error:', err)
  process.exit(1)
})
