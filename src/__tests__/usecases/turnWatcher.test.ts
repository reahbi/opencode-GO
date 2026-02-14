import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createTurnWatcher } from '../../app/usecases/turnWatcher.js'
import type { HookNotification } from '../../domain/hookBotTypes.js'
import type { HookNotificationPort } from '../../domain/ports/HookNotificationPort.js'
import { LIMITS } from '../../app/policies/limits.js'
import { waitFor } from '../helpers/async.js'

describe('createTurnWatcher question notifications', () => {
  let baseDir: string
  let projectDir: string
  let watchedDir: string
  let jsonlPath: string
  let sessionId: string
  let notifications: HookNotification[]
  let notificationPort: HookNotificationPort
  let originalPollMs: number

  function projectHash(dir: string): string {
    return dir.replace(/\//g, '-')
  }

  async function appendEntry(entry: unknown): Promise<void> {
    await fs.appendFile(jsonlPath, `${JSON.stringify(entry)}\n`, 'utf-8')
  }

  function buildAskUserQuestionEntry(toolUseId: string, multiSelect = true): Record<string, unknown> {
    return {
      type: 'assistant',
      sessionId,
      cwd: projectDir,
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: toolUseId,
            name: 'AskUserQuestion',
            input: {
              questions: [
                {
                  question: 'Select items',
                  options: [{ label: 'A' }, { label: 'B' }],
                  multiSelect,
                },
              ],
            },
          },
        ],
      },
    }
  }

  beforeEach(async () => {
    baseDir = join(tmpdir(), `turn-watcher-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    projectDir = join(baseDir, 'project')
    sessionId = `session-${Math.random().toString(36).slice(2)}`
    watchedDir = join(homedir(), '.claude', 'projects', projectHash(projectDir))
    jsonlPath = join(watchedDir, `${sessionId}.jsonl`)

    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(watchedDir, { recursive: true })
    await fs.writeFile(jsonlPath, '', 'utf-8')

    notifications = []
    notificationPort = {
      notify: mock(async (notification: HookNotification) => {
        notifications.push(notification)
      }),
    }

    originalPollMs = LIMITS.TURN_WATCH_POLL_MS
    ;(LIMITS as Record<string, unknown>).TURN_WATCH_POLL_MS = 30
  })

  afterEach(async () => {
    ;(LIMITS as Record<string, unknown>).TURN_WATCH_POLL_MS = originalPollMs
    try {
      await fs.rm(watchedDir, { recursive: true, force: true })
    } catch {}
    try {
      await fs.rm(baseDir, { recursive: true, force: true })
    } catch {}
  })

  it('emits question notification for AskUserQuestion tool_use', async () => {
    const watcher = createTurnWatcher({
      notificationPort,
      projects: [{ directory: projectDir, name: 'Test Project' }],
    })

    watcher.start()
    await waitFor(() => {
      expect(watcher.getStatus().trackedFiles).toBeGreaterThan(0)
    }, 2000, 40)

    await appendEntry(buildAskUserQuestionEntry('toolu_ask_1', true))

    await waitFor(() => {
      expect(notifications.length).toBe(1)
    }, 2000, 40)

    const notification = notifications[0]
    expect(notification.type).toBe('question')
    if (notification.type === 'question') {
      expect(notification.requestId).toBe('toolu_ask_1')
      expect(notification.sessionId).toBe(sessionId)
      expect(notification.projectName).toBe('Test Project')
      expect(notification.questions[0]?.text).toBe('Select items')
      expect(notification.questions[0]?.options).toEqual(['A', 'B'])
      expect(notification.questions[0]?.multiple).toBe(true)
    }

    watcher.stop()
  })

  it('deduplicates repeated AskUserQuestion with same tool_use id', async () => {
    const watcher = createTurnWatcher({
      notificationPort,
      projects: [{ directory: projectDir, name: 'Test Project' }],
    })

    watcher.start()
    await waitFor(() => {
      expect(watcher.getStatus().trackedFiles).toBeGreaterThan(0)
    }, 2000, 40)

    const duplicate = buildAskUserQuestionEntry('toolu_ask_dup', true)
    await appendEntry(duplicate)

    await waitFor(() => {
      expect(notifications.length).toBe(1)
    }, 2000, 40)

    await appendEntry(duplicate)
    await new Promise(resolve => setTimeout(resolve, 200))

    expect(notifications.length).toBe(1)

    watcher.stop()
  })

  it('skips question notifications for sessions managed by main bot', async () => {
    const instancesDir = join(baseDir, 'instances')
    const instanceStateDir = join(instancesDir, 'bot-a')
    await fs.mkdir(instanceStateDir, { recursive: true })
    await fs.writeFile(
      join(instanceStateDir, 'state.json'),
      JSON.stringify({ '1': { activeSessionId: sessionId } }),
      'utf-8',
    )

    const watcher = createTurnWatcher({
      notificationPort,
      projects: [{ directory: projectDir, name: 'Test Project' }],
      instancesDir,
    })

    watcher.start()
    await waitFor(() => {
      expect(watcher.getStatus().trackedFiles).toBeGreaterThan(0)
    }, 2000, 40)

    await appendEntry(buildAskUserQuestionEntry('toolu_ask_managed', true))
    await new Promise(resolve => setTimeout(resolve, 300))

    expect(notifications.length).toBe(0)

    watcher.stop()
  })
})
