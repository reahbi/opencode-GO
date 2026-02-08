> **📦 Archive**: This document was the original implementation plan. All phases described below have been implemented and are now live in the codebase. Kept for historical reference and design context.

---

# Response Delivery System - Implementation Plan

## Problem Statement

OpenCode AI responses are delivered raw to Telegram. No formatting, no length handling strategy, no user control. Users on phones get either truncated garbage or walls of unreadable text.

---

## System Overview

```
OpenCode Response (raw markdown, 0~50K+ chars)
        │
        ▼
┌──────────────────────────┐
│  telegramify-markdown    │  ← Standard MD → Telegram MarkdownV2 (AST-based)
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  Length Router            │  ← Decides delivery strategy based on settings
└──────────┬───────────────┘
           │
     ┌─────┼──────────┐
     ▼     ▼          ▼
  Inline  Chunk    File+Summary
 (<4K)   (4K~12K)  (>threshold)
```

---

## Component 1: Markdown → Telegram MarkdownV2 Conversion

### Approach: `telegramify-markdown` Library

**Why not custom HTML converter:**
- No existing library converts Markdown → Telegram HTML
- Custom regex-based converter will break on code blocks containing `<`, `>`, `&`
- AST-based approach is the only safe method

**Why `telegramify-markdown`:**
- AST-based (unified/remark) — safely handles HTML inside code blocks
- Actively maintained (Dec 2025, v1.3.2)
- Handles all edge cases: nested formatting, unclosed fences, special chars
- Standard Markdown input → Telegram MarkdownV2 output

### What It Renders

| Markdown | Telegram Display | Notes |
|----------|-----------------|-------|
| `# Heading` | **Heading** (bold) | Telegram has no heading sizes |
| `**bold**` | **bold** | |
| `*italic*` | *italic* | |
| `~~strike~~` | ~~strike~~ | |
| `` `code` `` | `code` (monospace box) | |
| ` ```lang\n...\n``` ` | Code block with syntax label + copy button | |
| `> quote` | Quoted block (left border) | |
| `[text](url)` | Clickable link | |
| `- item` | Text with bullet marker | |

### Migration: HTML → MarkdownV2

Current codebase uses `parse_mode: 'HTML'` in 7 places.

| Location | Current | Change |
|----------|---------|--------|
| `bot.ts` default | `parse_mode: 'HTML'` | Keep HTML for bot's own messages (commands, errors, status) |
| `promptFlow.ts` response | `escapeHtml(content)` | Use `telegramify-markdown(content)` + `parse_mode: 'MarkdownV2'` |

**Strategy:** Only OpenCode responses go through MarkdownV2 conversion.
Bot's own messages (command responses, errors, status card) stay as HTML — they're short, controlled, and safe.

### Installation

```bash
bun add telegramify-markdown
```

### Usage

```typescript
import telegramifyMarkdown from 'telegramify-markdown'

// OpenCode response → Telegram MarkdownV2
const formatted = telegramifyMarkdown(rawMarkdown)
await bot.api.sendMessage(chatId, formatted, { parse_mode: 'MarkdownV2' })
```

### Raw Mode Fallback

User can disable conversion via `/settings` → Output Format: Raw.
In raw mode, content is sent as plain text (no parse_mode) — Telegram shows it as-is.

---

## Component 2: Length Router (Adaptive Delivery)

### Decision Table

| Length | Content Type | Strategy | Details |
|--------|-------------|----------|---------|
| < 4,000 chars | Any | **Inline** | Single message, Telegram HTML |
| 4,000 ~ 12,000 | Prose-heavy | **Semantic Chunk** | 2~4 messages, split at section boundaries |
| 4,000 ~ 12,000 | Code-heavy | **Inline + File** | Truncated preview + full .md attached |
| > 12,000 | Any (summary OFF) | **Structural Extract + File** | Auto-extracted summary + .md file |
| > 12,000 | Any (summary ON) | **AI Summary + File** | LLM summary + .md file |

### Code-heavy Detection

```
codeRatio = (chars inside code fences) / (total chars)
isCodeHeavy = codeRatio > 0.4 || codeBlockCount > 3
```

### Semantic Chunking Rules

1. Split at `## ` headings first
2. Then at blank lines between paragraphs
3. Then at code fence boundaries (never mid-fence)
4. Each chunk ≤ 4,000 chars after Telegram HTML conversion
5. Messages 2+ sent with `disable_notification: true`

### File Fallback

- Filename: `response.md` (raw markdown — for readability in file viewers)
- Caption: short inline summary (Telegram HTML)
- Caption limit: 1,024 chars (Telegram document caption limit)

### Why 12,000 as Default File Threshold

- 3 chunked messages max on mobile (more = spam)
- 3 × 4,000 = 12,000
- Beyond this, file is strictly better UX

---

## Component 3: AI Summary Mode

### Overview

When response exceeds user-configured threshold, run it through an LLM to produce a mobile-friendly summary. Uses OpenCode's existing model infrastructure — no extra API keys needed.

### Summary Prompt

```
You are a senior engineer checking work on your phone.
Rewrite this AI response into a mobile-friendly summary.

Format:
📁 Files: list modified files
💡 Summary: 2-5 bullets of what was done and why
⚡ Code: only critical one-liners (commands, config values, signatures) — skip full blocks
📋 Next: commands to run or things to verify (if any)

Rules:
- Maximum {threshold} characters
- Same language as the original response
- No filler phrases
- File paths in backticks

---
{content}
```

### Why This Prompt

| Design Choice | Reason |
|---------------|--------|
| Role ("senior engineer on phone") | Sets the right tone — concise, practical, no fluff |
| Fixed sections (📁💡⚡📋) | Ensures consistent structure even with cheap models |
| "Same language as original" | User answered: follow original response language |
| "Only critical one-liners" | User answered: include key code but not full blocks |
| "No filler phrases" | Prevents "Here's a summary of..." waste |
| `{threshold}` in max chars | Guarantees output fits in Telegram message |

### Architecture: Throwaway Session

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| OpenCode `session.summarize()` | Already exists | Summarizes entire session, not single response | Not suitable |
| Same session follow-up | Context loaded | Pollutes session history | Not suitable |
| Direct API call from bot | Clean, isolated | Needs separate API key | Unnecessary overhead |
| **Throwaway session** | **No extra key, existing models, zero pollution** | ~200ms overhead | **Best option** |

Flow:
1. Create temporary session (title: `_summary`)
2. Send summary prompt with user-selected model: `session.prompt({ model: { providerID, modelID } })`
3. Receive summary via SSE
4. Delete temporary session

### Model Selection

User selects from ALL models available on their OpenCode server via `/settings`.
No filtering — user decides. Models fetched from `client.config.providers()` at runtime.

### When Summary Runs

| User Setting | Response Length | Action |
|-------------|---------------|--------|
| Summary OFF | Any | Never summarize. Use structural extract for long responses. |
| Summary ON, no model selected | Any | Prompt user to select model in `/settings` |
| Summary ON | < threshold | No summary (already short enough) |
| Summary ON | ≥ threshold | AI summary inline + full .md attached |

### Structural Extract (Fallback, No AI)

When summary is OFF or unavailable, extract structure from raw response:
- Heading lines (`# ...`) → key points
- File path patterns (`src/...`, `*.ts`) → changed files list
- Code blocks → removed (biggest space consumer)
- Bullet points → preserved

Result: a shorter version that conveys WHAT happened without the HOW.

---

## Component 4: User Settings (`/settings`)

### Settings Structure

```typescript
interface UserSettings {
  summaryMode: boolean
  summaryModel: {
    providerID: string
    modelID: string
  } | null
  summaryThreshold: number
  outputMode: 'formatted' | 'raw'
}
```

Defaults: `{ summaryMode: false, summaryModel: null, summaryThreshold: 4000, outputMode: 'formatted' }`

### Telegram UI Flow

#### Main Settings Screen

```
User: /settings

Bot:
⚙️ Settings

📝 Output: Formatted ✅
📊 AI Summary: OFF
🤖 Model: not selected
📏 Threshold: 4,000 chars

[📝 Toggle Format] [📊 Toggle Summary]
[🤖 Select Model]  [📏 Set Threshold]
```

#### Model Selection (all available models, no filtering)

```
User: (presses 🤖 Select Model)

Bot:
🤖 Select summary model:

[Claude Haiku 3.5 (anthropic)]
[Claude Sonnet 4.5 (anthropic)]
[Claude Opus 4.5 (anthropic)]
[GPT-5.2 Codex (openai)]
[Gemini 3 Flash (google)]
[GPT-5 Nano (opencode)]
...
[◀️ Back]
```

#### Threshold Direct Input

```
User: (presses 📏 Set Threshold)

Bot:
📏 Enter summary threshold in characters.
Responses longer than this will be summarized.

Current: 4,000 chars
Examples: 2000, 4000, 8000, 15000

User: 6000

Bot:
✅ Summary threshold set to 6,000 chars.
```

Implementation: ChatState gets `awaitingInput: 'threshold' | null` field.
When set, next text message is intercepted as threshold input instead of being sent to OpenCode.

Validation:
- Must be a number
- Minimum: 500 (below this, summaries would be too aggressive)
- Maximum: 50,000 (above this, summary is pointless)
- Non-numeric input → "Please enter a number. Send /cancel to abort."

### Setting Descriptions

| Setting | Default | Purpose |
|---------|---------|---------|
| Output Format | `formatted` | Markdown→HTML conversion ON/OFF |
| AI Summary | `OFF` | Auto-summarize long responses |
| Summary Model | `null` | Which model to use for summarization |
| Summary Threshold | `4000` | Char count above which summary triggers |

---

## Implementation Order

### Phase 1: MarkdownV2 Conversion (estimated: 1-2 hours)
1. `bun add telegramify-markdown`
2. Create `src/shared/formatResponse.ts` — thin wrapper around `telegramify-markdown`
3. Update `promptFlow.ts`: replace `escapeHtml(content)` with `formatResponse(content)` + `parse_mode: 'MarkdownV2'`
4. Add `parseMode` parameter to `sendFinalResponse` to pass MarkdownV2
5. Test with real OpenCode responses (code blocks, links, nested formatting)

### Phase 2: Length Router + Semantic Chunking (estimated: 2-3 hours)
1. Create `src/app/policies/deliveryRouter.ts`
2. Implement code-heavy detection heuristic
3. Implement semantic chunking (section-aware splitting)
4. Update `sendFinalResponse` in `promptFlow.ts`
5. Add `disable_notification` for chunk messages 2+

### Phase 3: Settings System (estimated: 2-3 hours)
1. Add `UserSettings` to domain models
2. Update `jsonStateStore` to persist settings
3. Add `awaitingInput` to ChatState for threshold direct input
4. Create `/settings` command with inline keyboard
5. Add callback handlers for settings buttons + model list
6. Add text message interceptor for threshold input

### Phase 4: AI Summary (estimated: 3-4 hours)
1. Add `listModels()` to OpenCodePort — fetch all providers/models from server
2. Create `src/adapters/opencode/summaryService.ts` — throwaway session approach
3. Implement: create temp session → prompt with selected model → get response → delete session
4. Wire into delivery router (summary path)
5. Implement structural extract as fallback (no AI)
6. Handle: model unavailable, timeout, fallback to structural extract

### Phase 5: Status Card (from previous design — separate effort)
1. Tool/step event handling in eventMapper
2. StatusCard message management
3. 2-message system (status card + response)

---

## Open Questions

1. **Per-project settings**: Should settings be per-chat or per-project?
2. **Summary caching**: Cache summaries to avoid re-summarizing same content on retry?
3. **Throwaway session cleanup**: What if bot crashes mid-summary? Orphaned `_summary` sessions need cleanup on startup.
4. **Summary prompt tuning**: May need iteration after testing with real responses. Keep prompt in a constant for easy adjustment.

---

## File Structure After Implementation

```
src/
├── shared/
│   ├── formatResponse.ts        ← NEW: wrapper around telegramify-markdown
│   └── logger.ts
├── app/
│   ├── policies/
│   │   ├── limits.ts
│   │   └── deliveryRouter.ts    ← NEW: length routing + semantic chunking
│   └── usecases/
│       └── promptFlow.ts        ← MODIFIED: use converter + router
├── adapters/
│   ├── opencode/
│   │   ├── opencodeAdapter.ts   ← MODIFIED: add listModels()
│   │   └── summaryService.ts    ← NEW: throwaway session summarization
│   ├── telegram/
│   │   ├── commands/
│   │   │   └── settingsCmd.ts   ← NEW: /settings command
│   │   └── ui/
│   │       └── callbacks.ts     ← MODIFIED: add settings callbacks
│   └── persistence/
│       └── jsonStateStore.ts    ← MODIFIED: add UserSettings + awaitingInput
├── domain/
│   ├── models.ts                ← MODIFIED: add UserSettings type
│   └── ports/
│       └── SummaryPort.ts       ← NEW: summary port interface
└── config/
    └── env.ts                   ← (no changes needed)
```
