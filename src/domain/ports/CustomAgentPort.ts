import type { CustomAgent } from '../models.js'

export interface CustomAgentPort {
  save(agent: CustomAgent): Promise<void>
  get(id: string): Promise<CustomAgent | null>
  list(): Promise<CustomAgent[]>
  delete(id: string): Promise<void>
}
