import { describe, it, expect, mock } from 'bun:test'
import type { Options } from '@anthropic-ai/claude-agent-sdk'

const capturedOptions: Options[] = []
const supportedModelsMock = mock(async () => [
  { value: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
  { value: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
])

const queryMock = mock(({ options }: { prompt: unknown; options: Options }) => {
  capturedOptions.push(options)
  return {
    async *[Symbol.asyncIterator]() {
    },
    supportedModels: supportedModelsMock,
    close: mock(() => undefined),
  }
})

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}))

const { createClaudeAgentAdapter } = await import('../../adapters/claude/claudeAgentAdapter.js')

function getLastCapturedOptions(): Options {
  const options = capturedOptions[capturedOptions.length - 1]
  expect(options).toBeDefined()
  return options as Options
}

function clearMocks() {
  capturedOptions.length = 0
  queryMock.mockClear()
  supportedModelsMock.mockClear()
}

describe('claudeAgentAdapter', () => {
  it('can be created with config', () => {
    clearMocks()
    const adapter = createClaudeAgentAdapter({ model: 'claude-sonnet-4-5' })
    expect(adapter).toHaveProperty('runQuery')
    expect(adapter).toHaveProperty('getSupportedModels')
  })

  it('accepts optional claudeCodePath', () => {
    clearMocks()
    const adapter = createClaudeAgentAdapter({
      model: 'claude-sonnet-4-5',
      claudeCodePath: '/usr/local/bin/claude',
    })
    expect(adapter).toBeDefined()
  })

  it('accepts null claudeCodePath', () => {
    clearMocks()
    const adapter = createClaudeAgentAdapter({
      model: 'claude-sonnet-4-5',
      claudeCodePath: null,
    })
    expect(adapter).toBeDefined()
  })

  describe('runQuery permission mode mapping', () => {
    it('maps bypass to bypassPermissions and enables dangerous skip permissions', () => {
      clearMocks()
      const adapter = createClaudeAgentAdapter({ model: 'claude-sonnet-4-5' })

      adapter.runQuery({ prompt: 'test', cwd: '/tmp/project', permissionMode: 'bypass' })

      const options = getLastCapturedOptions()
      expect(options.permissionMode).toBe('bypassPermissions')
      expect(options.allowDangerouslySkipPermissions).toBe(true)
    })

    it('maps plan to plan and does not enable dangerous skip permissions', () => {
      clearMocks()
      const adapter = createClaudeAgentAdapter({ model: 'claude-sonnet-4-5' })

      adapter.runQuery({ prompt: 'test', cwd: '/tmp/project', permissionMode: 'plan' })

      const options = getLastCapturedOptions()
      expect(options.permissionMode).toBe('plan')
      expect(options.allowDangerouslySkipPermissions).not.toBe(true)
    })

    it('maps ask to default and does not enable dangerous skip permissions', () => {
      clearMocks()
      const adapter = createClaudeAgentAdapter({ model: 'claude-sonnet-4-5' })

      adapter.runQuery({ prompt: 'test', cwd: '/tmp/project', permissionMode: 'ask' })

      const options = getLastCapturedOptions()
      expect(options.permissionMode).toBe('default')
      expect(options.allowDangerouslySkipPermissions).not.toBe(true)
    })
  })

  describe('getSupportedModels', () => {
    it('returns a list of models', async () => {
      clearMocks()
      const adapter = createClaudeAgentAdapter({ model: 'claude-sonnet-4-5' })
      const models = await adapter.getSupportedModels()

      expect(models.length).toBeGreaterThan(0)
      expect(models.every(m => m.id && m.name)).toBe(true)
    })

    it('includes sonnet and haiku variants', async () => {
      clearMocks()
      const adapter = createClaudeAgentAdapter({ model: 'claude-sonnet-4-5' })
      const models = await adapter.getSupportedModels()
      const ids = models.map(m => m.id)

      expect(ids.some(id => id.includes('sonnet'))).toBe(true)
      expect(ids.some(id => id.includes('haiku'))).toBe(true)
    })

    it('model entries have both id and name', async () => {
      clearMocks()
      const adapter = createClaudeAgentAdapter({ model: 'claude-sonnet-4-5' })
      const models = await adapter.getSupportedModels()

      for (const model of models) {
        expect(typeof model.id).toBe('string')
        expect(typeof model.name).toBe('string')
        expect(model.id.length).toBeGreaterThan(0)
        expect(model.name.length).toBeGreaterThan(0)
      }
    })
  })
})
