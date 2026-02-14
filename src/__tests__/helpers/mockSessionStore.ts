import type { SessionStorePort, SessionMeta } from '../../domain/ports/SessionStorePort.js'
import { mock } from 'bun:test'

export function createMockSessionStore(sessions: SessionMeta[] = []): SessionStorePort {
  const store = new Map<string, SessionMeta>()
  for (const s of sessions) store.set(s.sessionId, s)

  return {
    createSession: mock(async (meta: SessionMeta) => { store.set(meta.sessionId, meta) }),
    getSession: mock(async (id: string) => store.get(id) ?? null),
    listSessions: mock(async (cwd?: string) => {
      const all = [...store.values()]
      return cwd ? all.filter(s => s.cwd === cwd) : all
    }),
    updateSession: mock(async (id: string, updates: Partial<SessionMeta>) => {
      const existing = store.get(id)
      if (existing) store.set(id, { ...existing, ...updates })
    }),
    deleteSession: mock(async (id: string) => { store.delete(id) }),
  }
}
