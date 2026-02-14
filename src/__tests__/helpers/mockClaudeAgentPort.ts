import type { ClaudeAgentPort, ModelInfo, QueryHandle } from '../../domain/ports/ClaudeAgentPort.js'
import type { ClaudeEvent } from '../../domain/events.js'
import { mock } from 'bun:test'

async function* emptyGenerator(): AsyncGenerator<ClaudeEvent, void, unknown> {
  // yields nothing by default
}

export function createMockClaudeAgentPort(overrides: Partial<ClaudeAgentPort> = {}): ClaudeAgentPort {
  const defaults: ClaudeAgentPort = {
    runQuery: mock(() => ({
      messages: emptyGenerator(),
      abort: mock(() => undefined),
      sessionId: 'test-session',
    } as QueryHandle)),
    getSupportedModels: mock(() => Promise.resolve<ModelInfo[]>([])),
  }
  return { ...defaults, ...overrides }
}
