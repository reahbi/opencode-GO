import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import { createOpenCodeAdapter } from './adapters/opencode/opencodeAdapter.js'
import {
  createHookBot,
  createHookBotNotificationAdapter,
  createHookBotAuthGuard,
  registerHookBotHandlers,
} from './adapters/telegram/hookBotAdapter.js'
import { createChatOutputAdapter } from './adapters/telegram/bot.js'
import { createHookBotStateStore } from './adapters/persistence/hookBotStateStore.js'
import { createInteractiveFlow } from './app/usecases/interactiveFlow.js'
import { createCompletionWatcher } from './app/usecases/completionWatcher.js'
import type { HookBotConfig } from './domain/hookBotTypes.js'
import { logger } from './shared/logger.js'
import { waitForServer, isRunningUnderPM2 } from './shared/waitForServer.js'

type ServerProject = {
  worktree?: string
  name?: string
}

type ServerSession = {
  directory?: string
}

type DiscoveredProject = { directory: string; name: string }

function isNonEmptyDirectory(dir: string | undefined): dir is string {
  return typeof dir === 'string' && dir.length > 0 && dir !== '/'
}

function addIfMissing(list: DiscoveredProject[], seen: Set<string>, directory: string, name: string): void {
  if (!isNonEmptyDirectory(directory)) return
  if (seen.has(directory)) return
  list.push({ directory, name })
  seen.add(directory)
}

async function discoverProjectsFromServer(
  config: HookBotConfig,
  existing: DiscoveredProject[],
): Promise<DiscoveredProject[]> {
  const headers: Record<string, string> = {}
  if (config.serverPassword) {
    const auth = Buffer.from(`${config.serverUsername}:${config.serverPassword}`).toString('base64')
    headers['Authorization'] = `Basic ${auth}`
  }

  const discovered: DiscoveredProject[] = []
  const seen = new Set<string>()

  // Preserve stable order for callbacks: keep existing entries first.
  for (const p of existing) {
    addIfMissing(discovered, seen, p.directory, p.name)
  }

  // Always include HOME as a catch-all store.
  const homeDir = process.env.HOME
  if (isNonEmptyDirectory(homeDir)) {
    addIfMissing(discovered, seen, homeDir, path.basename(homeDir))
  }

  const projectsResp = await fetch(`${config.serverUrl}/project`, { headers })
  if (!projectsResp.ok) {
    throw new Error(`Server returned ${projectsResp.status}: ${projectsResp.statusText}`)
  }
  const projectData = await projectsResp.json() as ServerProject[]
  for (const project of projectData) {
    if (!isNonEmptyDirectory(project.worktree)) continue
    addIfMissing(discovered, seen, project.worktree, project.name || path.basename(project.worktree))
  }

  // Add directories from sessions (catches non-git projects in "global").
  // Filter out /tmp paths and directories that no longer exist on disk.
  const sessionsResp = await fetch(`${config.serverUrl}/session`, { headers })
  if (sessionsResp.ok) {
    const sessionData = await sessionsResp.json() as ServerSession[]
    for (const session of sessionData) {
      if (!isNonEmptyDirectory(session.directory)) continue
      if (session.directory.startsWith('/tmp')) continue
      if (!existsSync(session.directory)) continue
      addIfMissing(discovered, seen, session.directory, path.basename(session.directory))
    }
  } else {
    logger.warn('hookbot', `Session discovery failed: ${sessionsResp.status} ${sessionsResp.statusText}`)
  }

  return discovered
}

async function main() {
  const configPath = process.env.HOOK_CONFIG_PATH || 'data/hook-config.json'

  let config: HookBotConfig
  try {
    const configData = await fs.readFile(configPath, 'utf-8')
    config = JSON.parse(configData)
  } catch (err) {
    logger.error('hookbot', `Failed to load config from ${configPath}: ${err instanceof Error ? err.message : 'unknown'}`)
    process.exit(1)
  }

  if (!config.botToken || !config.chatId || !config.serverUrl) {
    logger.error('hookbot', 'Invalid config: botToken, chatId, and serverUrl are required')
    process.exit(1)
  }

  logger.info('hookbot', 'Starting Hook Bot composition root...')

  if (isRunningUnderPM2()) {
    await waitForServer({
      serverUrl: config.serverUrl,
      username: config.serverUsername,
      password: config.serverPassword,
      logContext: 'hookbot',
    })
  }

  const openCode = createOpenCodeAdapter(config.serverUrl, config.serverUsername, config.serverPassword)

  let projects = config.projects || []
  if (config.mode === 'all') {
    logger.info('hookbot', 'Mode is "all", discovering projects from server...')
    try {
      projects = await discoverProjectsFromServer(config, projects)
    } catch (err) {
      logger.error('hookbot', `Project discovery failed: ${err instanceof Error ? err.message : 'unknown'}`)
      process.exit(1)
    }
    config.projects = projects
  }

  const bot = createHookBot(config.botToken)
  
  bot.use(createHookBotAuthGuard(config.chatId))

  const hookBotState = createHookBotStateStore()
  const hookBotOutput = createChatOutputAdapter(bot)
  const interactiveFlow = createInteractiveFlow({
    openCode,
    state: hookBotState,
    output: hookBotOutput,
  })

  const notificationPort = createHookBotNotificationAdapter(bot, config.chatId, openCode, config, interactiveFlow)
  const watcher = createCompletionWatcher({ openCode, notificationPort })

  await watcher.startWatching(projects)

  const discoverAndWatch = async (): Promise<number> => {
    const discovered = await discoverProjectsFromServer(config, projects)
    const existingSet = new Set(projects.map(p => p.directory))
    const newlyFound = discovered.filter(p => !existingSet.has(p.directory))
    if (newlyFound.length === 0) return 0

    for (const p of newlyFound) {
      projects.push(p)
    }
    config.projects = projects
    await watcher.startWatching(newlyFound)
    logger.info('hookbot', `Discovered ${newlyFound.length} new project(s); now monitoring ${projects.length}`)
    return newlyFound.length
  }

  registerHookBotHandlers(bot, openCode, config, { watcher, discoverAndWatch, interactiveFlow })

  bot.start({
    drop_pending_updates: true,
    onStart: (botInfo) => {
      logger.info('hookbot', `Hook bot started — monitoring ${projects.length} project(s)`)
      logger.info('hookbot', `Bot: @${botInfo.username}, Chat: ${config.chatId}`)
    }
  })

  async function shutdown(signal: string) {
    logger.info('hookbot', `Received ${signal}, shutting down...`)
    watcher.stopAll()
    await bot.stop()
    logger.info('hookbot', 'Hook bot stopped')
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  logger.error('hookbot', `Fatal error: ${err instanceof Error ? err.message : 'unknown'}`)
  process.exit(1)
})
