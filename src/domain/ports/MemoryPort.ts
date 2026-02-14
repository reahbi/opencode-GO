/**
 * Semantic memory port for session context and knowledge storage.
 * Future implementation: SQLite + sqlite-vec for embedding-based retrieval.
 *
 * Phase 5 stub — not yet implemented.
 */
export interface MemoryEntry {
  id: string
  sessionId: string
  content: string
  embedding?: number[]
  createdAt: number
  category: 'summary' | 'decision' | 'context' | 'error'
}

export interface MemoryPort {
  /** Store a memory entry with optional embedding */
  store(entry: Omit<MemoryEntry, 'id'>): Promise<string>
  /** Search for similar entries by text query */
  search(query: string, options?: { limit?: number; category?: MemoryEntry['category'] }): Promise<MemoryEntry[]>
  /** Get all entries for a session */
  getBySession(sessionId: string): Promise<MemoryEntry[]>
  /** Delete entries older than the given timestamp */
  prune(olderThan: number): Promise<number>
}
