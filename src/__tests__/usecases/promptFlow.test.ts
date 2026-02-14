import { describe, it, expect, mock, beforeEach } from 'bun:test'

import type { SessionWatcher } from '../../app/usecases/sessionWatcher.js'
import { createPromptFlow } from '../../app/usecases/promptFlow.js'
import {
  createMockClaudeAgentPort,
  createMockChatOutputPort,
  createMockStateStore,
  buildChatState,
  buildUserSettings,
} from '../helpers/index.js'

const chatId = 42
const directory = '/test'
const sessionId = 'ses-1'

describe('promptFlow', () => {
  let claude: ReturnType<typeof createMockClaudeAgentPort>
  let output: ReturnType<typeof createMockChatOutputPort>
  let state: ReturnType<typeof createMockStateStore>
  let watcher: SessionWatcher

  const createWatcher = (): SessionWatcher => ({
    watch: mock(() => Promise.resolve()),
    stop: mock(() => undefined),
    ensureWatching: mock(() => Promise.resolve()),
    isWatching: mock(() => false),
    setPromptHandle: mock(() => undefined),
    setPromptContext: mock(() => undefined),
    watchQuery: mock(() => undefined),
    getActiveQueryHandle: mock(() => null),
  })

  beforeEach(() => {
    claude = createMockClaudeAgentPort()
    output = createMockChatOutputPort()
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: directory,
      activeSessionId: sessionId,
    }))
    watcher = createWatcher()
  })

  it('sends a warning when no active project is set', async () => {
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: null,
      activeSessionId: sessionId,
    }))
    const flow = createPromptFlow({ claude, output, state, watcher, config: { maxThinkingTokens: 0, maxBudgetUsd: null } })

    await flow.handleUserMessage(chatId, 'hello')

    expect(output.sendText).toHaveBeenCalledWith(
      chatId,
      expect.stringContaining('DEFAULT_PROJECT'),
    )
    expect(claude.runQuery).not.toHaveBeenCalled()
    expect(watcher.ensureWatching).not.toHaveBeenCalled()
  })

  it('sends a warning when no active session exists', async () => {
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: directory,
      activeSessionId: null,
    }))
    const flow = createPromptFlow({ claude, output, state, watcher, config: { maxThinkingTokens: 0, maxBudgetUsd: null } })

    await flow.handleUserMessage(chatId, 'hello')

    expect(output.sendText).toHaveBeenCalledWith(
      chatId,
      expect.stringContaining('/new'),
    )
    expect(claude.runQuery).not.toHaveBeenCalled()
  })

  it('stores lastPrompt before sending', async () => {
    const flow = createPromptFlow({ claude, output, state, watcher, config: { maxThinkingTokens: 0, maxBudgetUsd: null } })

    await flow.handleUserMessage(chatId, 'hello')

    expect(state.saveChatState).toHaveBeenCalledWith(
      chatId,
      expect.objectContaining({ lastPrompt: 'hello' }),
      undefined,
    )
  })

  it('ensures watcher and sets prompt context with actor and group flag', async () => {
    const flow = createPromptFlow({ claude, output, state, watcher, config: { maxThinkingTokens: 0, maxBudgetUsd: null } })

    await flow.handleUserMessage(chatId, 'hello', { actorUserId: 7, isGroup: true })

    expect(watcher.ensureWatching).toHaveBeenCalledWith(chatId, undefined)
    expect(watcher.setPromptContext).toHaveBeenCalledWith(chatId, {
      actorUserId: 7,
      liveUpdatesEnabled: false,
      userPrompt: 'hello',
    }, undefined)
  })

  it('defaults live updates to enabled for direct chats', async () => {
    const flow = createPromptFlow({ claude, output, state, watcher, config: { maxThinkingTokens: 0, maxBudgetUsd: null } })

    await flow.handleUserMessage(chatId, 'hello')

    expect(watcher.setPromptContext).toHaveBeenCalledWith(chatId, {
      actorUserId: undefined,
      liveUpdatesEnabled: true,
      userPrompt: 'hello',
    }, undefined)
  })

  it('stores prompt handle from the processing message', async () => {
    const flow = createPromptFlow({ claude, output, state, watcher, config: { maxThinkingTokens: 0, maxBudgetUsd: null } })

    await flow.handleUserMessage(chatId, 'hello')

    expect(watcher.setPromptHandle).toHaveBeenCalledWith(chatId, 'msg-1', undefined)
  })

  it('includes activeAgent when sending prompts', async () => {
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: directory,
      activeSessionId: sessionId,
      activeAgent: 'agent-1',
    }))
    const flow = createPromptFlow({ claude, output, state, watcher, config: { maxThinkingTokens: 0, maxBudgetUsd: null } })

    await flow.handleUserMessage(chatId, 'hello')

    expect(claude.runQuery).toHaveBeenCalled()
  })

  it('uses review mode prefix when enabled in settings', async () => {
    state = createMockStateStore(buildChatState({
      activeProjectDirectory: directory,
      activeSessionId: sessionId,
      settings: buildUserSettings({ reviewMode: true }),
    }))
    const flow = createPromptFlow({ claude, output, state, watcher, config: { maxThinkingTokens: 0, maxBudgetUsd: null } })

    await flow.handleUserMessage(chatId, 'hello')

    expect(claude.runQuery).toHaveBeenCalled()
  })

  it('uses review mode when bot role is reader and setting is unset', async () => {
    const flow = createPromptFlow({
      claude,
      output,
      state,
      watcher,
      botRole: 'reader',
      config: { maxThinkingTokens: 0, maxBudgetUsd: null },
    })

    await flow.handleUserMessage(chatId, 'hello')

    expect(claude.runQuery).toHaveBeenCalled()
  })

  it('reports sendPrompt errors by editing the prompt handle', async () => {
    claude = createMockClaudeAgentPort({
      runQuery: mock(() => { throw new Error('boom') }),
    })
    const flow = createPromptFlow({ claude, output, state, watcher, config: { maxThinkingTokens: 0, maxBudgetUsd: null } })

    await flow.handleUserMessage(chatId, 'hello')

    expect(output.editText).toHaveBeenCalledWith(
      chatId,
      'msg-1',
      expect.stringContaining('Error:'),
    )
  })

  it('falls back to sendText when editText fails on error', async () => {
    claude = createMockClaudeAgentPort({
      runQuery: mock(() => { throw new Error('boom') }),
    })
    output = createMockChatOutputPort({
      editText: mock(() => Promise.reject(new Error('edit failed'))),
    })
    const flow = createPromptFlow({ claude, output, state, watcher, config: { maxThinkingTokens: 0, maxBudgetUsd: null } })

    await flow.handleUserMessage(chatId, 'hello')

    expect(output.sendText).toHaveBeenCalledWith(
      chatId,
      expect.stringContaining('Error:'),
    )
  })
})
