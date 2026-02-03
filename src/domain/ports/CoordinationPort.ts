export type CoordinationEventType =
  | 'debate.request'
  | 'debate.response'
  | 'debate.end'
  | 'review.request'
  | 'review.response'

export interface CoordinationEvent {
  id: string
  type: CoordinationEventType
  fromBot: string
  toBot: string
  sessionId: string              // Keep for backward compat (deprecated)
  debateId?: string              // NEW: UUID for debate session matching
  chatId?: number                // NEW: Telegram chat ID for routing
  timestamp: number
  payload: Record<string, unknown>
}

export interface CoordinationPort {
  publish(event: Omit<CoordinationEvent, 'id' | 'timestamp'>): Promise<void>
  poll(sinceOffset: number): Promise<{ events: CoordinationEvent[]; newOffset: number }>
  currentOffset(): Promise<number>
}
