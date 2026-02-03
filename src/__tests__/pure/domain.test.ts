import { describe, it, expect } from 'bun:test'
import { createDefaultChatState, createDefaultUserSettings } from '../../domain/models.js'
import {
  AppError,
  SessionNotFoundError,
  OpenCodeConnectionError,
  OpenCodeApiError,
} from '../../domain/errors.js'

describe('domain/models', () => {
  describe('createDefaultUserSettings', () => {
    it('returns valid UserSettings with correct defaults', () => {
      const settings = createDefaultUserSettings()
      
      expect(settings.summaryMode).toBe(false)
      expect(settings.summaryModel).toBe(null)
      expect(settings.summaryThreshold).toBe(6000)
      expect(settings.outputMode).toBe('formatted')
      expect(settings.historyFormat).toBe('html')
      expect(settings.historyLimit).toBe(null)
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

  describe('OpenCodeConnectionError', () => {
    it('has correct error code OPENCODE_CONNECTION_ERROR', () => {
      const error = new OpenCodeConnectionError('http://localhost:4096')
      
      expect(error.code).toBe('OPENCODE_CONNECTION_ERROR')
    })

    it('includes URL in message', () => {
      const error = new OpenCodeConnectionError('http://localhost:4096')
      
      expect(error.message).toContain('http://localhost:4096')
    })

    it('preserves cause when provided', () => {
      const cause = new Error('Network failure')
      const error = new OpenCodeConnectionError('http://localhost:4096', cause)
      
      expect(error.cause).toBe(cause)
    })

    it('extends AppError', () => {
      const error = new OpenCodeConnectionError('http://localhost:4096')
      
      expect(error instanceof AppError).toBe(true)
    })

    it('is instance of Error', () => {
      const error = new OpenCodeConnectionError('http://localhost:4096')
      
      expect(error instanceof Error).toBe(true)
    })
  })

  describe('OpenCodeApiError', () => {
    it('has correct error code OPENCODE_API_ERROR', () => {
      const error = new OpenCodeApiError('POST', 500, 'Internal server error')
      
      expect(error.code).toBe('OPENCODE_API_ERROR')
    })

    it('includes method, status, and message in error message', () => {
      const error = new OpenCodeApiError('POST', 500, 'Internal server error')
      
      expect(error.message).toContain('POST')
      expect(error.message).toContain('500')
      expect(error.message).toContain('Internal server error')
    })

    it('extends AppError', () => {
      const error = new OpenCodeApiError('GET', 404, 'Not found')
      
      expect(error instanceof AppError).toBe(true)
    })

    it('is instance of Error', () => {
      const error = new OpenCodeApiError('GET', 404, 'Not found')
      
      expect(error instanceof Error).toBe(true)
    })
  })
})
