import { describe, it, expect } from 'bun:test'
import {
  answerLabel,
  refreshTTL,
  toSubmitAnswers,
} from '../../app/usecases/interactiveFlow.js'
import { escapeHtml } from '../../shared/formatResponse.js'
import { buildPendingInteraction } from '../helpers/builders.js'
import { LIMITS } from '../../app/policies/limits.js'

describe('interactiveFlow helpers', () => {
  describe('escapeHtml', () => {
    it('escapes less-than character', () => {
      expect(escapeHtml('<tag>')).toBe('&lt;tag&gt;')
    })

    it('escapes greater-than character', () => {
      expect(escapeHtml('a > b')).toBe('a &gt; b')
    })

    it('escapes ampersand character', () => {
      expect(escapeHtml('foo & bar')).toBe('foo &amp; bar')
    })

    it('handles empty string', () => {
      expect(escapeHtml('')).toBe('')
    })

    it('handles string with no special chars', () => {
      expect(escapeHtml('plain text')).toBe('plain text')
    })
  })

  describe('answerLabel', () => {
    it('returns waiting icon for null answer', () => {
      const label = answerLabel(null)
      expect(label).toBe('⏳')
    })

    it('returns skipped label for empty array', () => {
      const label = answerLabel([])
      expect(label).toBe('⏭️ skipped')
    })

    it('returns checkmark with first answer for non-empty array', () => {
      const label = answerLabel(['Option A'])
      expect(label).toContain('✅')
      expect(label).toContain('Option A')
    })

    it('escapes HTML in answer', () => {
      const label = answerLabel(['<script>alert(1)</script>'])
      expect(label).toContain('&lt;script&gt;')
      expect(label).not.toContain('<script>')
    })

    it('shows all elements for multiple selections', () => {
      const label = answerLabel(['First', 'Second'])
      expect(label).toContain('First')
      expect(label).toContain('Second')
      expect(label).toContain(', ')
    })
  })

  describe('refreshTTL', () => {
    it('updates expiresAt to current time plus TTL', () => {
      const interaction = buildPendingInteraction({ expiresAt: 0 })
      const before = Date.now()
      
      refreshTTL(interaction)
      
      const after = Date.now()
      const expected = before + LIMITS.INTERACTION_TTL_MS
      
      expect(interaction.expiresAt).toBeGreaterThanOrEqual(expected - 10)
      expect(interaction.expiresAt).toBeLessThanOrEqual(after + LIMITS.INTERACTION_TTL_MS + 10)
    })

    it('modifies the interaction object in place', () => {
      const interaction = buildPendingInteraction({ expiresAt: 12345 })
      const original = interaction
      
      refreshTTL(interaction)
      
      expect(interaction).toBe(original)
      expect(interaction.expiresAt).not.toBe(12345)
    })
  })

  describe('toSubmitAnswers', () => {
    it('converts null answers to empty arrays', () => {
      const interaction = buildPendingInteraction({
        collectedAnswers: [null, null],
      })
      
      const result = toSubmitAnswers(interaction)
      
      expect(result).toEqual([[], []])
    })

    it('preserves non-null answers as is', () => {
      const interaction = buildPendingInteraction({
        collectedAnswers: [['Answer 1'], ['Answer 2']],
      })
      
      const result = toSubmitAnswers(interaction)
      
      expect(result).toEqual([['Answer 1'], ['Answer 2']])
    })

    it('mixes null and non-null answers correctly', () => {
      const interaction = buildPendingInteraction({
        collectedAnswers: [['Option A'], null, [], ['Option D']],
      })
      
      const result = toSubmitAnswers(interaction)
      
      expect(result).toEqual([['Option A'], [], [], ['Option D']])
    })

    it('returns empty array when collectedAnswers is undefined', () => {
      const interaction = buildPendingInteraction({
        collectedAnswers: undefined,
      })
      
      const result = toSubmitAnswers(interaction)
      
      expect(result).toEqual([])
    })

    it('handles empty collectedAnswers array', () => {
      const interaction = buildPendingInteraction({
        collectedAnswers: [],
      })
      
      const result = toSubmitAnswers(interaction)
      
      expect(result).toEqual([])
    })

    it('preserves skipped answers as empty arrays', () => {
      const interaction = buildPendingInteraction({
        collectedAnswers: [[], null, ['Answer']],
      })
      
      const result = toSubmitAnswers(interaction)
      
      expect(result).toEqual([[], [], ['Answer']])
    })
  })
})
