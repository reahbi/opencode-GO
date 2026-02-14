import type { SessionStorePort, SessionMeta } from '../../domain/ports/SessionStorePort.js'
import type { HistoryMessage } from '../../domain/models.js'
import { logger } from '../../shared/logger.js'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'

const MAX_SESSIONS = 100
const MAX_MESSAGES_PER_SESSION = 200

export function createJsonSessionStore(dataDir: string): SessionStorePort {
  const filepath = resolve(dataDir, 'sessions.json')
  let fileLock: Promise<void> = Promise.resolve()

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
      return sessions.find(s => s.sessionId === id) ?? null
    },

    async listSessions(cwd) {
      const sessions = await readSessions()
      const filtered = cwd ? sessions.filter(s => s.cwd === cwd) : sessions
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
