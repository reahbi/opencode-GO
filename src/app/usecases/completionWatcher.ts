import type { HookNotificationPort } from '../../domain/ports/HookNotificationPort.js'
import { logger } from '../../shared/logger.js'
import { LIMITS } from '../policies/limits.js'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

interface CompletionWatcherDeps {
  notificationPort: HookNotificationPort
}

interface ProjectWatcher {
  directory: string
  name: string
  pollInterval: ReturnType<typeof setInterval> | null
  lastActivityTime: number
  busySessions: Map<string, { busySince: number; lastActivity: number; stallWarnedAt?: number }>
  connected: boolean
}

const POLL_INTERVAL_MS = 5_000
const MAX_SCAN_DEPTH = 3

async function findClaudeSessionDir(projectDir: string): Promise<string | null> {
  // Claude CLI stores projects under ~/.claude/projects/
  // The project directory hash is used as the subfolder name
  const claudeDir = join(projectDir, '.claude')
  try {
    await fs.access(claudeDir)
    return claudeDir
  } catch {
    return null
  }
}

async function getLatestModTime(dir: string, depth = 0): Promise<number> {
  if (depth > MAX_SCAN_DEPTH) return 0
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    let latest = 0
    for (const entry of entries) {
      try {
        const fullPath = join(dir, entry.name)
        const stat = await fs.stat(fullPath)
        if (stat.mtimeMs > latest) latest = stat.mtimeMs
        if (entry.isDirectory()) {
          const sub = await getLatestModTime(fullPath, depth + 1)
          if (sub > latest) latest = sub
        }
      } catch {
        // skip inaccessible files
      }
    }
    return latest
  } catch {
    return 0
  }
}

async function readLastSessionContent(claudeDir: string): Promise<string | undefined> {
  try {
    const entries = await fs.readdir(claudeDir, { withFileTypes: true })
    let latestFile = ''
    let latestMtime = 0
    for (const entry of entries) {
      if (!entry.isFile()) continue
      try {
        const fullPath = join(claudeDir, entry.name)
        const stat = await fs.stat(fullPath)
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs
          latestFile = fullPath
        }
      } catch { /* skip */ }
    }
    if (!latestFile) return undefined
    const content = await fs.readFile(latestFile, 'utf-8')
    const lines = content.trimEnd().split('\n')
    return lines[lines.length - 1] || undefined
  } catch {
    return undefined
  }
}

export function createCompletionWatcher(deps: CompletionWatcherDeps) {
  const watchers = new Map<string, ProjectWatcher>()

  async function pollProject(pw: ProjectWatcher): Promise<void> {
    const claudeDir = await findClaudeSessionDir(pw.directory)
    if (!claudeDir) {
      if (pw.connected) {
        pw.connected = false
        logger.info('hookbot', `No .claude dir found in ${pw.directory}`)
      }
      return
    }

    if (!pw.connected) {
      pw.connected = true
      logger.info('hookbot', `Connected to ${pw.directory}`)
    }

    const latestMod = await getLatestModTime(claudeDir)

    if (latestMod > pw.lastActivityTime) {
      // New activity detected
      const wasIdle = pw.busySessions.size === 0
      const sessionKey = 'default'

      if (!pw.busySessions.has(sessionKey)) {
        pw.busySessions.set(sessionKey, {
          busySince: Date.now(),
          lastActivity: latestMod,
        })
        if (wasIdle) {
          logger.info('hookbot', `Activity detected in ${pw.name}`)
        }
      } else {
        const session = pw.busySessions.get(sessionKey)!
        session.lastActivity = latestMod
        session.stallWarnedAt = undefined
      }

      pw.lastActivityTime = latestMod
    } else {
      // Check for stall then completion
      const now = Date.now()
      for (const [sessionKey, session] of pw.busySessions.entries()) {
        const inactiveFor = now - session.lastActivity

        // Stall detection (once per stall period)
        if (inactiveFor > (LIMITS.HOOK_STALL_WARNING_MS ?? 300_000) && !session.stallWarnedAt) {
          session.stallWarnedAt = now
          logger.info('hookbot', `Stall detected in ${pw.name}: ${Math.round(inactiveFor / 1000)}s inactive`)

          await deps.notificationPort.notify({
            type: 'stall',
            sessionId: sessionKey,
            directory: pw.directory,
            projectName: pw.name,
            inactiveDuration: inactiveFor,
          })
          continue
        }

        // Completion detection
        if (inactiveFor > LIMITS.HOOK_IDLE_THRESHOLD_MS) {
          const duration = now - session.busySince
          pw.busySessions.delete(sessionKey)

          const lastMessage = await readLastSessionContent(claudeDir)

          logger.info('hookbot', `Session completed in ${pw.name} (duration: ${Math.round(duration / 1000)}s)`)

          await deps.notificationPort.notify({
            type: 'completion',
            sessionId: sessionKey,
            directory: pw.directory,
            projectName: pw.name,
            duration,
            lastMessage,
          })
        }
      }
    }
  }

  async function startWatching(projects: Array<{ directory: string; name: string }>): Promise<void> {
    for (const project of projects) {
      if (watchers.has(project.directory)) continue

      const pw: ProjectWatcher = {
        directory: project.directory,
        name: project.name,
        pollInterval: null,
        lastActivityTime: Date.now(),
        busySessions: new Map(),
        connected: false,
      }

      pw.pollInterval = setInterval(() => {
        pollProject(pw).catch(err => {
          logger.error('hookbot', `Poll error for ${project.name}: ${err instanceof Error ? err.message : String(err)}`)
        })
      }, POLL_INTERVAL_MS)

      watchers.set(project.directory, pw)
      logger.info('hookbot', `Watching ${project.name} (${project.directory})`)

      // Initial poll
      await pollProject(pw)
    }
  }

  function stopAll(): void {
    for (const [dir, pw] of watchers.entries()) {
      if (pw.pollInterval) {
        clearInterval(pw.pollInterval)
        pw.pollInterval = null
      }
      watchers.delete(dir)
    }
    logger.info('hookbot', 'All watchers stopped')
  }

  function getStatus() {
    const projects: Array<{ directory: string; name: string; connected: boolean; busyCount: number }> = []
    for (const pw of watchers.values()) {
      projects.push({
        directory: pw.directory,
        name: pw.name,
        connected: pw.connected,
        busyCount: pw.busySessions.size,
      })
    }
    return { projects }
  }

  async function _testPollAll(): Promise<void> {
    for (const pw of watchers.values()) {
      await pollProject(pw)
    }
  }

  return { startWatching, stopAll, getStatus, _testPollAll }
}
