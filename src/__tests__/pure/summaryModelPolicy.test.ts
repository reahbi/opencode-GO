import { describe, expect, it } from 'bun:test'
import type { ModelInfo } from '../../domain/ports/OpenCodePort.js'
import { isSummaryCandidate, sortSummaryModels, groupModelsByProvider, sortModelsNewestFirst } from '../../app/policies/summaryModelPolicy.js'

function model(overrides: Partial<ModelInfo>): ModelInfo {
  return {
    providerID: 'opencode',
    modelID: 'default-model',
    name: 'Default Model',
    ...overrides,
  }
}

describe('summaryModelPolicy', () => {
  describe('isSummaryCandidate', () => {
    it('includes non-lightweight OpenAI models', () => {
      const result = isSummaryCandidate(model({
        providerID: 'openai',
        modelID: 'gpt-5.2',
        name: 'GPT-5.2 (OAuth)',
      }))

      expect(result).toBe(true)
    })

    it('excludes preview models', () => {
      const result = isSummaryCandidate(model({
        providerID: 'openai',
        modelID: 'gpt-5.3-preview-02-10',
        name: 'GPT-5.3 Preview',
      }))

      expect(result).toBe(false)
    })
  })

  describe('sortSummaryModels', () => {
    it('ranks preferred OpenAI OAuth models at the top', () => {
      const sorted = sortSummaryModels([
        model({ providerID: 'opencode', modelID: 'gpt-5-nano', name: 'GPT-5 Nano' }),
        model({ providerID: 'openai', modelID: 'gpt-5.2', name: 'GPT-5.2 (OAuth)', authKind: 'oauth' }),
        model({ providerID: 'openai', modelID: 'gpt-5.3-codex', name: 'GPT-5.3 Codex (OAuth)', authKind: 'oauth' }),
        model({ providerID: 'openai', modelID: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark (OAuth)', authKind: 'oauth' }),
        model({ providerID: 'google', modelID: 'gemini-2.5-flash', name: 'Gemini Flash Latest' }),
      ])

      expect(sorted[0].modelID).toBe('gpt-5.3-codex-spark')
      expect(sorted[1].modelID).toBe('gpt-5.3-codex')
      expect(sorted[2].modelID).toBe('gpt-5.2')
    })

    it('prefers OAuth-authenticated model names over non-OAuth when versions tie', () => {
      const sorted = sortSummaryModels([
        model({ providerID: 'openai', modelID: 'gpt-5.1-codex-mini', name: 'GPT 5.1 Codex Mini', authKind: 'none' }),
        model({ providerID: 'openai', modelID: 'gpt-5.1-codex-mini', name: 'GPT 5.1 Codex Mini (OAuth)', authKind: 'oauth' }),
      ])

      expect(sorted[0].name).toContain('(OAuth)')
    })

    it('uses releaseDate recency when no explicit preference exists', () => {
      const sorted = sortSummaryModels([
        model({ providerID: 'openai', modelID: 'gpt-4.1-mini', name: 'GPT 4.1 Mini (OAuth)', authKind: 'oauth', releaseDate: '2025-01-01' }),
        model({ providerID: 'openai', modelID: 'gpt-4.1-mini-20250615', name: 'GPT 4.1 Mini 2025-06-15 (OAuth)', authKind: 'oauth', releaseDate: '2025-06-15' }),
      ])

      expect(sorted[0].releaseDate).toBe('2025-06-15')
    })
  })

  describe('groupModelsByProvider', () => {
    it('groups models by provider and sorts by count descending', () => {
      const groups = groupModelsByProvider([
        model({ providerID: 'google', modelID: 'gemini-flash', name: 'Flash' }),
        model({ providerID: 'openai', modelID: 'gpt-5.2', name: 'GPT 5.2' }),
        model({ providerID: 'google', modelID: 'gemini-pro', name: 'Pro' }),
        model({ providerID: 'openai', modelID: 'gpt-5.3', name: 'GPT 5.3' }),
        model({ providerID: 'openai', modelID: 'gpt-5.1', name: 'GPT 5.1' }),
      ])

      expect(groups[0].providerID).toBe('openai')
      expect(groups[0].models).toHaveLength(3)
      expect(groups[1].providerID).toBe('google')
      expect(groups[1].models).toHaveLength(2)
    })

    it('returns empty array for empty input', () => {
      expect(groupModelsByProvider([])).toEqual([])
    })
  })

  describe('sortModelsNewestFirst', () => {
    it('sorts by auth priority then recency', () => {
      const sorted = sortModelsNewestFirst([
        model({ providerID: 'openai', modelID: 'old', name: 'Old', authKind: 'oauth', releaseDate: '2025-01-01' }),
        model({ providerID: 'openai', modelID: 'new', name: 'New', authKind: 'oauth', releaseDate: '2025-06-01' }),
        model({ providerID: 'openai', modelID: 'api', name: 'API', authKind: 'api', releaseDate: '2025-12-01' }),
      ])

      expect(sorted[0].modelID).toBe('new')
      expect(sorted[1].modelID).toBe('old')
      expect(sorted[2].modelID).toBe('api')
    })

    it('prefers oauth over non-oauth regardless of date', () => {
      const sorted = sortModelsNewestFirst([
        model({ providerID: 'google', modelID: 'env-new', name: 'Env New', authKind: 'env', releaseDate: '2026-01-01' }),
        model({ providerID: 'google', modelID: 'oauth-old', name: 'OAuth Old', authKind: 'oauth', releaseDate: '2024-01-01' }),
      ])

      expect(sorted[0].modelID).toBe('oauth-old')
    })
  })
})
