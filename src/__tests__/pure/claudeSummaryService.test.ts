import { describe, it, expect } from 'bun:test'

// We test the pure functions exported indirectly by the module.
// Since they're not exported, we re-implement the logic inline for unit testing.
// The important testable behaviors are: truncation, expertise instructions, and prompt structure.

// Import the module to test createClaudeSummaryService (integration-style)
// For the pure helper functions, we extract and test their logic directly.

describe('claudeSummaryService helpers', () => {
  // ── truncateInput ──────────────────────────────────────────

  describe('truncateInput logic', () => {
    const MAX_INPUT_CHARS = 30_000

    function truncateInput(content: string): string {
      return content.length > MAX_INPUT_CHARS
        ? content.slice(0, MAX_INPUT_CHARS) + '\n\n[... truncated]'
        : content
    }

    it('returns short content unchanged', () => {
      const short = 'Hello world'
      expect(truncateInput(short)).toBe(short)
    })

    it('truncates content exceeding 30k chars', () => {
      const long = 'x'.repeat(35_000)
      const result = truncateInput(long)
      expect(result.length).toBeLessThan(long.length)
      expect(result).toEndWith('[... truncated]')
    })

    it('does not truncate content at exactly 30k', () => {
      const exact = 'a'.repeat(30_000)
      expect(truncateInput(exact)).toBe(exact)
    })
  })

  // ── getExpertiseInstruction ────────────────────────────────

  describe('getExpertiseInstruction logic', () => {
    // Re-implement to test the branching
    function getExpertiseInstruction(expertise: 'vibe' | 'developer' | 'beginner'): string {
      switch (expertise) {
        case 'vibe':
          return 'Non-technical user'
        case 'beginner':
          return 'Junior developer'
        case 'developer':
        default:
          return 'Professional software developer'
      }
    }

    it('returns non-technical for vibe', () => {
      expect(getExpertiseInstruction('vibe')).toContain('Non-technical')
    })

    it('returns junior for beginner', () => {
      expect(getExpertiseInstruction('beginner')).toContain('Junior')
    })

    it('returns professional for developer', () => {
      expect(getExpertiseInstruction('developer')).toContain('Professional')
    })
  })
})

describe('createClaudeSummaryService', () => {
  // Integration test for the service constructor — doesn't call CLI
  it('can be imported and created without errors', async () => {
    const { createClaudeSummaryService } = await import('../../adapters/claude/claudeSummaryService.js')
    const service = createClaudeSummaryService('/nonexistent/claude')
    expect(service).toHaveProperty('summarize')
    expect(service).toHaveProperty('summarizeForVoice')
    expect(typeof service.summarize).toBe('function')
    expect(typeof service.summarizeForVoice).toBe('function')
  })
})
