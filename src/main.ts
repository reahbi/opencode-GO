import { loadEnvConfig } from './config/env.js'
import { createBot, createChatOutputAdapter } from './adapters/telegram/bot.js'
import { createAuthMiddleware } from './adapters/telegram/authMiddleware.js'
import { createGroupMiddleware } from './adapters/telegram/groupMiddleware.js'
import { createOpenCodeAdapter } from './adapters/opencode/opencodeAdapter.js'
import { createJsonStateStore } from './adapters/persistence/jsonStateStore.js'
import { createFileCoordinationAdapter } from './adapters/coordination/fileCoordinationAdapter.js'
import { createChatQueue } from './app/queue/chatQueue.js'
import { registerCommands } from './adapters/telegram/commands/index.js'
import { logger, setInstancePrefix } from './shared/logger.js'
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
  const state = createJsonStateStore(config.stateDir)
  const queue = createChatQueue()

  const botInfo = await bot.api.getMe()
  const botUsername = botInfo.username ?? ''

  bot.use(createAuthMiddleware(config.allowedUserIds))
  bot.use(createGroupMiddleware(botUsername, config.groupChatEnabled))

  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id
    if (chatId && config.defaultProject) {
      const chatState = await state.getChatState(chatId)
      if (!chatState.activeProjectDirectory) {
        chatState.activeProjectDirectory = config.defaultProject
        await state.saveChatState(chatId, chatState)
      }
    }
    return next()
  })

  let coordination = undefined
  if (config.coordinationDir) {
    await fs.mkdir(config.coordinationDir, { recursive: true })
    coordination = createFileCoordinationAdapter(config.coordinationDir)
    logger.info('coordination', `Coordination dir: ${config.coordinationDir}`)
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

  await bot.start({
    drop_pending_updates: true,
    onStart: () => logger.info('bot', `OpenCaddy is running! (@${botUsername})`),
  })
}

main().catch((err) => {
  logger.error('bot', 'Fatal error:', err)
  process.exit(1)
})
