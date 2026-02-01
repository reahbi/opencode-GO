# Status Display System - Quick Reference

## TL;DR

**Problem**: SSE events arrive rapidly (50ms apart), need stable mobile-friendly status text with tool aggregation.

**Solution**: `StatusDisplayManager` class that:
- Tracks tool calls in a Map
- Throttles updates to 1/sec
- Detects stability after 2s silence
- Renders compact status: "⏳ Processing (2 running, 1 done)" + "🔧 grep, find"

**Files**:
- `/src/domain/statusDisplay.ts` — 5 interfaces (55 lines)
- `/src/app/usecases/statusDisplay.ts` — Manager class (400 lines)

## Usage

```typescript
import { StatusDisplayManager } from './app/usecases/statusDisplay.js'

const manager = new StatusDisplayManager()

// On each SSE event:
const { shouldUpdate, displayState } = manager.processEvent({
  type: 'message.part.updated',
  subtype: 'tool',  // or 'text', 'step-start', 'step-finish', etc.
  sessionId: 's1',
  data: { partId: 't1', content: 'grep' },
  timestamp: Date.now(),
})

if (shouldUpdate) {
  const text = manager.renderDisplay(displayState)
  await telegram.editMessage(text)
}

// On session.idle:
const finalDisplay = manager.finalizeSession('s1')
if (finalDisplay) {
  const text = manager.renderDisplay(finalDisplay)
  await telegram.editMessage(text)
}
manager.cleanupSession('s1')
```

## Data Model

```
ToolCall {
  id, name, status: 'pending'|'running'|'completed'|'error',
  startTime, endTime?, errorMessage?
}

SessionStatus {
  sessionId, state: 'idle'|'busy'|'retry',
  toolCalls: Map<string, ToolCall>,
  textAccumulator: { content, lastUpdated, isStreaming },
  startTime, lastEventTime
}

DisplayState {
  statusLine: "⏳ Processing (2 running, 1 done)",
  toolSummary: "🔧 grep, find",
  textPreview: "Found 42 matches...",
  isStable: boolean,
  shouldUpdate: boolean
}
```

## Algorithm

```
Event → updateSessionState() → computeDisplayState() → shouldUpdateDisplay()
                                                              ↓
                                                    YES → Update UI
                                                    NO  → Schedule deferred update
```

## Constants

```typescript
EDIT_THROTTLE_MS = 1000        // Min time between updates
STABILITY_THRESHOLD_MS = 2000  // Time to consider state stable
TEXT_PREVIEW_MAX_LEN = 500     // Max chars in preview
```

## Output Examples

### Single Tool
```
⏳ Processing (1 running)
🔧 grep

Found 42 matches...
```

### Multiple Tools
```
⏳ Processing (1 running, 1 done)
🔧 grep, find

Searching...
```

### Done
```
✅ Done (2 completed)
🔧 grep, find

Searching...
```

### Error
```
⏳ Processing (1 error)
🔧 sed

sed: invalid regex
```

## Key Methods

| Method | Purpose |
|--------|---------|
| `processEvent(event)` | Main entry point, returns `{ shouldUpdate, displayState }` |
| `computeDisplayState(session)` | Generates display from session state |
| `shouldUpdateDisplay(session, newDisplay)` | Throttle + stability check |
| `renderDisplay(displayState)` | Converts to HTML string |
| `finalizeSession(sessionId)` | Marks session as idle, returns final display |
| `cleanupSession(sessionId)` | Removes session from memory |

## Subtype Inference

```typescript
function inferSubtype(event: OpenCodeEvent): string | undefined {
  const content = event.data.content
  if (content.includes('Running')) return 'tool'
  if (content.includes('Step')) return 'step-start'
  if (content.includes('Completed')) return 'step-finish'
  if (content.includes('Reasoning')) return 'reasoning'
  if (content.includes('Agent')) return 'agent'
  return 'text'
}
```

## State Transitions

```
idle ──→ busy ──→ idle
         ↓
        retry ──→ busy
```

## Tool Lifecycle

```
pending ──→ running ──→ completed
                    ↘
                     error
```

## Throttling Behavior

```
t=0ms:   Event 1 → shouldUpdate=true  → Update UI
t=50ms:  Event 2 → shouldUpdate=false → Schedule for t=1050ms
t=100ms: Event 3 → shouldUpdate=false → Reschedule for t=1100ms
t=150ms: Event 4 → shouldUpdate=false → Reschedule for t=1150ms
t=1150ms: Deferred update fires → Update UI
```

## Stability Behavior

```
t=0ms:   Event 1 → isStable=false
t=100ms: Event 2 → isStable=false
t=2100ms: No events → isStable=true → Force final update
```

## Integration Checklist

- [ ] Import `StatusDisplayManager` and `SSEEvent`
- [ ] Create manager instance
- [ ] Implement `inferSubtype()` function
- [ ] Convert `OpenCodeEvent` to `SSEEvent`
- [ ] Call `processEvent()` on each event
- [ ] Check `shouldUpdate` and call `renderDisplay()`
- [ ] Call `finalizeSession()` on `session.idle`
- [ ] Call `cleanupSession()` after finalization

## Performance

- **processEvent()**: O(1)
- **computeDisplayState()**: O(n) where n = tools (1-5)
- **Memory per session**: ~2KB
- **Max update frequency**: 1/sec
- **Stability detection**: 2 sec

## Testing

```typescript
// Tool aggregation
manager.processEvent({ type: 'message.part.updated', subtype: 'tool', ... })
manager.processEvent({ type: 'message.part.updated', subtype: 'tool', ... })
expect(manager.getDisplayState('s1')?.toolSummary).toContain('grep')

// Throttling
for (let i = 0; i < 5; i++) {
  const { shouldUpdate } = manager.processEvent({ ... })
  // Only first should be true
}

// Finalization
manager.finalizeSession('s1')
expect(manager.getDisplayState('s1')?.statusLine).toContain('Done')
```

## Customization

### Change throttle time
```typescript
const EDIT_THROTTLE_MS = 500  // 2 updates/sec
```

### Change stability threshold
```typescript
const STABILITY_THRESHOLD_MS = 1000  // 1 sec
```

### Change text preview length
```typescript
const TEXT_PREVIEW_MAX_LEN = 1000  // 1000 chars
```

### Custom display format
```typescript
renderDisplay(displayState: DisplayState): string {
  // Your custom formatting here
  return `${displayState.statusLine}\n${displayState.toolSummary}`
}
```

## Troubleshooting

**Q: Updates too frequent?**
A: Increase `EDIT_THROTTLE_MS` (default 1000ms)

**Q: "Done" appears too early?**
A: Increase `STABILITY_THRESHOLD_MS` (default 2000ms)

**Q: Tools not showing?**
A: Check `inferSubtype()` returns 'tool' for your events

**Q: Text preview missing?**
A: Ensure `subtype` is 'text', 'reasoning', or 'agent'

**Q: Memory leak?**
A: Call `cleanupSession()` after finalization

## Files

- **Domain types**: `/src/domain/statusDisplay.ts`
- **Implementation**: `/src/app/usecases/statusDisplay.ts`
- **Design doc**: `STATUS_DISPLAY_DESIGN.md`
- **Examples**: `IMPLEMENTATION_EXAMPLE.md`
- **Summary**: `STATUS_DISPLAY_SUMMARY.md`

