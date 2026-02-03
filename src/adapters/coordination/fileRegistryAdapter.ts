import type { BotRegistryPort } from '../../domain/ports/BotRegistryPort.js'
import type { BotRegistryEntry } from '../../domain/models.js'
import { logger } from '../../shared/logger.js'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'

interface RegistryData {
  bots: Record<string, BotRegistryEntry>
}

const READ_RETRY_DELAY_MS = 50
const READ_MAX_RETRIES = 3
const LOCK_STALE_MS = 10_000

export function createFileRegistryAdapter(baseDir: string): BotRegistryPort {
  const filepath = resolve(baseDir, 'registry.json')
  const lockPath = `${filepath}.lock`

  const knownEntries = new Map<string, string>()

  function entryFingerprint(entry: BotRegistryEntry): string {
    return `${entry.botUsername}|${entry.botRole}|${entry.projectDir}|${entry.serverUrl}`
  }

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

  async function read(): Promise<RegistryData> {
    for (let attempt = 0; attempt < READ_MAX_RETRIES; attempt++) {
      try {
        const content = await fs.readFile(filepath, 'utf-8')
        return JSON.parse(content) as RegistryData
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return { bots: {} }
        }
        if (error instanceof SyntaxError && attempt < READ_MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, READ_RETRY_DELAY_MS))
          continue
        }
        logger.warn('registry', `Failed to read registry: ${error}`)
        return { bots: {} }
      }
    }
    return { bots: {} }
  }

  async function write(data: RegistryData): Promise<void> {
    const random = Math.random().toString(36).substring(7)
    const tmpPath = `${filepath}.tmp.${random}`
    await fs.mkdir(resolve(baseDir), { recursive: true })
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmpPath, filepath)
  }

  async function withLock<T>(fn: (data: RegistryData) => { data: RegistryData; result: T }): Promise<T> {
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
    async register(entry) {
      await withLock(data => {
        data.bots[entry.instanceName] = entry
        return { data, result: undefined }
      })

      const fp = entryFingerprint(entry)
      const prev = knownEntries.get(entry.instanceName)
      if (prev !== fp) {
        knownEntries.set(entry.instanceName, fp)
        if (prev === undefined) {
          logger.debug('registry', `Registered bot: ${entry.instanceName} (@${entry.botUsername})`)
        } else {
          logger.debug('registry', `Updated bot: ${entry.instanceName} (@${entry.botUsername})`)
        }
      }
    },

    async unregister(instanceName) {
      await withLock(data => {
        delete data.bots[instanceName]
        return { data, result: undefined }
      })
      knownEntries.delete(instanceName)
      logger.debug('registry', `Unregistered bot: ${instanceName}`)
    },

    async list() {
      const data = await read()
      return Object.values(data.bots)
    },

    async findByRole(role) {
      const data = await read()
      return Object.values(data.bots).filter(b => b.botRole === role)
    },
  }
}
