import type { CustomAgentPort } from '../../domain/ports/CustomAgentPort.js'
import type { CustomAgent } from '../../domain/models.js'
import { logger } from '../../shared/logger.js'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'

interface CustomAgentData {
  agents: Record<string, CustomAgent>
}

const READ_RETRY_DELAY_MS = 50
const READ_MAX_RETRIES = 3
const LOCK_STALE_MS = 10_000

export function createFileCustomAgentAdapter(baseDir: string): CustomAgentPort {
  const filepath = resolve(baseDir, 'custom-agents.json')
  const lockPath = `${filepath}.lock`

  async function acquireLock(): Promise<void> {
    const maxAttempts = 20
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await fs.writeFile(lockPath, `${process.pid}:${Date.now()}`, { flag: 'wx' })
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          try {
            const content = await fs.readFile(lockPath, 'utf-8')
            const timestamp = parseInt(content.split(':')[1] || '0', 10)
            if (Date.now() - timestamp > LOCK_STALE_MS) {
              try { await fs.unlink(lockPath) } catch {}
              continue
            }
          } catch {}
          await new Promise(r => setTimeout(r, READ_RETRY_DELAY_MS + Math.random() * 50))
          continue
        }
        throw error
      }
    }
    try { await fs.unlink(lockPath) } catch {}
    await fs.writeFile(lockPath, `${process.pid}:${Date.now()}`, { flag: 'wx' }).catch(() => {})
  }

  async function releaseLock(): Promise<void> {
    try { await fs.unlink(lockPath) } catch {}
  }

  async function read(): Promise<CustomAgentData> {
    for (let attempt = 0; attempt < READ_MAX_RETRIES; attempt++) {
      try {
        const content = await fs.readFile(filepath, 'utf-8')
        return JSON.parse(content) as CustomAgentData
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return { agents: {} }
        }
        if (error instanceof SyntaxError && attempt < READ_MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, READ_RETRY_DELAY_MS))
          continue
        }
        logger.warn('registry', `Failed to read custom agent registry: ${error}`)
        return { agents: {} }
      }
    }
    return { agents: {} }
  }

  async function write(data: CustomAgentData): Promise<void> {
    const random = Math.random().toString(36).substring(7)
    const tmpPath = `${filepath}.tmp.${random}`
    await fs.mkdir(resolve(baseDir), { recursive: true })
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmpPath, filepath)
  }

  async function withLock<T>(fn: (data: CustomAgentData) => { data: CustomAgentData; result: T }): Promise<T> {
    await acquireLock()
    try {
      const current = await read()
      const { data: updated, result } = fn(current)
      await write(updated)
      return result
    } finally {
      await releaseLock()
    }
  }

  return {
    async save(agent) {
      await withLock(data => {
        data.agents[agent.id] = agent
        return { data, result: undefined }
      })
    },

    async get(id) {
      const data = await read()
      return data.agents[id] ?? null
    },

    async list() {
      const data = await read()
      return Object.values(data.agents).sort((a, b) => b.updatedAt - a.updatedAt)
    },

    async delete(id) {
      await withLock(data => {
        delete data.agents[id]
        return { data, result: undefined }
      })
    },
  }
}
