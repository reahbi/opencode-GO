import type { OpenCodePort } from '../../domain/ports/OpenCodePort.js'
import type { HookNotificationPort } from '../../domain/ports/HookNotificationPort.js'
import type { OpenCodeEvent } from '../../domain/events.js'
import type { TrackedSession } from '../../domain/hookBotTypes.js'
import { LIMITS } from '../policies/limits.js'
import { logger } from '../../shared/logger.js'

interface CompletionWatcherDeps {
  openCode: OpenCodePort
  notificationPort: HookNotificationPort
}

interface ProjectWatcher {
  directory: string
  name: string
  abort: AbortController
  connected: boolean
  stallTimer: ReturnType<typeof setInterval> | null
}

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

export function createCompletionWatcher(deps: CompletionWatcherDeps) {
  const projectWatchers = new Map<string, ProjectWatcher>()
  const busySessions = new Map<string, TrackedSession>()
  const lastStallWarningTimes = new Map<string, number>()

  function compositeKey(directory: string, sessionId: string): string {
    return `${directory}:${sessionId}`
  }

  // ── Fire-and-forget completion fetch + notify ──────────────────────

  async function fetchAndNotifyCompletion(
    sessionId: string,
    directory: string,
    projectName: string,
    tracked: TrackedSession,
  ): Promise<void> {
    try {
      const session = await deps.openCode.getSession(sessionId, directory)
      const messages = await deps.openCode.getSessionMessages(sessionId, directory)

      let lastMessage: string | undefined
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          const textPart = messages[i].parts.find(p => p.type === 'text')
          if (textPart && textPart.type === 'text') {
            lastMessage = textPart.text.slice(0, 500)
          }
          break
        }
      }

      const duration = Date.now() - tracked.busySince

      await deps.notificationPort.notify({
        type: 'completion',
        sessionId,
        directory,
        projectName,
        sessionTitle: session?.title ?? tracked.sessionTitle,
        duration,
        lastMessage,
      })
    } catch (err) {
      logger.error('hookbot', `Failed to fetch/notify completion for session ${sessionId}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  // ── SSE event handler (synchronous — must NOT block) ───────────────

  function handleEvent(directory: string, projectName: string, event: OpenCodeEvent): void {
    switch (event.type) {
      case 'session.busy': {
        const key = compositeKey(directory, event.data.sessionId)
        if (!busySessions.has(key)) {
          const now = Date.now()
          busySessions.set(key, {
            sessionId: event.data.sessionId,
            directory,
            projectName,
            busySince: now,
            lastActivityTime: now,
          })
          logger.info('hookbot', `Session ${event.data.sessionId} became busy in ${projectName}`)
        }
        break
      }

      case 'session.idle': {
        const key = compositeKey(directory, event.data.sessionId)
        const tracked = busySessions.get(key)
        if (tracked) {
          void fetchAndNotifyCompletion(event.data.sessionId, directory, projectName, tracked)
          busySessions.delete(key)
          lastStallWarningTimes.delete(key)
          logger.info('hookbot', `Session ${event.data.sessionId} completed in ${projectName}`)
        }
        break
      }

      case 'session.error': {
        const key = compositeKey(directory, event.data.sessionId)
        void deps.notificationPort.notify({
          type: 'error',
          sessionId: event.data.sessionId,
          directory,
          projectName,
          error: event.data.error,
        }).catch(err => {
          logger.error('hookbot', `Failed to notify error: ${err instanceof Error ? err.message : 'unknown'}`)
        })
        busySessions.delete(key)
        lastStallWarningTimes.delete(key)
        break
      }

      case 'permission.asked': {
        void deps.notificationPort.notify({
          type: 'permission',
          sessionId: event.data.sessionId,
          directory,
          projectName,
          requestId: event.data.requestId,
          permission: event.data.permission,
          patterns: event.data.patterns,
          title: event.data.title,
        }).catch(err => {
          logger.error('hookbot', `Failed to notify permission: ${err instanceof Error ? err.message : 'unknown'}`)
        })
        break
      }

      case 'question.asked': {
        void deps.notificationPort.notify({
          type: 'question',
          sessionId: event.data.sessionId,
          directory,
          projectName,
          requestId: event.data.requestId,
          questions: event.data.questions.map(q => ({
            text: q.text,
            options: q.options,
            multiple: q.multiple,
          })),
        }).catch(err => {
          logger.error('hookbot', `Failed to notify question: ${err instanceof Error ? err.message : 'unknown'}`)
        })
        break
      }

      case 'message.part.updated':
      case 'tool.part.updated':
      case 'session.retry': {
        const key = compositeKey(directory, event.data.sessionId)
        const tracked = busySessions.get(key)
        if (tracked) {
          tracked.lastActivityTime = Date.now()
        }
        break
      }

      default:
        break
    }
  }

  // ── Reconnect reconciliation ───────────────────────────────────────

  async function reconcileOnReconnect(directory: string, projectName: string): Promise<void> {
    try {
      const statuses = await deps.openCode.getSessionStatuses(directory)

      // Check tracked sessions — if now idle, emit completion
      for (const [key, tracked] of busySessions) {
        if (tracked.directory !== directory) continue
        const status = statuses[tracked.sessionId]
        if (!status || status.type === 'idle') {
          void fetchAndNotifyCompletion(tracked.sessionId, directory, projectName, tracked)
          busySessions.delete(key)
          lastStallWarningTimes.delete(key)
          logger.info('hookbot', `Reconcile: session ${tracked.sessionId} completed while disconnected`)
        }
      }

      // Discover newly busy sessions
      for (const [sessionId, status] of Object.entries(statuses)) {
        if (status.type === 'busy') {
          const key = compositeKey(directory, sessionId)
          if (!busySessions.has(key)) {
            const now = Date.now()
            busySessions.set(key, {
              sessionId,
              directory,
              projectName,
              busySince: now,
              lastActivityTime: now,
            })
            logger.info('hookbot', `Reconcile: discovered busy session ${sessionId} in ${projectName}`)
          }
        }
      }
    } catch (err) {
      logger.error('hookbot', `Reconcile failed for ${projectName}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  // ── Sleep helper (abort-aware) ─────────────────────────────────────

  function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      if (signal.aborted) { resolve(); return }
      const timer = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
    })
  }

  // ── SSE reconnection loop ─────────────────────────────────────────

  async function runSseLoop(watcher: ProjectWatcher): Promise<void> {
    let backoffMs = RECONNECT_BASE_MS

    while (!watcher.abort.signal.aborted) {
      try {
        // Reconcile on each (re)connect
        await reconcileOnReconnect(watcher.directory, watcher.name)
        if (watcher.abort.signal.aborted) return

        watcher.connected = true
        backoffMs = RECONNECT_BASE_MS
        logger.info('hookbot', `SSE connected for project ${watcher.name}`)

        await deps.openCode.streamEvents(
          watcher.directory,
          (event) => handleEvent(watcher.directory, watcher.name, event),
          watcher.abort.signal,
        )

        if (watcher.abort.signal.aborted) return
        watcher.connected = false
        logger.debug('hookbot', `SSE disconnected for project ${watcher.name}, reconnecting in ${backoffMs}ms`)

        await sleep(backoffMs, watcher.abort.signal)
        backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS)
      } catch (err) {
        if (watcher.abort.signal.aborted) return
        watcher.connected = false
        logger.warn('hookbot', `SSE error for project ${watcher.name}: ${err instanceof Error ? err.message : 'unknown'}, reconnecting in ${backoffMs}ms`)

        await sleep(backoffMs, watcher.abort.signal)
        backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS)
      }
    }
  }

  // ── Stall detection (per-project interval) ─────────────────────────

  function startStallDetection(watcher: ProjectWatcher): void {
    watcher.stallTimer = setInterval(() => {
      if (watcher.abort.signal.aborted) {
        if (watcher.stallTimer) clearInterval(watcher.stallTimer)
        return
      }

      const now = Date.now()
      for (const [key, tracked] of busySessions) {
        if (tracked.directory !== watcher.directory) continue

        const inactiveDuration = now - tracked.lastActivityTime
        if (inactiveDuration < LIMITS.HOOK_STALL_WARNING_MS) continue

        const lastWarning = lastStallWarningTimes.get(key) ?? 0
        const timeSinceLastWarning = now - lastWarning
        if (lastWarning > 0 && timeSinceLastWarning < LIMITS.HOOK_STALL_WARNING_MS) continue

        lastStallWarningTimes.set(key, now)
        void deps.notificationPort.notify({
          type: 'stall',
          sessionId: tracked.sessionId,
          directory: tracked.directory,
          projectName: tracked.projectName,
          inactiveDuration,
        }).catch(err => {
          logger.error('hookbot', `Failed to notify stall: ${err instanceof Error ? err.message : 'unknown'}`)
        })
      }
    }, LIMITS.HOOK_STALL_CHECK_INTERVAL_MS)
  }

  // ── Startup seeding ────────────────────────────────────────────────

  async function seedBusySessions(directory: string, projectName: string): Promise<void> {
    try {
      const statuses = await deps.openCode.getSessionStatuses(directory)
      const now = Date.now()

      for (const [sessionId, status] of Object.entries(statuses)) {
        if (status.type === 'busy') {
          const key = compositeKey(directory, sessionId)
          if (!busySessions.has(key)) {
            busySessions.set(key, {
              sessionId,
              directory,
              projectName,
              busySince: now,
              lastActivityTime: now,
            })
            logger.info('hookbot', `Seeded busy session ${sessionId} in ${projectName}`)
          }
        }
      }
    } catch (err) {
      logger.error('hookbot', `Failed to seed sessions for ${projectName}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  async function startWatching(projects: Array<{ directory: string; name: string }>): Promise<void> {
    for (const project of projects) {
      if (projectWatchers.has(project.directory)) continue

      const watcher: ProjectWatcher = {
        directory: project.directory,
        name: project.name,
        abort: new AbortController(),
        connected: false,
        stallTimer: null,
      }

      projectWatchers.set(project.directory, watcher)

      // Seed busy sessions before starting SSE
      await seedBusySessions(project.directory, project.name)

      // Start stall detection
      startStallDetection(watcher)

      // Start SSE loop (fire and forget)
      void runSseLoop(watcher)

      logger.info('hookbot', `Started watching project ${project.name} at ${project.directory}`)
    }
  }

  function stopAll(): void {
    for (const [, watcher] of projectWatchers) {
      watcher.abort.abort()
      if (watcher.stallTimer) {
        clearInterval(watcher.stallTimer)
        watcher.stallTimer = null
      }
      watcher.connected = false
      logger.info('hookbot', `Stopped watching project ${watcher.name}`)
    }
    projectWatchers.clear()
    busySessions.clear()
    lastStallWarningTimes.clear()
  }

  function getStatus() {
    const projects: Array<{ directory: string; name: string; connected: boolean; busyCount: number }> = []
    for (const [, watcher] of projectWatchers) {
      let busyCount = 0
      for (const [, tracked] of busySessions) {
        if (tracked.directory === watcher.directory) busyCount++
      }
      projects.push({
        directory: watcher.directory,
        name: watcher.name,
        connected: watcher.connected,
        busyCount,
      })
    }
    return { projects }
  }

  return { startWatching, stopAll, getStatus }
}
