# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Image support — send photos directly from Telegram for AI analysis
- Cloudflared tunnel support (`/tunnel`) — expose local servers via cloudflared tunnels
- Document handling — file uploads in addition to images
- `/git` command — git status, branch, diff, and log with inline keyboard buttons
- Voice TTS response system — AI summaries converted to voice (Edge TTS, Korean/English)
- Multi-select questions — checkbox-style UI for AI questions with multiple answers
- Inactivity detection — 30-minute idle session warning notifications
- Voice language selection — Korean/English TTS language toggle
- Voice auto-mode — automatic MP3 generation when AI finishes (no button tap needed)
- Expertise level selector — three modes: Vibe Coder (🎮), Developer (👨‍💻), Beginner (🌱) affecting both text summaries and voice prompts
- `/makeagent` command — AI-powered custom agent creation wizard

### Changed
- Voice delivery switched from `sendAudio` to `sendVoice` for native voice message UX (waveform display)
- Voice summary prompts unified to English with language-parameterized output
- Voice prompts rewritten for completeness-first approach instead of rigid length requirements

### Fixed
- Duplicate 'AI is working' message on user-initiated prompts
- Phone roleplay phrasing in voice prompts causing greetings like "여보세요"
- Windows server password passing via .bat wrapper for PowerShell env var inheritance

## [0.1.0] - 2026-02-03

### Added
- Initial public release
- Telegram bot for remote OpenCode agent control
- Session management commands: `/new`, `/list`, `/resume`, `/abort`
- Interactive permission and question handling with inline keyboards
- Multi-project support via `data/projects.json`
- Summary mode with customizable AI models (`/settings`)
- Agent selection (`/agents`)
- Message queue with `/queue`, `/undo`, `/redo` commands
- Real-time SSE streaming with throttled message updates
- File delivery for oversized responses (>4KB)
- Per-chat state persistence (JSON file store)
- Session history export (`/history`)
- Status overview (`/start`, `/status`)
- Help command (`/help`)
- Bilingual documentation (English/Korean)
- PM2 ecosystem config for multi-bot deployment
- Interactive setup wizard (`bun run setup`)
- Configuration diagnostics (`bun run doctor`)

### Documentation
- Installation guide (EN/KR)
- Command reference (EN/KR)
- Deployment guide (EN/KR)
- Multi-bot setup guide (EN/KR)
- Troubleshooting guide (EN/KR)

[Unreleased]: https://github.com/reahbi/opencode-go/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/reahbi/opencode-go/releases/tag/v0.1.0
