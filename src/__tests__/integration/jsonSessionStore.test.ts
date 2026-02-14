import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createJsonSessionStore } from '../../adapters/claude/jsonSessionStore.js'
import type { SessionStorePort, SessionMeta } from '../../domain/ports/SessionStorePort.js'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

function buildSessionMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: `ses-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test Session',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    messageCount: 0,
    status: 'idle',
    cwd: '/tmp/project',
    ...overrides,
  }
}

describe('jsonSessionStore', () => {
  let dir: string
  let store: SessionStorePort

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'session-store-'))
    store = createJsonSessionStore(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // ── createSession ──────────────────────────────────────────

  describe('createSession', () => {
    it('creates and retrieves a session', async () => {
      const meta = buildSessionMeta({ sessionId: 'ses-1', title: 'My Session' })
      await store.createSession(meta)

      const result = await store.getSession('ses-1')
      expect(result).not.toBeNull()
      expect(result!.sessionId).toBe('ses-1')
      expect(result!.title).toBe('My Session')
    })

    it('replaces existing session with same ID', async () => {
      const meta1 = buildSessionMeta({ sessionId: 'ses-dup', title: 'First' })
      const meta2 = buildSessionMeta({ sessionId: 'ses-dup', title: 'Second' })

      await store.createSession(meta1)
      await store.createSession(meta2)

      const result = await store.getSession('ses-dup')
      expect(result!.title).toBe('Second')

      // Should not have duplicates
      const all = await store.listSessions()
      const dupes = all.filter(s => s.sessionId === 'ses-dup')
      expect(dupes).toHaveLength(1)
    })

    it('evicts oldest sessions when exceeding max (LRU)', async () => {
      // Create 101 sessions — the oldest should be evicted
      const sessions: SessionMeta[] = []
      for (let i = 0; i < 101; i++) {
        sessions.push(buildSessionMeta({
          sessionId: `ses-${i}`,
          lastActiveAt: 1000 + i, // increasing activity time
        }))
      }

      for (const s of sessions) {
        await store.createSession(s)
      }

      const all = await store.listSessions()
      expect(all.length).toBeLessThanOrEqual(100)

      // The oldest (ses-0 with lastActiveAt=1000) should be evicted
      const oldest = await store.getSession('ses-0')
      expect(oldest).toBeNull()

      // The newest should still be there
      const newest = await store.getSession('ses-100')
      expect(newest).not.toBeNull()
    })
  })

  // ── getSession ─────────────────────────────────────────────

  describe('getSession', () => {
    it('returns null for non-existent session', async () => {
      const result = await store.getSession('non-existent')
      expect(result).toBeNull()
    })
  })

  // ── listSessions ───────────────────────────────────────────

  describe('listSessions', () => {
    it('returns empty array initially', async () => {
      const result = await store.listSessions()
      expect(result).toEqual([])
    })

    it('returns all sessions sorted by lastActiveAt desc', async () => {
      await store.createSession(buildSessionMeta({ sessionId: 'old', lastActiveAt: 100 }))
      await store.createSession(buildSessionMeta({ sessionId: 'new', lastActiveAt: 300 }))
      await store.createSession(buildSessionMeta({ sessionId: 'mid', lastActiveAt: 200 }))

      const result = await store.listSessions()
      expect(result.map(s => s.sessionId)).toEqual(['new', 'mid', 'old'])
    })

    it('filters by cwd when provided', async () => {
      await store.createSession(buildSessionMeta({ sessionId: 's1', cwd: '/proj/a' }))
      await store.createSession(buildSessionMeta({ sessionId: 's2', cwd: '/proj/b' }))
      await store.createSession(buildSessionMeta({ sessionId: 's3', cwd: '/proj/a' }))

      const result = await store.listSessions('/proj/a')
      expect(result).toHaveLength(2)
      expect(result.every(s => s.cwd === '/proj/a')).toBe(true)
    })

    it('returns all sessions when cwd is undefined', async () => {
      await store.createSession(buildSessionMeta({ sessionId: 's1', cwd: '/a' }))
      await store.createSession(buildSessionMeta({ sessionId: 's2', cwd: '/b' }))

      const result = await store.listSessions()
      expect(result).toHaveLength(2)
    })
  })

  // ── updateSession ──────────────────────────────────────────

  describe('updateSession', () => {
    it('updates specific fields', async () => {
      await store.createSession(buildSessionMeta({
        sessionId: 'ses-upd',
        title: 'Original',
        messageCount: 0,
        status: 'idle',
      }))

      await store.updateSession('ses-upd', {
        title: 'Updated',
        messageCount: 5,
        status: 'busy',
      })

      const result = await store.getSession('ses-upd')
      expect(result!.title).toBe('Updated')
      expect(result!.messageCount).toBe(5)
      expect(result!.status).toBe('busy')
    })

    it('preserves fields not included in updates', async () => {
      await store.createSession(buildSessionMeta({
        sessionId: 'ses-partial',
        title: 'Keep Me',
        cwd: '/keep/this',
      }))

      await store.updateSession('ses-partial', { messageCount: 10 })

      const result = await store.getSession('ses-partial')
      expect(result!.title).toBe('Keep Me')
      expect(result!.cwd).toBe('/keep/this')
      expect(result!.messageCount).toBe(10)
    })

    it('does nothing for non-existent session', async () => {
      // Should not throw
      await store.updateSession('ghost', { title: 'Nope' })
      const result = await store.getSession('ghost')
      expect(result).toBeNull()
    })

    it('updates totalCostUsd', async () => {
      await store.createSession(buildSessionMeta({ sessionId: 'ses-cost' }))
      await store.updateSession('ses-cost', { totalCostUsd: 0.42 })

      const result = await store.getSession('ses-cost')
      expect(result!.totalCostUsd).toBe(0.42)
    })
  })

  // ── deleteSession ──────────────────────────────────────────

  describe('deleteSession', () => {
    it('removes the session', async () => {
      await store.createSession(buildSessionMeta({ sessionId: 'ses-del' }))
      await store.deleteSession('ses-del')

      const result = await store.getSession('ses-del')
      expect(result).toBeNull()
    })

    it('does not affect other sessions', async () => {
      await store.createSession(buildSessionMeta({ sessionId: 'keep' }))
      await store.createSession(buildSessionMeta({ sessionId: 'remove' }))
      await store.deleteSession('remove')

      expect(await store.getSession('keep')).not.toBeNull()
      expect(await store.getSession('remove')).toBeNull()
    })

    it('does nothing for non-existent session', async () => {
      await store.createSession(buildSessionMeta({ sessionId: 'exists' }))
      await store.deleteSession('nonexistent')

      expect(await store.getSession('exists')).not.toBeNull()
    })
  })

  // ── concurrent access (file locking) ──────────────────────

  describe('concurrent access', () => {
    it('handles concurrent creates without data loss', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        store.createSession(buildSessionMeta({ sessionId: `concurrent-${i}` }))
      )
      await Promise.all(promises)

      const all = await store.listSessions()
      expect(all).toHaveLength(10)
    })

    it('handles concurrent updates without corruption', async () => {
      await store.createSession(buildSessionMeta({ sessionId: 'race', messageCount: 0 }))

      const promises = Array.from({ length: 5 }, (_, i) =>
        store.updateSession('race', { messageCount: i + 1 })
      )
      await Promise.all(promises)

      const result = await store.getSession('race')
      expect(result).not.toBeNull()
      // messageCount should be a valid number (last writer wins with locking)
      expect(typeof result!.messageCount).toBe('number')
    })
  })

  // ── persistence across instances ───────────────────────────

  describe('persistence', () => {
    it('data persists across store instances', async () => {
      await store.createSession(buildSessionMeta({ sessionId: 'persist', title: 'Persistent' }))

      // Create a new store instance pointing to the same directory
      const store2 = createJsonSessionStore(dir)
      const result = await store2.getSession('persist')
      expect(result).not.toBeNull()
      expect(result!.title).toBe('Persistent')
    })
  })
})
