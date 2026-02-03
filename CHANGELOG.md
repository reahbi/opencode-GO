# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
