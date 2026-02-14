import { describe, it, expect } from 'bun:test'
import { isAskUserQuestion, parseAskUserQuestion, getThinkingLevel } from '../../adapters/claude/claudeEventMapper.js'
import type { ClaudeEvent } from '../../domain/events.js'

describe('claudeEventMapper', () => {
  // ── isAskUserQuestion ──────────────────────────────────────

  describe('isAskUserQuestion', () => {
    it('returns true for AskUserQuestion tool.use event', () => {
      const event: ClaudeEvent = {
        type: 'tool.use',
        sessionId: 's1',
        toolName: 'AskUserQuestion',
        input: {},
        toolUseId: 'tu-1',
      }
      expect(isAskUserQuestion(event)).toBe(true)
    })

    it('returns false for other tool names', () => {
      const event: ClaudeEvent = {
        type: 'tool.use',
        sessionId: 's1',
        toolName: 'Read',
        input: {},
        toolUseId: 'tu-1',
      }
      expect(isAskUserQuestion(event)).toBe(false)
    })

    it('returns false for non-tool.use events', () => {
      const event: ClaudeEvent = { type: 'text.done', sessionId: 's1', content: 'hello', uuid: 'u1' }
      expect(isAskUserQuestion(event)).toBe(false)
    })

    it('returns false for result event', () => {
      const event: ClaudeEvent = { type: 'result', sessionId: 's1', subtype: 'success' }
      expect(isAskUserQuestion(event)).toBe(false)
    })
  })

  // ── parseAskUserQuestion ───────────────────────────────────

  describe('parseAskUserQuestion', () => {
    function makeToolUse(input: unknown) {
      return {
        type: 'tool.use' as const,
        sessionId: 'ses-1',
        toolName: 'AskUserQuestion',
        input,
        toolUseId: 'tu-123',
      }
    }

    it('parses questions with label-based options', () => {
      const event = makeToolUse({
        questions: [
          {
            question: 'Which library?',
            header: 'Library',
            options: [
              { label: 'Option A', description: 'desc A' },
              { label: 'Option B', description: 'desc B' },
            ],
            multiSelect: false,
          },
        ],
      })

      const result = parseAskUserQuestion(event)
      expect(result).not.toBeNull()
      expect(result!.requestId).toBe('tu-123')
      expect(result!.sessionId).toBe('ses-1')
      expect(result!.questions).toHaveLength(1)
      expect(result!.questions[0].text).toBe('Which library?')
      expect(result!.questions[0].options).toEqual(['Option A', 'Option B'])
      expect(result!.questions[0].multiple).toBe(false)
    })

    it('parses questions with string options', () => {
      const event = makeToolUse({
        questions: [
          {
            question: 'Pick one',
            options: ['Foo', 'Bar'],
          },
        ],
      })

      const result = parseAskUserQuestion(event)
      expect(result!.questions[0].options).toEqual(['Foo', 'Bar'])
    })

    it('falls back to header when question is missing', () => {
      const event = makeToolUse({
        questions: [{ header: 'Fallback Header' }],
      })

      const result = parseAskUserQuestion(event)
      expect(result!.questions[0].text).toBe('Fallback Header')
    })

    it('handles multiSelect: true', () => {
      const event = makeToolUse({
        questions: [
          {
            question: 'Select all',
            options: [{ label: 'A' }, { label: 'B' }],
            multiSelect: true,
          },
        ],
      })

      const result = parseAskUserQuestion(event)
      expect(result!.questions[0].multiple).toBe(true)
    })

    it('returns null for undefined input', () => {
      const event = makeToolUse(undefined)
      expect(parseAskUserQuestion(event)).toBeNull()
    })

    it('returns null for empty questions array', () => {
      const event = makeToolUse({ questions: [] })
      expect(parseAskUserQuestion(event)).toBeNull()
    })

    it('returns null for missing questions field', () => {
      const event = makeToolUse({ other: 'data' })
      expect(parseAskUserQuestion(event)).toBeNull()
    })

    it('handles null question objects gracefully', () => {
      const event = makeToolUse({ questions: [null, 42] })
      const result = parseAskUserQuestion(event)
      expect(result).not.toBeNull()
      // non-object entries get id but empty text
      expect(result!.questions[0].text).toBe('')
      expect(result!.questions[1].text).toBe('')
    })

    it('parses multiple questions', () => {
      const event = makeToolUse({
        questions: [
          { question: 'Q1', options: [{ label: 'A' }] },
          { question: 'Q2', multiSelect: true },
        ],
      })

      const result = parseAskUserQuestion(event)
      expect(result!.questions).toHaveLength(2)
      expect(result!.questions[0].id).toBe('0')
      expect(result!.questions[1].id).toBe('1')
      expect(result!.questions[1].multiple).toBe(true)
    })

    it('omits options when none have valid labels', () => {
      const event = makeToolUse({
        questions: [
          { question: 'Q', options: [{ noLabel: true }, 123] },
        ],
      })

      const result = parseAskUserQuestion(event)
      expect(result!.questions[0].options).toBeUndefined()
    })
  })

  // ── getThinkingLevel ───────────────────────────────────────

  describe('getThinkingLevel', () => {
    it('returns 0 for normal messages', () => {
      expect(getThinkingLevel('Hello world')).toBe(0)
      expect(getThinkingLevel('Fix this bug')).toBe(0)
    })

    it('returns 10000 for basic thinking keywords', () => {
      expect(getThinkingLevel('think about this')).toBe(10000)
      expect(getThinkingLevel('analyze this code')).toBe(10000)
      expect(getThinkingLevel('이 코드를 분석해줘')).toBe(10000)
      expect(getThinkingLevel('좀 생각해봐')).toBe(10000)
      expect(getThinkingLevel('고민해봐')).toBe(10000)
      expect(getThinkingLevel('consider the alternatives')).toBe(10000)
      expect(getThinkingLevel('reason through this')).toBe(10000)
    })

    it('returns 50000 for deep thinking keywords', () => {
      expect(getThinkingLevel('deep think about this')).toBe(50000)
      expect(getThinkingLevel('think deeply about this')).toBe(50000)
      expect(getThinkingLevel('깊이 분석해줘')).toBe(50000)
      expect(getThinkingLevel('심층 분석 해봐')).toBe(50000)
      expect(getThinkingLevel('do a thorough review')).toBe(50000)
      expect(getThinkingLevel('comprehensive analysis please')).toBe(50000)
    })

    it('is case-insensitive', () => {
      expect(getThinkingLevel('THINK about this')).toBe(10000)
      expect(getThinkingLevel('DEEPLY analyze')).toBe(50000)
    })

    it('deep keywords take precedence over basic', () => {
      // "deeply" matches deep, even though "think" also matches basic
      expect(getThinkingLevel('think deeply about this problem')).toBe(50000)
    })
  })
})
