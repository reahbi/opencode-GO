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
  sessionId: string
  timestamp: number
  payload: Record<string, unknown>
}

export interface CoordinationPort {
  publish(event: Omit<CoordinationEvent, 'id' | 'timestamp'>): Promise<void>
  poll(sinceOffset: number): Promise<{ events: CoordinationEvent[]; newOffset: number }>
  currentOffset(): Promise<number>
}
