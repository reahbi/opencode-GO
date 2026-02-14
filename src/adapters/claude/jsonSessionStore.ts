import type { SessionStorePort, SessionMeta } from '../../domain/ports/SessionStorePort.js'
import type { HistoryMessage } from '../../domain/models.js'
import { logger } from '../../shared/logger.js'
import { promises as fs, createReadStream } from 'node:fs'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'

const MAX_SESSIONS = 100
const MAX_MESSAGES_PER_SESSION = 200
const LOCAL_SESSION_CACHE_TTL_MS = 30_000

/** Convert a cwd path to Claude CLI's project directory name */
function cwdToClaudeProjectDir(cwd: string): string {
  return cwd.replace(/\//g, '-')
}

/** Clean raw JSONL user message into a display title */
function cleanTitle(text: string): string {
  let clean = text.replace(/<[^>]*>/g, '').trim()
  clean = clean.split('\n')[0].slice(0, 60)
  return clean || 'CLI Session'
}

/** Read first user message from a JSONL session file for title extraction */
async function readSessionTitle(filePath: string): Promise<string> {
  return new Promise((res) => {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8', end: 65536 }),
      crlfDelay: Infinity,
    })
    let found = false
    rl.on('line', (line) => {
      if (found) return
      try {
        const d = JSON.parse(line)
        if (d.type === 'user' && d.message?.role === 'user') {
          found = true
          rl.close()
          const content = d.message.content
          if (typeof content === 'string') {
            res(cleanTitle(content))
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') {
                res(cleanTitle(block.text))
                return
              }
            }
            res('CLI Session')
          } else {
            res('CLI Session')
          }
        }
      } catch { /* skip malformed lines */ }
    })
    rl.on('close', () => { if (!found) res('CLI Session') })
    rl.on('error', () => res('CLI Session'))
  })
}

function toHistoryTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

function parseTextParts(content: unknown): string[] {
  if (typeof content === 'string') {
    return content.trim() ? [content] : []
  }

  if (!Array.isArray(content)) {
    return []
  }

  const texts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const textBlock = block as { type?: unknown; text?: unknown }
    if (textBlock.type === 'text' && typeof textBlock.text === 'string' && textBlock.text.trim()) {
      texts.push(textBlock.text)
    }
  }
  return texts
}

function parseToolParts(content: unknown): Array<{ type: 'tool'; tool: string; title: string; status: string }> {
  if (!Array.isArray(content)) {
    return []
  }

  const tools: Array<{ type: 'tool'; tool: string; title: string; status: string }> = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const toolBlock = block as { type?: unknown; name?: unknown }
    if (toolBlock.type === 'tool_use' && typeof toolBlock.name === 'string' && toolBlock.name.trim()) {
      tools.push({ type: 'tool', tool: toolBlock.name, title: toolBlock.name, status: 'completed' })
    }
  }

  return tools
}

async function readLocalSessionMessages(filePath: string): Promise<HistoryMessage[]> {
  return new Promise((resolveMessages) => {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    })

    const messages: HistoryMessage[] = []
    rl.on('line', (line) => {
      try {
        const row = JSON.parse(line) as {
          type?: unknown
          timestamp?: unknown
          message?: {
            role?: unknown
            content?: unknown
          }
        }

        if (row.type !== 'user' && row.type !== 'assistant') return
        if (!row.message || typeof row.message !== 'object') return

        const role = row.message.role
        if (role !== 'user' && role !== 'assistant') return

        const textParts = parseTextParts(row.message.content)
        const parts: HistoryMessage['parts'] = textParts.map(text => ({ type: 'text', text }))

        if (role === 'assistant') {
          parts.push(...parseToolParts(row.message.content))
        }

        if (parts.length === 0) return

        messages.push({
          role,
          createdAt: toHistoryTimestamp(row.timestamp, Date.now()),
          parts,
        })
      } catch (err) {
        logger.debug('session', `Skip malformed local session line: ${err instanceof Error ? err.message : 'unknown'}`)
      }
    })

    rl.on('close', () => resolveMessages(messages))
    rl.on('error', () => resolveMessages(messages))
  })
}

async function readLocalSessionMessageCount(filePath: string): Promise<number> {
  return new Promise((resolveCount) => {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    })

    let count = 0
    rl.on('line', (line) => {
      try {
        const row = JSON.parse(line) as {
          type?: unknown
          message?: { role?: unknown }
        }

        if (row.type !== 'user' && row.type !== 'assistant') return
        const role = row.message?.role
        if (role !== 'user' && role !== 'assistant') return
        count += 1
      } catch {}
    })

    rl.on('close', () => resolveCount(count))
    rl.on('error', () => resolveCount(count))
  })
}

/** Find a single local CLI session by ID across all project directories */
async function findLocalSession(sessionId: string): Promise<SessionMeta | null> {
  const claudeProjectsDir = join(homedir(), '.claude', 'projects')

  try {
    const projectDirs = await fs.readdir(claudeProjectsDir)
    for (const dir of projectDirs) {
      const filePath = join(claudeProjectsDir, dir, `${sessionId}.jsonl`)
      try {
        const stat = await fs.stat(filePath)
        const title = await readSessionTitle(filePath)
        const messages = await readLocalSessionMessages(filePath)
        // Reverse the path encoding: -home-nosky-claude-go → /home/nosky/claude-go
        const cwd = '/' + dir.slice(1).replace(/-/g, '/')

        return {
          sessionId,
          title,
          createdAt: stat.birthtimeMs,
          lastActiveAt: stat.mtimeMs,
          messageCount: messages.length,
          status: 'idle',
          cwd,
          source: 'local',
          messages,
        }
      } catch { /* file doesn't exist in this dir */ }
    }
  } catch { /* projects dir not found */ }

  return null
}

/** Discover Claude CLI sessions from ~/.claude/projects/ */
async function discoverLocalSessions(cwd: string): Promise<SessionMeta[]> {
  const claudeProjectsDir = join(homedir(), '.claude', 'projects')
  const encoded = cwdToClaudeProjectDir(cwd)
  const projectDir = join(claudeProjectsDir, encoded)

  try {
    const entries = await fs.readdir(projectDir)
    const jsonlFiles = entries.filter(f => f.endsWith('.jsonl'))

    const sessions: SessionMeta[] = []
    for (const file of jsonlFiles) {
      const sessionId = file.replace('.jsonl', '')
      const filePath = join(projectDir, file)
      try {
        const stat = await fs.stat(filePath)
        const title = await readSessionTitle(filePath)
        const messageCount = await readLocalSessionMessageCount(filePath)

        sessions.push({
          sessionId,
          title,
          createdAt: stat.birthtimeMs,
          lastActiveAt: stat.mtimeMs,
          messageCount,
          status: 'idle',
          cwd,
          source: 'local',
        })
      } catch (err) {
        logger.debug('session', `Skip local session ${sessionId}: ${err instanceof Error ? err.message : 'unknown'}`)
      }
    }

    return sessions
  } catch {
    return []
  }
}

export function createJsonSessionStore(dataDir: string): SessionStorePort {
  const filepath = resolve(dataDir, 'sessions.json')
  let fileLock: Promise<void> = Promise.resolve()

  // Cache for local sessions to avoid re-scanning on every list call
  let localSessionCache: { cwd: string; sessions: SessionMeta[]; timestamp: number } | null = null

  async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = fileLock
    let resolveLock: () => void
    fileLock = new Promise(resolve => { resolveLock = resolve })
    await previous
    try {
      return await fn()
    } finally {
      resolveLock!()
    }
  }

  async function ensureFile(): Promise<void> {
    try {
      await fs.access(filepath)
    } catch {
      await fs.mkdir(resolve(filepath, '..'), { recursive: true })
      await atomicWrite([])
    }
  }

  async function atomicWrite(data: SessionMeta[]): Promise<void> {
    const random = Math.random().toString(36).substring(7)
    const tmpPath = `${filepath}.tmp.${random}`
    // Trim messages to limit for each session before writing
    const trimmed = data.map(session => {
      if (session.messages && session.messages.length > MAX_MESSAGES_PER_SESSION) {
        return {
          ...session,
          messages: session.messages.slice(-MAX_MESSAGES_PER_SESSION),
        }
      }
      return session
    })
    await fs.writeFile(tmpPath, JSON.stringify(trimmed, null, 2), 'utf-8')
    await fs.rename(tmpPath, filepath)
  }

  async function readSessions(): Promise<SessionMeta[]> {
    await ensureFile()
    try {
      const content = await fs.readFile(filepath, 'utf-8')
      const parsed = JSON.parse(content)
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      logger.error('session', `Failed to parse sessions file: ${error}`)
      const timestamp = Date.now()
      const corruptPath = `${filepath}.corrupt.${timestamp}`
      try {
        await fs.rename(filepath, corruptPath)
        logger.warn('session', `Corrupt sessions file backed up to ${corruptPath}`)
      } catch (backupError) {
        logger.error('session', `Failed to backup corrupt sessions file: ${backupError}`)
      }
      await atomicWrite([])
      return []
    }
  }

  return {
    async createSession(meta) {
      await withLock(async () => {
        const sessions = await readSessions()
        // Remove existing with same ID
        const filtered = sessions.filter(s => s.sessionId !== meta.sessionId)
        filtered.unshift(meta)
        // LRU eviction
        if (filtered.length > MAX_SESSIONS) {
          filtered.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
          filtered.length = MAX_SESSIONS
        }
        await atomicWrite(filtered)
        logger.debug('session', `Created session ${meta.sessionId}: ${meta.title}`)
      })
    },

    async getSession(id) {
      const sessions = await readSessions()
      const found = sessions.find(s => s.sessionId === id)
      if (found) {
        const foundMessages = found.messages?.length ?? 0
        if (foundMessages > 0) {
          return found
        }

        const local = await findLocalSession(id)
        if (local && (local.messages?.length ?? 0) > 0) {
          return {
            ...found,
            title: local.title,
            createdAt: local.createdAt,
            lastActiveAt: local.lastActiveAt,
            messageCount: local.messageCount,
            cwd: local.cwd,
            source: 'local',
            messages: local.messages,
          }
        }

        return found
      }

      // Fall back to local CLI sessions
      return findLocalSession(id)
    },

    async listSessions(cwd) {
      const botSessions = await readSessions()
      const filtered = cwd ? botSessions.filter(s => s.cwd === cwd) : botSessions
      // Tag bot sessions
      for (const s of filtered) {
        if (!s.source) s.source = 'bot'
      }

      // Merge with local CLI sessions
      if (cwd) {
        let localSessions: SessionMeta[]

        if (localSessionCache && localSessionCache.cwd === cwd && Date.now() - localSessionCache.timestamp < LOCAL_SESSION_CACHE_TTL_MS) {
          localSessions = localSessionCache.sessions
        } else {
          localSessions = await discoverLocalSessions(cwd)
          localSessionCache = { cwd, sessions: localSessions, timestamp: Date.now() }
        }

        // Deduplicate: bot sessions take precedence
        const botIds = new Set(filtered.map(s => s.sessionId))
        for (const local of localSessions) {
          if (!botIds.has(local.sessionId)) {
            filtered.push(local)
          }
        }
      }

      return filtered.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    },

    async updateSession(id, updates) {
      await withLock(async () => {
        const sessions = await readSessions()
        const idx = sessions.findIndex(s => s.sessionId === id)
        if (idx === -1) return
        sessions[idx] = { ...sessions[idx], ...updates }
        await atomicWrite(sessions)
      })
    },

    async deleteSession(id) {
      await withLock(async () => {
        const sessions = await readSessions()
        const filtered = sessions.filter(s => s.sessionId !== id)
        if (filtered.length !== sessions.length) {
          await atomicWrite(filtered)
          logger.debug('session', `Deleted session ${id}`)
        }
      })
    },
  }
}
