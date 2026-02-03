import type { BotRegistryPort } from '../../domain/ports/BotRegistryPort.js'
import type { BotRegistryEntry } from '../../domain/models.js'
import { mock } from 'bun:test'

export function createMockBotRegistryPort(
  overrides: Partial<BotRegistryPort> = {},
): BotRegistryPort {
  const register: BotRegistryPort['register'] = mock(() => Promise.resolve())

  const unregister: BotRegistryPort['unregister'] = mock(() => Promise.resolve())

  const list: BotRegistryPort['list'] = mock(() => Promise.resolve<BotRegistryEntry[]>([]))

  const findByRole: BotRegistryPort['findByRole'] = mock(() =>
    Promise.resolve<BotRegistryEntry[]>([]),
  )

  const defaults: BotRegistryPort = {
    register,
    unregister,
    list,
    findByRole,
  }

  return { ...defaults, ...overrides }
}
