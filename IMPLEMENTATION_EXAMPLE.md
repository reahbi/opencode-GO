# Status Display Implementation Example

## Quick Start

### 1. Import and Initialize

```typescript
import { StatusDisplayManager } from './app/usecases/statusDisplay.js'
import type { SSEEvent } from './domain/statusDisplay.js'

const statusManager = new StatusDisplayManager()
```

### 2. Convert OpenCodeEvent to SSEEvent

```typescript
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

function toSSEEvent(event: OpenCodeEvent): SSEEvent {
  return {
    type: event.type as 'message.part.updated' | 'session.status',
    subtype: inferSubtype(event),
    sessionId: event.data.sessionId,
    data: event.data,
    timestamp: Date.now(),
  }
}
```

### 3. Integrate with promptFlow.ts

```typescript
// In handleUserMessage function
const eventHandler = async (event: OpenCodeEvent) => {
  const sseEvent = toSSEEvent(event)
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
    statusManager.cleanupSession(event.data.sessionId)
  }
}
```

## Example Output Sequences

### Scenario 1: Single Tool Execution

```
[t=0ms] Event: message.part.updated (tool: grep)
  → Display: ⏳ Processing (1 running)
             🔧 grep

[t=100ms] Event: message.part.updated (text: "Found 42 matches...")
  → Display: ⏳ Processing (1 running)
             🔧 grep
             
             Found 42 matches...

[t=500ms] Event: message.part.updated (step-finish: grep)
  → Display: ⏳ Processing (1 done)
             🔧 grep
             
             Found 42 matches...

[t=2500ms] Event: session.idle
  → Display: ✅ Done (1 completed)
             🔧 grep
             
             Found 42 matches...
```

### Scenario 2: Multiple Concurrent Tools

```
[t=0ms] Event: message.part.updated (tool: grep)
  → Display: ⏳ Processing (1 running)
             🔧 grep

[t=100ms] Event: message.part.updated (tool: find)
  → Display: ⏳ Processing (2 running)
             🔧 grep, find

[t=200ms] Event: message.part.updated (text: "Searching...")
  → Display: ⏳ Processing (2 running)
             🔧 grep, find
             
             Searching...

[t=500ms] Event: message.part.updated (step-finish: grep)
  → Display: ⏳ Processing (1 running, 1 done)
             🔧 grep, find
             
             Searching...

[t=800ms] Event: message.part.updated (step-finish: find)
  → Display: ⏳ Processing (2 done)
             🔧 grep, find
             
             Searching...

[t=2800ms] Event: session.idle
  → Display: ✅ Done (2 completed)
             🔧 grep, find
             
             Searching...
```

### Scenario 3: Tool Error Handling

```
[t=0ms] Event: message.part.updated (tool: sed)
  → Display: ⏳ Processing (1 running)
             🔧 sed

[t=300ms] Event: message.part.updated (error: "sed: invalid regex")
  → Display: ⏳ Processing (1 error)
             🔧 sed
             
             sed: invalid regex

[t=2300ms] Event: session.error
  → Display: ✅ Done (1 error)
             🔧 sed
             
             sed: invalid regex
```

### Scenario 4: Rapid Events (Throttling Demo)

```
[t=0ms] Event: message.part.updated (text: "Line 1")
  → shouldUpdate: true
  → Display: ⏳ Processing
             
             Line 1

[t=50ms] Event: message.part.updated (text: "Line 1\nLine 2")
  → shouldUpdate: false (throttled, scheduled for t=1000ms)

[t=100ms] Event: message.part.updated (text: "Line 1\nLine 2\nLine 3")
  → shouldUpdate: false (throttled, rescheduled for t=1000ms)

[t=150ms] Event: message.part.updated (text: "Line 1\nLine 2\nLine 3\nLine 4")
  → shouldUpdate: false (throttled, rescheduled for t=1000ms)

[t=1000ms] Deferred update fires
  → Display: ⏳ Processing
             
             Line 1
             Line 2
             Line 3
             Line 4

[t=2000ms] Event: session.idle
  → shouldUpdate: true (state became stable)
  → Display: ✅ Done
             
             Line 1
             Line 2
             Line 3
             Line 4
```

## Data Flow Diagram

```
SSE Stream
    ↓
┌─────────────────────────────────────┐
│ eventHandler (promptFlow.ts)         │
│ - Receives OpenCodeEvent            │
│ - Converts to SSEEvent              │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ StatusDisplayManager.processEvent()  │
│ - Updates internal session state    │
│ - Computes new display state        │
│ - Checks throttle + stability       │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ shouldUpdate decision                │
├─────────────────────────────────────┤
│ YES → renderDisplay() → editText()  │
│ NO  → scheduleDeferredUpdate()      │
└─────────────────────────────────────┘
    ↓
Telegram Message Updated
```

## State Machine

```
┌─────────────────────────────────────────────────────┐
│                   Session States                     │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐                                       │
│  │   idle   │ ← Initial state (before first event)  │
│  └────┬─────┘                                       │
│       │ (first event received)                      │
│       ↓                                             │
│  ┌──────────┐                                       │
│  │  busy    │ ← Processing events                   │
│  └────┬─────┘                                       │
│       │                                             │
│       ├─→ (session.idle event) ──→ ✅ Done         │
│       │                                             │
│       └─→ (session.error event) ──→ ❌ Error       │
│                                                      │
│  ┌──────────┐                                       │
│  │  retry   │ ← Retry in progress                   │
│  └────┬─────┘                                       │
│       │                                             │
│       └─→ (session.busy event) ──→ busy            │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Tool Lifecycle

```
Tool Creation
    ↓
┌──────────────────────────────────────┐
│ status: 'pending'                    │
│ startTime: now                       │
└──────────────────────────────────────┘
    ↓ (step-start event)
┌──────────────────────────────────────┐
│ status: 'running'                    │
└──────────────────────────────────────┘
    ↓ (step-finish event)
┌──────────────────────────────────────┐
│ status: 'completed'                  │
│ endTime: now                         │
└──────────────────────────────────────┘

OR (on error)

┌──────────────────────────────────────┐
│ status: 'error'                      │
│ errorMessage: "..."                  │
│ endTime: now                         │
└──────────────────────────────────────┘
```

## Throttling Algorithm

```
Event arrives
    ↓
Display state changed?
    ├─ NO → return (no update)
    │
    └─ YES
        ↓
    Time since last update ≥ 1000ms?
        ├─ YES → Update immediately
        │        Set lastStableTime = now
        │
        └─ NO
            ↓
        Schedule deferred update
        (will fire in 1000ms - elapsed)
        
        If another event arrives before timer:
        → Clear old timer
        → Reschedule with new display state
```

## Stability Detection

```
Event arrives
    ↓
Update lastEventTime = now
    ↓
Check: now - lastEventTime ≥ 2000ms?
    ├─ YES → isStable = true
    │        (no events for 2 seconds)
    │
    └─ NO → isStable = false
            (still receiving events)
```

## Testing Checklist

```typescript
describe('StatusDisplayManager', () => {
  describe('Tool Aggregation', () => {
    it('tracks multiple concurrent tools')
    it('updates tool status from pending to running')
    it('updates tool status from running to completed')
    it('marks tools as error on error event')
    it('generates correct tool summary')
  })

  describe('Text Streaming', () => {
    it('accumulates text content')
    it('marks as streaming while receiving events')
    it('marks as not streaming after finalization')
    it('truncates preview to 500 chars')
    it('adds "... streaming" indicator')
  })

  describe('Throttling', () => {
    it('respects 1 edit/sec minimum')
    it('schedules deferred updates')
    it('reschedules on new events')
    it('forces update on stability')
  })

  describe('State Transitions', () => {
    it('transitions from busy to idle')
    it('transitions from busy to retry')
    it('marks running tools as completed on finalize')
  })

  describe('Display Rendering', () => {
    it('renders status line correctly')
    it('renders tool summary correctly')
    it('renders text preview correctly')
    it('escapes HTML in preview')
  })

  describe('Session Cleanup', () => {
    it('clears timers on cleanup')
    it('removes session from cache')
    it('removes display state from cache')
  })
})
```

## Performance Characteristics

| Operation | Time | Notes |
|-----------|------|-------|
| processEvent() | O(1) | Constant time, no loops |
| computeDisplayState() | O(n) | n = number of tools (typically 1-5) |
| shouldUpdateDisplay() | O(1) | Simple comparison |
| renderDisplay() | O(m) | m = text preview length (max 500) |
| Memory per session | ~2KB | Minimal overhead |

## Migration from Current Code

### Before (promptFlow.ts)

```typescript
let lastContent = ''
let lastEditTime = 0
let pendingEditTimer: ReturnType<typeof setTimeout> | null = null

const throttledEdit = (content: string) => {
  if (pendingEditTimer) {
    clearTimeout(pendingEditTimer)
    pendingEditTimer = null
  }
  const now = Date.now()
  const elapsed = now - lastEditTime
  if (elapsed >= EDIT_THROTTLE_MS) {
    lastEditTime = now
    deps.output.editText(chatId, handle, truncateForDisplay(content)).catch(() => {})
  } else {
    pendingEditTimer = setTimeout(() => {
      lastEditTime = Date.now()
      pendingEditTimer = null
      deps.output.editText(chatId, handle, truncateForDisplay(content)).catch(() => {})
    }, EDIT_THROTTLE_MS - elapsed)
  }
}

const eventHandler = async (event: OpenCodeEvent) => {
  switch (event.type) {
    case 'message.part.updated': {
      const { sessionId: evtSessionId, content } = event.data
      if (evtSessionId !== sessionId) return
      lastContent = content
      if (content.length > 0) {
        throttledEdit(content)
      }
      break
    }
    // ...
  }
}
```

### After (with StatusDisplayManager)

```typescript
const statusManager = new StatusDisplayManager()

const eventHandler = async (event: OpenCodeEvent) => {
  const sseEvent = toSSEEvent(event)
  const { shouldUpdate, displayState } = statusManager.processEvent(sseEvent)

  if (shouldUpdate) {
    const text = statusManager.renderDisplay(displayState)
    await deps.output.editText(chatId, handle, text).catch(() => {})
  }

  if (event.type === 'session.idle' || event.type === 'session.error') {
    const finalDisplay = statusManager.finalizeSession(event.data.sessionId)
    if (finalDisplay) {
      const text = statusManager.renderDisplay(finalDisplay)
      await deps.output.editText(chatId, handle, text).catch(() => {})
    }
    statusManager.cleanupSession(event.data.sessionId)
  }
}
```

**Benefits:**
- ✅ Cleaner code (no manual throttle logic)
- ✅ Tool aggregation (shows all running tools)
- ✅ Better status messages (includes counts)
- ✅ Stable state tracking (busy/idle/retry)
- ✅ Easier to test and maintain

