/**
 * Domain types for real-time status display system
 * Handles SSE event aggregation, throttling, and mobile-friendly rendering
 */

/** Represents a single tool invocation in progress */
export interface ToolCall {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'error'
  startTime: number
  endTime?: number
  errorMessage?: string
}

/** Represents accumulated text content */
export interface TextAccumulator {
  content: string
  lastUpdated: number
  isStreaming: boolean
}

/** Session-level status state */
export interface SessionStatus {
  sessionId: string
  state: 'idle' | 'busy' | 'retry'
  toolCalls: Map<string, ToolCall>
  textAccumulator: TextAccumulator
  startTime: number
  lastEventTime: number
}

/** Computed display state (what to show on screen) */
export interface DisplayState {
  statusLine: string
  toolSummary: string
  textPreview: string
  isStable: boolean
  shouldUpdate: boolean
}

/** SSE event with semantic type */
export interface SSEEvent {
  type: 'message.part.updated' | 'session.status'
  subtype?: 'tool' | 'text' | 'step-start' | 'step-finish' | 'subtask' | 'reasoning' | 'agent'
  sessionId: string
  data: Record<string, unknown>
  timestamp: number
}
