import { loadEnvConfig } from './config/env.js'
import { createBot, createChatOutputAdapter } from './adapters/telegram/bot.js'
import { createAuthMiddleware } from './adapters/telegram/authMiddleware.js'
import { createOpenCodeAdapter } from './adapters/opencode/opencodeAdapter.js'
import { createJsonStateStore } from './adapters/persistence/jsonStateStore.js'
import { createChatQueue } from './app/queue/chatQueue.js'
import { registerCommands } from './adapters/telegram/commands/index.js'
import { logger, setInstancePrefix } from './shared/logger.js'

async function main() {
  const config = loadEnvConfig()

  if (process.env.INSTANCE_NAME) {
    setInstancePrefix(config.instanceName)
  }

  logger.info('bot', `Starting OpenCaddy v2.1 [${config.instanceName}]...`)

  // Create adapters
  const bot = createBot(config.botToken)
  const output = createChatOutputAdapter(bot)
  const openCode = createOpenCodeAdapter(config.openCodeServerUrl, config.openCodeServerUsername, config.openCodeServerPassword)
  const state = createJsonStateStore(config.stateDir)
  const queue = createChatQueue()

  // Auth middleware
  bot.use(createAuthMiddleware(config.allowedUserIds))

  // Set default project for new chats
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

  // Register commands and handlers
  registerCommands({ bot, openCode, state, output, queue, instanceName: config.instanceName })

  // Error handler
  bot.catch((err) => {
    logger.error('bot', `Bot error: ${err.error instanceof Error ? err.error.message : err.error}`)
  })

  // Initialize default project for all chats
  // (Handled lazily — each chat gets default project on first getChatState if null)
  logger.info('bot', `Instance: ${config.instanceName}`)
  logger.info('bot', `State dir: ${config.stateDir}`)
  logger.info('bot', `Default project: ${config.defaultProject}`)
  logger.info('bot', `Allowed users: ${config.allowedUserIds.length > 0 ? config.allowedUserIds.join(', ') : 'all'}`)

  // Health check
  const healthy = await openCode.healthCheck()
  if (healthy) {
    logger.info('bot', 'OpenCode server is reachable')
  } else {
    logger.warn('bot', 'OpenCode server is not reachable. Bot will start anyway.')
  }

  // Start bot
  await bot.start({
    drop_pending_updates: true,
    onStart: () => logger.info('bot', 'OpenCaddy is running!'),
  })
}

main().catch((err) => {
  logger.error('bot', 'Fatal error:', err)
  process.exit(1)
})
