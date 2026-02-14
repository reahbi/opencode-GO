import type { HistoryMessage } from '../models.js'

export interface SessionMeta {
  sessionId: string
  title: string
  createdAt: number
  lastActiveAt: number
  messageCount: number
  status: 'idle' | 'busy'
  cwd: string
  totalCostUsd?: number
  messages?: HistoryMessage[]
  /** Session origin: 'bot' = created via Telegram, 'local' = discovered from CLI */
  source?: 'bot' | 'local'
}

export interface SessionStorePort {
  createSession(meta: SessionMeta): Promise<void>
  getSession(id: string): Promise<SessionMeta | null>
  listSessions(cwd?: string): Promise<SessionMeta[]>
  updateSession(id: string, updates: Partial<SessionMeta>): Promise<void>
  deleteSession(id: string): Promise<void>
}
