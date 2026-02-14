import { describe, it, expect } from 'bun:test'
import { createDefaultChatState, createDefaultUserSettings } from '../../domain/models.js'
import { DEFAULT_SUMMARY_MODEL } from '../../shared/constants.js'
import {
  AppError,
  SessionNotFoundError,
  QueryError,
  QueryAbortedError,
} from '../../domain/errors.js'

describe('domain/models', () => {
  describe('createDefaultUserSettings', () => {
    it('returns valid UserSettings with correct defaults', () => {
      const settings = createDefaultUserSettings()
      
      expect(settings.summaryMode).toBe(true)
      expect(settings.summaryModel).toEqual({ providerID: 'anthropic', modelID: DEFAULT_SUMMARY_MODEL })
      expect(settings.summaryThreshold).toBe(3000)
      expect(settings.outputMode).toBe('formatted')
      expect(settings.historyFormat).toBe('html')
      expect(settings.historyLimit).toBe(null)
      expect(settings.userExpertise).toBe('developer')
    })

    it('returns a new object each time', () => {
      const settings1 = createDefaultUserSettings()
      const settings2 = createDefaultUserSettings()
      
      expect(settings1).not.toBe(settings2)
      expect(settings1).toEqual(settings2)
    })
  })

  describe('createDefaultChatState', () => {
    it('returns valid ChatState with correct defaults', () => {
      const state = createDefaultChatState()
      
      expect(state.activeProjectDirectory).toBe(null)
      expect(state.activeSessionId).toBe(null)
      expect(state.activeAgent).toBe(null)
      expect(state.lastPrompt).toBe(null)
      expect(state.pendingInteractions).toEqual([])
      expect(state.awaitingInput).toBe(null)
      expect(state.awaitingInteractionId).toBe(null)
      expect(state.settings).toBeDefined()
    })

    it('includes default user settings', () => {
      const state = createDefaultChatState()
      const defaultSettings = createDefaultUserSettings()
      
      expect(state.settings).toEqual(defaultSettings)
    })

    it('returns a new object each time', () => {
      const state1 = createDefaultChatState()
      const state2 = createDefaultChatState()
      
      expect(state1).not.toBe(state2)
      expect(state1.settings).not.toBe(state2.settings)
    })
  })
})

describe('domain/errors', () => {
  describe('AppError', () => {
    it('has correct code and message', () => {
      const error = new AppError('TEST_CODE', 'Test message')
      
      expect(error.code).toBe('TEST_CODE')
      expect(error.message).toBe('Test message')
      expect(error.name).toBe('AppError')
    })

    it('is instance of Error', () => {
      const error = new AppError('TEST_CODE', 'Test message')
      
      expect(error instanceof Error).toBe(true)
    })

    it('is instance of AppError', () => {
      const error = new AppError('TEST_CODE', 'Test message')
      
      expect(error instanceof AppError).toBe(true)
    })
  })

  describe('SessionNotFoundError', () => {
    it('has correct error code SESSION_NOT_FOUND', () => {
      const error = new SessionNotFoundError('ses-123')
      
      expect(error.code).toBe('SESSION_NOT_FOUND')
    })

    it('includes sessionId in message', () => {
      const error = new SessionNotFoundError('ses-123')
      
      expect(error.message).toContain('ses-123')
    })

    it('extends AppError', () => {
      const error = new SessionNotFoundError('ses-123')
      
      expect(error instanceof AppError).toBe(true)
    })

    it('is instance of Error', () => {
      const error = new SessionNotFoundError('ses-123')
      
      expect(error instanceof Error).toBe(true)
    })
  })

  describe('QueryError', () => {
    it('has correct error code QUERY_ERROR', () => {
      const error = new QueryError('Something went wrong')
      expect(error.code).toBe('QUERY_ERROR')
    })

    it('includes message', () => {
      const error = new QueryError('Something went wrong')
      expect(error.message).toBe('Something went wrong')
    })

    it('preserves cause when provided', () => {
      const cause = new Error('Original')
      const error = new QueryError('Wrapped', cause)
      expect(error.cause).toBe(cause)
    })

    it('extends AppError', () => {
      const error = new QueryError('test')
      expect(error instanceof AppError).toBe(true)
    })
  })

  describe('QueryAbortedError', () => {
    it('has correct error code QUERY_ABORTED', () => {
      const error = new QueryAbortedError()
      expect(error.code).toBe('QUERY_ABORTED')
    })

    it('has abort message', () => {
      const error = new QueryAbortedError()
      expect(error.message).toContain('aborted')
    })

    it('extends AppError', () => {
      const error = new QueryAbortedError()
      expect(error instanceof AppError).toBe(true)
    })
  })
})
