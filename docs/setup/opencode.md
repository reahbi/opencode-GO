[Korean](opencode-kr.md)

# Claude Code Setup Guide

Claude-Go uses the Claude Code CLI and Claude Agent SDK to interact with AI directly — no separate server required.

## Claude Code Overview

Claude Code is Anthropic's official CLI for Claude. Claude-Go embeds the Claude Agent SDK in-process, using `query()` to communicate with AI directly. This means **no separate server process** is needed.

## Installation

1. Install Claude Code CLI:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. Authenticate (run once):
   ```bash
   claude
   ```
   Follow the prompts to log in with your Anthropic account.

3. Verify installation:
   ```bash
   claude --version
   ```

## Configuration

Claude-Go accepts these optional environment variables for Claude configuration:

```bash
# Claude model (optional, default: claude-sonnet-4-5)
CLAUDE_MODEL=claude-sonnet-4-5

# Path to Claude Code executable (optional, auto-detected if on PATH)
CLAUDE_CODE_PATH=/usr/local/bin/claude

# Extended Thinking token limit (optional, 0 = disabled)
MAX_THINKING_TOKENS=0

# Max budget per session in USD (optional, no limit if unset)
MAX_BUDGET_USD=5.00
```

## How It Works

Unlike the previous OpenCode-based architecture (which required a separate server), Claude-Go runs as a **single process**:

```
Previous:  Bot ──HTTP+SSE──> OpenCode Server (separate process)
Now:       Bot ← Agent SDK query() embedded (same process)
```

- The Claude Agent SDK's `query()` function returns an `AsyncGenerator` for real-time streaming
- Sessions are managed locally via JSON files (no server API needed)
- Summaries are generated using the Claude CLI as a subprocess (`claude -p`)
- Permission mode is set to `bypassPermissions` — the AI executes tools without prompts

## Verifying It Works

After configuring Claude-Go, run the diagnostic tool:
```bash
bun run doctor
```

This checks that Claude Code CLI is installed and accessible.

## Model Selection

You can change the AI model at runtime using the `/agents` command in Telegram, or set the default model via `CLAUDE_MODEL` environment variable.

## Extended Thinking

Extended Thinking allows Claude to show its reasoning process. It's triggered automatically by keywords like "think", "analyze", or "deep" in your messages, or you can set `MAX_THINKING_TOKENS` to a non-zero value to enable it by default.

## Budget Control

Set `MAX_BUDGET_USD` to limit spending per session. This is passed directly to the SDK's `maxBudgetUsd` option. You can also configure this per-session via `/settings` in Telegram.
