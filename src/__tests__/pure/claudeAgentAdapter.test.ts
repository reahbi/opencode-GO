import { describe, it, expect } from 'bun:test'
import { createClaudeAgentAdapter } from '../../adapters/claude/claudeAgentAdapter.js'

describe('claudeAgentAdapter', () => {
  // We test what we can without actually calling the SDK

  it('can be created with config', () => {
    const adapter = createClaudeAgentAdapter({ model: 'claude-sonnet-4-5' })
    expect(adapter).toHaveProperty('runQuery')
    expect(adapter).toHaveProperty('getSupportedModels')
  })

  it('accepts optional claudeCodePath', () => {
    const adapter = createClaudeAgentAdapter({
      model: 'claude-sonnet-4-5',
      claudeCodePath: '/usr/local/bin/claude',
    })
    expect(adapter).toBeDefined()
  })

  it('accepts null claudeCodePath', () => {
    const adapter = createClaudeAgentAdapter({
      model: 'claude-sonnet-4-5',
      claudeCodePath: null,
    })
    expect(adapter).toBeDefined()
  })

  describe('getSupportedModels', () => {
    it('returns a list of models', async () => {
      const adapter = createClaudeAgentAdapter({ model: 'claude-sonnet-4-5' })
      const models = await adapter.getSupportedModels()

      expect(models.length).toBeGreaterThan(0)
      expect(models.every(m => m.id && m.name)).toBe(true)
    })

    it('includes sonnet and haiku variants', async () => {
      const adapter = createClaudeAgentAdapter({ model: 'claude-sonnet-4-5' })
      const models = await adapter.getSupportedModels()
      const ids = models.map(m => m.id)

      expect(ids.some(id => id.includes('sonnet'))).toBe(true)
      expect(ids.some(id => id.includes('haiku'))).toBe(true)
    })

    it('model entries have both id and name', async () => {
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
