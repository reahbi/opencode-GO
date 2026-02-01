/**
 * Status Display Manager
 * 
 * Handles real-time aggregation of SSE events with:
 * - Tool call tracking and aggregation
 * - 1 edit/sec throttling for mobile stability
 * - Graceful state transitions (busy → idle → retry)
 * - Mobile-friendly compact output
 */

import type {
  ToolCall,
  TextAccumulator,
  SessionStatus,
  DisplayState,
  SSEEvent,
} from '../../domain/statusDisplay.js'

const EDIT_THROTTLE_MS = 1000
const STABILITY_THRESHOLD_MS = 2000
const TEXT_PREVIEW_MAX_LEN = 500

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

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
   * Generate status line: "⏳ Processing (2 running, 1 completed)"
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

    const preview =
      content.length > TEXT_PREVIEW_MAX_LEN
        ? content.slice(0, TEXT_PREVIEW_MAX_LEN) + '...'
        : content
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
