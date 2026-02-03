import type { BotRegistryEntry } from '../models.js'

export interface BotRegistryPort {
  register(entry: BotRegistryEntry): Promise<void>
  unregister(instanceName: string): Promise<void>
  list(): Promise<BotRegistryEntry[]>
  findByRole(role: BotRegistryEntry['botRole']): Promise<BotRegistryEntry[]>
}
