import type { GroupSettingsPort } from '../../domain/ports/GroupSettingsPort.js'
import type { GroupSettings } from '../../domain/models.js'
import { createDefaultGroupSettings } from '../../domain/models.js'
import { logger } from '../../shared/logger.js'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'

export function createFileGroupSettingsAdapter(baseDir: string): GroupSettingsPort {
  const filepath = resolve(baseDir, 'group-settings.json')

  async function read(): Promise<GroupSettings> {
    try {
      const content = await fs.readFile(filepath, 'utf-8')
      const raw = JSON.parse(content) as Partial<GroupSettings>
      return { ...createDefaultGroupSettings(), ...raw }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return createDefaultGroupSettings()
      }
      logger.warn('state', `Failed to read group settings: ${error}`)
      return createDefaultGroupSettings()
    }
  }

  async function write(settings: GroupSettings): Promise<void> {
    await fs.mkdir(baseDir, { recursive: true })
    const random = Math.random().toString(36).substring(7)
    const tmpPath = `${filepath}.tmp.${random}`
    await fs.writeFile(tmpPath, JSON.stringify(settings, null, 2), 'utf-8')
    await fs.rename(tmpPath, filepath)
  }

  return {
    async getGroupSettings() {
      return read()
    },
    async saveGroupSettings(settings) {
      await write(settings)
    },
  }
}
