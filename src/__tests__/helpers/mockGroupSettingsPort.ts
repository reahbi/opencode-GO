import type { GroupSettingsPort } from '../../domain/ports/GroupSettingsPort.js'
import type { GroupSettings } from '../../domain/models.js'
import { createDefaultGroupSettings } from '../../domain/models.js'
import { mock } from 'bun:test'

export function createMockGroupSettingsPort(
  overrides: Partial<GroupSettingsPort> = {},
): GroupSettingsPort {
  let stored: GroupSettings = createDefaultGroupSettings()

  const getGroupSettings: GroupSettingsPort['getGroupSettings'] = mock(() =>
    Promise.resolve({ ...stored }),
  )

  const saveGroupSettings: GroupSettingsPort['saveGroupSettings'] = mock(
    async (settings: GroupSettings) => {
      stored = { ...settings }
    },
  )

  const defaults: GroupSettingsPort = {
    getGroupSettings,
    saveGroupSettings,
  }

  return { ...defaults, ...overrides }
}
