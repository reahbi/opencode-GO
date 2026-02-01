# Real-Time Status Display System Design

## Problem Statement

Current implementation in `promptFlow.ts` handles `message.part.updated` events with basic throttling, but lacks:
1. **Aggregation** of multiple concurrent tool calls
2. **Stable status text** that doesn't flicker on mobile
3. **Semantic understanding** of event types (tool/text/step-start/step-finish/subtask/reasoning/agent)
4. **Graceful transition** to final response
5. **Explicit state machine** for session status (busy/idle/retry)

## Solution: Minimal Data Model + Update Algorithm

### 1. Core Data Model

```typescript
// Domain types (domain/statusDisplay.ts)

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
```

### 2. Update Algorithm

```typescript
// app/usecases/statusDisplay.ts

const EDIT_THROTTLE_MS = 1000
const TOOL_AGGREGATION_WINDOW_MS = 500
const STABILITY_THRESHOLD_MS = 2000

export class StatusDisplayManager {
  private sessions: Map<string, SessionStatus> = new Map()
  private displayCache: Map<string, DisplayState> = new Map()
  private throttleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private lastStableTime: Map<string, number> = new Map()

  /**
   * Process incoming SSE event and determine if display should update
   */
  processEvent(event: SSEEvent): { shouldUpdate: boolean; displayState: DisplayState } {
    const session = this.getOrCreateSession(event.sessionId)
    session.lastEventTime = event.timestamp

    // Update internal state based on event type
    switch (event.type) {
      case 'session.status':
        this.updateSessionStatus(session, event)
        break
      case 'message.part.updated':
        this.updateMessagePart(session, event)
        break
    }

    // Compute new display state
    const displayState = this.computeDisplayState(session)
    
    // Determine if we should update the UI
    const shouldUpdate = this.shouldUpdateDisplay(session, displayState)
    
    if (shouldUpdate) {
      this.displayCache.set(event.sessionId, displayState)
      this.lastStableTime.set(event.sessionId, event.timestamp)
    }

    return { shouldUpdate, displayState }
  }

  /**
   * Update session status (busy/idle/retry)
   */
  private updateSessionStatus(session: SessionStatus, event: SSEEvent): void {
    const status = event.data.status as string | undefined
    if (status === 'idle') {
      session.state = 'idle'
    } else if (status === 'busy') {
      session.state = 'busy'
    } else if (status === 'retry') {
      session.state = 'retry'
    }
  }

  /**
   * Update message part (text or tool-related)
   */
  private updateMessagePart(session: SessionStatus, event: SSEEvent): void {
    const subtype = event.subtype || 'text'
    const partId = event.data.partId as string
    const content = event.data.content as string

    switch (subtype) {
      case 'tool':
      case 'step-start':
      case 'step-finish':
        this.updateToolCall(session, partId, content, subtype)
        break
      case 'text':
      case 'reasoning':
      case 'agent':
        this.updateTextContent(session, content)
        break
      case 'subtask':
        // Subtasks are typically metadata, not displayed directly
        break
    }
  }

  /**
   * Track tool invocation lifecycle
   */
  private updateToolCall(
    session: SessionStatus,
    toolId: string,
    content: string,
    subtype: string
  ): void {
    let tool = session.toolCalls.get(toolId)
    
    if (!tool) {
      tool = {
        id: toolId,
        name: this.extractToolName(content),
        status: 'pending',
        startTime: Date.now(),
      }
      session.toolCalls.set(toolId, tool)
    }

    // Update tool status based on subtype
    if (subtype === 'step-start') {
      tool.status = 'running'
    } else if (subtype === 'step-finish') {
      tool.status = 'completed'
      tool.endTime = Date.now()
    } else if (content.includes('error') || content.includes('Error')) {
      tool.status = 'error'
      tool.errorMessage = content
      tool.endTime = Date.now()
    }
  }

  /**
   * Accumulate text content (streaming)
   */
  private updateTextContent(session: SessionStatus, content: string): void {
    session.textAccumulator.content = content
    session.textAccumulator.lastUpdated = Date.now()
    session.textAccumulator.isStreaming = true
  }

  /**
   * Compute what should be displayed
   */
  private computeDisplayState(session: SessionStatus): DisplayState {
    const statusLine = this.computeStatusLine(session)
    const toolSummary = this.computeToolSummary(session)
    const textPreview = this.computeTextPreview(session)
    const isStable = this.isStateStable(session)

    return {
      statusLine,
      toolSummary,
      textPreview,
      isStable,
      shouldUpdate: false, // Set by caller
    }
  }

  /**
   * Generate status line: "⏳ Processing... (2 tools running, 1 completed)"
   */
  private computeStatusLine(session: SessionStatus): string {
    const running = Array.from(session.toolCalls.values()).filter(
      (t) => t.status === 'running'
    ).length
    const completed = Array.from(session.toolCalls.values()).filter(
      (t) => t.status === 'completed'
    ).length
    const errors = Array.from(session.toolCalls.values()).filter(
      (t) => t.status === 'error'
    ).length

    const parts: string[] = []

    if (session.state === 'idle') {
      parts.push('✅ Done')
    } else if (session.state === 'retry') {
      parts.push('🔄 Retrying')
    } else {
      parts.push('⏳ Processing')
    }

    const details: string[] = []
    if (running > 0) details.push(`${running} running`)
    if (completed > 0) details.push(`${completed} done`)
    if (errors > 0) details.push(`${errors} error`)

    if (details.length > 0) {
      parts.push(`(${details.join(', ')})`)
    }

    return parts.join(' ')
  }

  /**
   * Generate tool summary: "🔧 grep, find, sed"
   */
  private computeToolSummary(session: SessionStatus): string {
    const tools = Array.from(session.toolCalls.values())
    if (tools.length === 0) return ''

    const toolNames = tools.map((t) => t.name).join(', ')
    return `🔧 ${toolNames}`
  }

  /**
   * Generate text preview (first 500 chars of accumulated text)
   */
  private computeTextPreview(session: SessionStatus): string {
    const { content, isStreaming } = session.textAccumulator
    if (!content) return ''

    const maxLen = 500
    const preview = content.length > maxLen ? content.slice(0, maxLen) + '...' : content
    const suffix = isStreaming ? '\n\n<i>... streaming</i>' : ''
    return preview + suffix
  }

  /**
   * Determine if state is stable (no changes for STABILITY_THRESHOLD_MS)
   */
  private isStateStable(session: SessionStatus): boolean {
    const lastEventTime = session.lastEventTime
    const now = Date.now()
    return now - lastEventTime >= STABILITY_THRESHOLD_MS
  }

  /**
   * Decide whether to update display based on throttle + stability
   */
  private shouldUpdateDisplay(session: SessionStatus, newDisplay: DisplayState): boolean {
    const sessionId = session.sessionId
    const lastDisplay = this.displayCache.get(sessionId)
    const lastStable = this.lastStableTime.get(sessionId) ?? 0
    const now = Date.now()

    // Always update if display content changed
    if (lastDisplay && this.displayStateChanged(lastDisplay, newDisplay)) {
      // But respect throttle: only update if enough time has passed
      if (now - lastStable >= EDIT_THROTTLE_MS) {
        return true
      }
      // Otherwise, schedule a deferred update
      this.scheduleDeferredUpdate(sessionId, newDisplay)
      return false
    }

    // If state became stable, force final update
    if (newDisplay.isStable && lastDisplay && !lastDisplay.isStable) {
      return true
    }

    return false
  }

  /**
   * Schedule a deferred update to respect throttle
   */
  private scheduleDeferredUpdate(sessionId: string, displayState: DisplayState): void {
    // Clear any pending timer
    const existingTimer = this.throttleTimers.get(sessionId)
    if (existingTimer) clearTimeout(existingTimer)

    // Schedule new update
    const timer = setTimeout(() => {
      this.displayCache.set(sessionId, displayState)
      this.lastStableTime.set(sessionId, Date.now())
      this.throttleTimers.delete(sessionId)
      // Caller should check displayCache and update UI
    }, EDIT_THROTTLE_MS)

    this.throttleTimers.set(sessionId, timer)
  }

  /**
   * Compare two display states for changes
   */
  private displayStateChanged(a: DisplayState, b: DisplayState): boolean {
    return (
      a.statusLine !== b.statusLine ||
      a.toolSummary !== b.toolSummary ||
      a.textPreview !== b.textPreview
    )
  }

  /**
   * Extract tool name from content (e.g., "grep" from "Running grep...")
   */
  private extractToolName(content: string): string {
    const match = content.match(/^(\w+)/)
    return match ? match[1] : 'unknown'
  }

  /**
   * Get or create session state
   */
  private getOrCreateSession(sessionId: string): SessionStatus {
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = {
        sessionId,
        state: 'busy',
        toolCalls: new Map(),
        textAccumulator: { content: '', lastUpdated: 0, isStreaming: false },
        startTime: Date.now(),
        lastEventTime: Date.now(),
      }
      this.sessions.set(sessionId, session)
    }
    return session
  }

  /**
   * Finalize session (called when session.idle received)
   */
  finalizeSession(sessionId: string): DisplayState | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    session.state = 'idle'
    session.textAccumulator.isStreaming = false

    // Mark all running tools as completed
    for (const tool of session.toolCalls.values()) {
      if (tool.status === 'running') {
        tool.status = 'completed'
        tool.endTime = Date.now()
      }
    }

    const displayState = this.computeDisplayState(session)
    this.displayCache.set(sessionId, displayState)
    return displayState
  }

  /**
   * Get current display state (for UI rendering)
   */
  getDisplayState(sessionId: string): DisplayState | null {
    return this.displayCache.get(sessionId) ?? null
  }

  /**
   * Render display state to text (for Telegram message)
   */
  renderDisplay(displayState: DisplayState): string {
    const lines: string[] = [displayState.statusLine]

    if (displayState.toolSummary) {
      lines.push(displayState.toolSummary)
    }

    if (displayState.textPreview) {
      lines.push('')
      lines.push('<pre><code>' + escapeHtml(displayState.textPreview) + '</code></pre>')
    }

    return lines.join('\n')
  }

  /**
   * Clean up session (call when done)
   */
  cleanupSession(sessionId: string): void {
    const timer = this.throttleTimers.get(sessionId)
    if (timer) clearTimeout(timer)
    this.sessions.delete(sessionId)
    this.displayCache.delete(sessionId)
    this.throttleTimers.delete(sessionId)
    this.lastStableTime.delete(sessionId)
  }
}
```

### 3. Integration with promptFlow.ts

```typescript
// Modified promptFlow.ts usage

const statusManager = new StatusDisplayManager()

const eventHandler = async (event: OpenCodeEvent) => {
  // Convert OpenCodeEvent to SSEEvent with subtype inference
  const sseEvent: SSEEvent = {
    type: event.type as 'message.part.updated' | 'session.status',
    subtype: inferSubtype(event),
    sessionId: event.data.sessionId,
    data: event.data,
    timestamp: Date.now(),
  }

  const { shouldUpdate, displayState } = statusManager.processEvent(sseEvent)

  if (shouldUpdate) {
    const text = statusManager.renderDisplay(displayState)
    await deps.output.editText(chatId, handle, text).catch(() => {})
  }

  // Handle terminal events
  if (event.type === 'session.idle' || event.type === 'session.error') {
    const finalDisplay = statusManager.finalizeSession(event.data.sessionId)
    if (finalDisplay) {
      const text = statusManager.renderDisplay(finalDisplay)
      await deps.output.editText(chatId, handle, text).catch(() => {})
    }
  }
}

function inferSubtype(event: OpenCodeEvent): string | undefined {
  if (event.type !== 'message.part.updated') return undefined
  
  const content = event.data.content
  
  // Heuristic-based subtype inference
  if (content.includes('Running') || content.includes('Executing')) return 'tool'
  if (content.includes('Step') || content.includes('step')) return 'step-start'
  if (content.includes('Completed') || content.includes('Done')) return 'step-finish'
  if (content.includes('Reasoning') || content.includes('reasoning')) return 'reasoning'
  if (content.includes('Agent') || content.includes('agent')) return 'agent'
  
  return 'text'
}
```

## Key Design Decisions

### 1. **Throttling Strategy**
- **1 edit/sec minimum**: Prevents mobile UI flicker
- **Deferred updates**: Queues changes that occur within throttle window
- **Stability detection**: Forces final update when state stabilizes

### 2. **Tool Aggregation**
- **Map-based tracking**: Each tool has unique ID, status, timing
- **Lifecycle states**: pending → running → completed/error
- **Summary generation**: "2 tools running, 1 completed" instead of raw events

### 3. **Text Streaming**
- **Accumulator pattern**: Appends content, tracks streaming state
- **Preview truncation**: Shows first 500 chars + "... streaming" indicator
- **Final response**: Full content sent when session.idle received

### 4. **State Machine**
```
idle ──→ busy ──→ idle
         ↓
        retry ──→ busy
```

### 5. **Mobile-Friendly Output**
- **Compact status line**: "⏳ Processing (2 running, 1 done)"
- **Tool summary**: "🔧 grep, find, sed"
- **Text preview**: First 500 chars with streaming indicator
- **No flickering**: Throttled updates + stability threshold

## Example Output Sequence

```
[Event 1] message.part.updated (tool: grep)
Display: ⏳ Processing (1 running)
         🔧 grep

[Event 2] message.part.updated (text: "Found 42 matches...")
Display: ⏳ Processing (1 running)
         🔧 grep
         
         Found 42 matches...

[Event 3] message.part.updated (step-finish: grep)
Display: ⏳ Processing (1 done)
         🔧 grep
         
         Found 42 matches...

[Event 4] message.part.updated (tool: sed)
Display: ⏳ Processing (1 running, 1 done)
         🔧 grep, sed
         
         Found 42 matches...

[Event 5] session.idle
Display: ✅ Done (2 completed)
         🔧 grep, sed
         
         Found 42 matches...
         [Full response sent as separate message]
```

## Testing Strategy

```typescript
describe('StatusDisplayManager', () => {
  it('aggregates multiple tool calls', () => {
    const manager = new StatusDisplayManager()
    
    manager.processEvent({
      type: 'message.part.updated',
      subtype: 'tool',
      sessionId: 's1',
      data: { partId: 't1', content: 'grep' },
      timestamp: 0,
    })
    
    manager.processEvent({
      type: 'message.part.updated',
      subtype: 'tool',
      sessionId: 's1',
      data: { partId: 't2', content: 'find' },
      timestamp: 100,
    })
    
    const display = manager.getDisplayState('s1')
    expect(display?.toolSummary).toContain('grep')
    expect(display?.toolSummary).toContain('find')
  })

  it('respects 1 edit/sec throttle', async () => {
    const manager = new StatusDisplayManager()
    const updates: number[] = []
    
    // Simulate rapid events
    for (let i = 0; i < 5; i++) {
      const { shouldUpdate } = manager.processEvent({
        type: 'message.part.updated',
        subtype: 'text',
        sessionId: 's1',
        data: { partId: 'p1', content: `text ${i}` },
        timestamp: i * 100,
      })
      if (shouldUpdate) updates.push(i)
    }
    
    // Should have at most 1 update in first 1000ms
    expect(updates.length).toBeLessThanOrEqual(1)
  })

  it('transitions to idle state gracefully', () => {
    const manager = new StatusDisplayManager()
    
    manager.processEvent({
      type: 'message.part.updated',
      subtype: 'tool',
      sessionId: 's1',
      data: { partId: 't1', content: 'grep' },
      timestamp: 0,
    })
    
    const finalDisplay = manager.finalizeSession('s1')
    expect(finalDisplay?.statusLine).toContain('Done')
  })
})
```

## Migration Path

1. **Phase 1**: Add `StatusDisplayManager` to `app/usecases/`
2. **Phase 2**: Update `promptFlow.ts` to use manager
3. **Phase 3**: Add subtype inference from event content
4. **Phase 4**: Enhance with real subtype from SDK (if available)
5. **Phase 5**: Add analytics (tool execution time, text length, etc.)

