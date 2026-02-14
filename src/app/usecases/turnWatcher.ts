/**
 * TurnWatcher — monitors ~/.claude/projects/ JSONL files to detect per-turn
 * completion of ANY Claude Code session (CLI, Telegram bot, etc.).
 *
 * Detection is based on the `type=system, subtype=turn_duration` marker that
 * Claude Code appends at the end of every turn. This gives zero false positives
 * compared to idle-timeout heuristics.
 */

import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import type { HookNotificationPort } from '../../domain/ports/HookNotificationPort.js'
import { logger } from '../../shared/logger.js'
import { LIMITS } from '../policies/limits.js'

interface TrackedFile {
  path: string
  byteOffset: number
  lastModTime: number
  sessionId: string
  projectDir: string
  projectName: string
  /** UUID of the last turn_duration we processed (deduplication) */
  lastTurnUuid: string | null
  seenQuestionToolUseIds: Set<string>
  /** Buffer for incomplete last line from previous read */
  partialLine: string
}

interface TextContentBlock {
  type?: string
  text?: string
}

interface ToolUseContentBlock {
  type?: string
  id?: string
  name?: string
  input?: unknown
}

interface JsonlEntry {
  type?: string
  subtype?: string
  uuid?: string
  durationMs?: number
  cwd?: string
  sessionId?: string
  message?: {
    role?: string
    content?: string | Array<TextContentBlock | ToolUseContentBlock>
  }
  isMeta?: boolean
  isSidechain?: boolean
}

interface ParsedQuestion {
  text: string
  options?: string[]
  multiple?: boolean
}

interface TurnWatcherDeps {
  notificationPort: HookNotificationPort
  /** Project directories to watch. If empty, discovers from ~/.claude/projects/ */
  projects?: Array<{ directory: string; name: string }>
  /** Path to instances directory (e.g. data/instances) — used to skip sessions already managed by main bots */
  instancesDir?: string
}

export function createTurnWatcher(deps: TurnWatcherDeps) {
  const tracked = new Map<string, TrackedFile>()
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let scanning = false
  let managedSessionIds = new Set<string>()

  const claudeProjectsDir = join(homedir(), '.claude', 'projects')

  /** Refresh the set of session IDs managed by main bot instances (to avoid duplicates) */
  async function refreshManagedSessions(): Promise<void> {
    if (!deps.instancesDir) return
    try {
      const dirs = await fs.readdir(deps.instancesDir, { withFileTypes: true })
      const ids = new Set<string>()
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue
        try {
          const stateRaw = await fs.readFile(join(deps.instancesDir!, dir.name, 'state.json'), 'utf-8')
          const parsed = JSON.parse(stateRaw) as Record<string, { activeSessionId?: string | null }>
          for (const chatState of Object.values(parsed)) {
            if (chatState?.activeSessionId) {
              ids.add(chatState.activeSessionId)
            }
          }
        } catch {
          // skip unreadable state files
        }
      }
      managedSessionIds = ids
    } catch {
      // instancesDir doesn't exist
    }
  }

  /** Convert a project directory path to the Claude Code hash format */
  function projectDirToHash(dir: string): string {
    return dir.replace(/\//g, '-')
  }

  /** Get the list of project hashes to monitor */
  function getProjectHashes(): Map<string, { directory: string; name: string }> {
    const result = new Map<string, { directory: string; name: string }>()
    if (deps.projects && deps.projects.length > 0) {
      for (const p of deps.projects) {
        const hash = projectDirToHash(p.directory)
        result.set(hash, p)
      }
    }
    return result
  }

  /** Scan for JSONL files in a project's Claude directory */
  async function scanProjectDir(
    dirPath: string,
    project: { directory: string; name: string },
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const now = Date.now()

      const jsonlFiles = entries.filter(e => e.isFile() && e.name.endsWith('.jsonl'))

      // Sort by name (UUID-based, newest activity likely at end)
      // Limit tracked files per project
      const toCheck = jsonlFiles.slice(-LIMITS.TURN_WATCH_MAX_FILES)

      for (const file of toCheck) {
        const filePath = join(dirPath, file.name)
        const sessionId = basename(file.name, '.jsonl')

        if (tracked.has(filePath)) continue

        try {
          const stat = await fs.stat(filePath)
          // Skip stale files
          if (now - stat.mtimeMs > LIMITS.TURN_WATCH_STALE_MS) continue

          tracked.set(filePath, {
            path: filePath,
            byteOffset: stat.size, // Start from current end — don't replay old turns
            lastModTime: stat.mtimeMs,
            sessionId,
            projectDir: project.directory,
            projectName: project.name,
            lastTurnUuid: null,
            seenQuestionToolUseIds: new Set(),
            partialLine: '',
          })
        } catch {
          // file disappeared between readdir and stat
        }
      }
    } catch {
      // directory doesn't exist or not readable
    }
  }

  /** Read new bytes from a tracked JSONL file and process entries */
  async function processFile(file: TrackedFile): Promise<void> {
    let stat: Awaited<ReturnType<typeof fs.stat>>
    try {
      stat = await fs.stat(file.path)
    } catch {
      // File deleted — remove from tracking
      tracked.delete(file.path)
      return
    }

    // No new data
    if (stat.size <= file.byteOffset) {
      // File might have been truncated/recreated
      if (stat.size < file.byteOffset) {
        file.byteOffset = 0
        file.seenQuestionToolUseIds.clear()
        file.partialLine = ''
      }
      return
    }

    const bytesToRead = Math.min(stat.size - file.byteOffset, LIMITS.TURN_WATCH_MAX_READ_BYTES)

    let handle: fs.FileHandle | null = null
    try {
      handle = await fs.open(file.path, 'r')
      const buffer = Buffer.alloc(bytesToRead)
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, file.byteOffset)
      await handle.close()
      handle = null

      if (bytesRead === 0) return

      file.byteOffset += bytesRead
      file.lastModTime = stat.mtimeMs

      const rawText = file.partialLine + buffer.subarray(0, bytesRead).toString('utf-8')
      const lines = rawText.split('\n')

      // Last element might be incomplete — save for next read
      file.partialLine = lines.pop() ?? ''

      // Collect parsed entries for turn detection
      const entries: JsonlEntry[] = []
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          entries.push(JSON.parse(line) as JsonlEntry)
        } catch {
          // malformed line, skip
        }
      }

      for (const entry of entries) {
        if (managedSessionIds.has(file.sessionId)) continue
        if (entry.isSidechain || entry.isMeta) continue
        if (entry.type !== 'assistant' || entry.message?.role !== 'assistant') continue

        const content = entry.message.content
        if (!Array.isArray(content)) continue

        for (const part of content) {
          if (!part || typeof part !== 'object') continue
          if (part.type !== 'tool_use') continue

          const toolUsePart = part as ToolUseContentBlock
          if (toolUsePart.name !== 'AskUserQuestion') continue

          const requestId = typeof toolUsePart.id === 'string' ? toolUsePart.id : ''
          if (!requestId) continue
          if (file.seenQuestionToolUseIds.has(requestId)) continue

          const questions = parseAskUserQuestions(toolUsePart.input)
          if (questions.length === 0) continue

          file.seenQuestionToolUseIds.add(requestId)
          try {
            await deps.notificationPort.notify({
              type: 'question',
              sessionId: file.sessionId,
              directory: file.projectDir,
              projectName: file.projectName,
              requestId,
              questions,
            })
          } catch (err) {
            logger.warn('hookbot', `Question notification failed: ${err instanceof Error ? err.message : 'unknown'}`)
          }
        }
      }

      // Look for turn_duration entries
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (entry.type === 'system' && entry.subtype === 'turn_duration' && entry.uuid) {
          // Deduplication
          if (file.lastTurnUuid === entry.uuid) continue
          file.lastTurnUuid = entry.uuid

          // Extract project dir from entry if available
          if (entry.cwd && !file.projectDir) {
            file.projectDir = entry.cwd
          }

          // Skip sessions managed by main bots (they use hookNotify directly)
          if (managedSessionIds.has(file.sessionId)) continue

          // Walk backwards through entries to find user prompt and assistant response
          const turnData = extractTurnData(entries, i, entry.durationMs)

          if (turnData.assistantResponse) {
            try {
              await deps.notificationPort.notify({
                type: 'turn',
                sessionId: file.sessionId,
                directory: file.projectDir,
                projectName: file.projectName,
                userPrompt: turnData.userPrompt,
                assistantResponse: turnData.assistantResponse,
                costUsd: undefined, // Not available in JSONL
              })
            } catch (err) {
              logger.warn('hookbot', `Notification failed: ${err instanceof Error ? err.message : 'unknown'}`)
            }
          }
        }
      }
    } catch (err) {
      if (handle) await handle.close().catch(() => {})
      logger.debug('hookbot', `Error reading ${file.path}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  /** Extract user prompt and assistant response from entries before a turn_duration marker */
  function extractTurnData(
    entries: JsonlEntry[],
    turnDurationIdx: number,
    _durationMs?: number,
  ): { userPrompt: string; assistantResponse: string } {
    let userPrompt = ''
    let assistantResponse = ''

    // Walk backwards from turn_duration to find the last assistant and user entries
    for (let i = turnDurationIdx - 1; i >= 0; i--) {
      const e = entries[i]

      // Skip sidechain entries (subagent internal)
      if (e.isSidechain) continue

      // Find last assistant response
      if (!assistantResponse && e.type === 'assistant' && e.message?.role === 'assistant') {
        assistantResponse = extractTextFromMessage(e.message)
        continue
      }

      // Find last user prompt (non-meta)
      if (!userPrompt && e.type === 'user' && e.message?.role === 'user' && !e.isMeta) {
        userPrompt = extractTextFromMessage(e.message)
        continue
      }

      // Once we have both, stop searching
      if (userPrompt && assistantResponse) break

      // Don't search past a previous turn_duration
      if (e.type === 'system' && e.subtype === 'turn_duration') break
    }

    return { userPrompt, assistantResponse }
  }

  /** Extract text content from a JSONL message object */
  function extractTextFromMessage(message: JsonlEntry['message']): string {
    if (!message) return ''

    const content = message.content
    if (typeof content === 'string') return content

    if (Array.isArray(content)) {
      const textParts: string[] = []
      for (const part of content) {
        if (!part || typeof part !== 'object') continue
        if (part.type !== 'text') continue
        if ('text' in part && typeof part.text === 'string') {
          textParts.push(part.text)
        }
      }
      return textParts.join('\n')
    }

    return ''
  }

  function parseAskUserQuestions(input: unknown): ParsedQuestion[] {
    if (typeof input !== 'object' || input === null) return []

    const inputObj = input as Record<string, unknown>
    if (!Array.isArray(inputObj.questions)) return []

    const parsed: ParsedQuestion[] = []

    for (const rawQuestion of inputObj.questions) {
      if (typeof rawQuestion !== 'object' || rawQuestion === null) continue

      const qObj = rawQuestion as Record<string, unknown>
      const text = typeof qObj.question === 'string'
        ? qObj.question
        : (typeof qObj.header === 'string' ? qObj.header : '')

      let options: string[] | undefined
      if (Array.isArray(qObj.options)) {
        const labels = qObj.options
          .map((opt: unknown) => {
            if (typeof opt === 'string') return opt
            if (typeof opt === 'object' && opt !== null) {
              const label = (opt as Record<string, unknown>).label
              if (typeof label === 'string') return label
            }
            return undefined
          })
          .filter((label): label is string => label !== undefined)

        if (labels.length > 0) options = labels
      }

      const question: ParsedQuestion = { text }
      if (options) question.options = options
      if (typeof qObj.multiSelect === 'boolean') {
        question.multiple = qObj.multiSelect
      }

      parsed.push(question)
    }

    return parsed
  }

  /** Main poll cycle */
  async function poll(): Promise<void> {
    if (scanning) return
    scanning = true

    try {
      await refreshManagedSessions()
      const projectHashes = getProjectHashes()

      if (projectHashes.size === 0) {
        // Auto-discover: scan all subdirectories of ~/.claude/projects/
        try {
          const dirs = await fs.readdir(claudeProjectsDir, { withFileTypes: true })
          for (const dir of dirs) {
            if (!dir.isDirectory()) continue
            const dirPath = join(claudeProjectsDir, dir.name)
            // Reverse hash to get approximate project name
            const name = dir.name.split('-').pop() || dir.name
            await scanProjectDir(dirPath, { directory: dir.name, name })
          }
        } catch {
          // ~/.claude/projects/ doesn't exist
        }
      } else {
        // Watch configured projects
        for (const [hash, project] of projectHashes) {
          const dirPath = join(claudeProjectsDir, hash)
          await scanProjectDir(dirPath, project)
        }
      }

      // Prune stale tracked files
      const now = Date.now()
      for (const [path, file] of tracked) {
        if (now - file.lastModTime > LIMITS.TURN_WATCH_STALE_MS) {
          tracked.delete(path)
        }
      }

      // Process all tracked files
      const fileList = [...tracked.values()]
      for (const file of fileList) {
        await processFile(file)
      }
    } catch (err) {
      logger.warn('hookbot', `Poll error: ${err instanceof Error ? err.message : 'unknown'}`)
    } finally {
      scanning = false
    }
  }

  return {
    /** Start the turn watcher polling loop */
    start(): void {
      if (pollTimer) return
      logger.info('hookbot', `Starting turn watcher (poll every ${LIMITS.TURN_WATCH_POLL_MS}ms)`)
      // Run initial poll immediately
      void poll()
      pollTimer = setInterval(() => void poll(), LIMITS.TURN_WATCH_POLL_MS)
    },

    /** Stop the turn watcher */
    stop(): void {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      tracked.clear()
      logger.info('hookbot', 'Turn watcher stopped')
    },

    /** Get current tracking status */
    getStatus(): { trackedFiles: number; projects: string[] } {
      const projects = new Set<string>()
      for (const file of tracked.values()) {
        projects.add(file.projectName)
      }
      return {
        trackedFiles: tracked.size,
        projects: [...projects],
      }
    },
  }
}
