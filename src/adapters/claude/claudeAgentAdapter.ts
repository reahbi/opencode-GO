import { query, type Options, type SDKMessage, type SDKResultMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  ClaudeAgentPort,
  QueryOptions,
  QueryHandle,
  ModelInfo,
  TokenUsage,
} from '../../domain/ports/ClaudeAgentPort.js'
import type { ClaudeEvent } from '../../domain/events.js'
import type { ImageAttachment } from '../../domain/models.js'
import { logger } from '../../shared/logger.js'

interface ClaudeAgentAdapterConfig {
  model: string
  claudeCodePath?: string | null
}

function prepareSdkProcessEnv(): void {
  delete process.env.CLAUDECODE
  delete process.env.CLAUDE_CODE_ENTRYPOINT
}

// Type guard to narrow SDKResultMessage to error variant
function isResultError(msg: SDKResultMessage): msg is SDKResultMessage & { subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries' } {
  return msg.subtype !== 'success'
}

/** Build an SDKUserMessage with text and optional inline images */
function buildUserMessage(text: string, images?: ImageAttachment[]): string | AsyncIterable<SDKUserMessage> {
  if (!images || images.length === 0) {
    return text
  }

  // Build content blocks: images first, then text
  const content: Array<
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    | { type: 'text'; text: string }
  > = []

  for (const img of images) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mime,
        data: img.data,
      },
    })
  }

  content.push({ type: 'text', text })

  // Return a single-item AsyncIterable<SDKUserMessage>
  const message: SDKUserMessage = {
    type: 'user',
    message: {
      role: 'user',
      content,
    },
    parent_tool_use_id: null,
    session_id: '',
  }

  return (async function* () {
    yield message
  })()
}

function mapPermissionMode(permissionMode: QueryOptions['permissionMode']): Pick<Options, 'permissionMode' | 'allowDangerouslySkipPermissions'> {
  if (permissionMode === 'plan') {
    return { permissionMode: 'plan' }
  }

  if (permissionMode === 'ask') {
    return { permissionMode: 'default' }
  }

  return {
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
  }
}

export function createClaudeAgentAdapter(config: ClaudeAgentAdapterConfig): ClaudeAgentPort {
  const { model: defaultModel, claudeCodePath } = config

  async function* transformEvents(
    queryGenerator: AsyncGenerator<SDKMessage, void, unknown>,
    abortController: AbortController
  ): AsyncGenerator<ClaudeEvent, void, unknown> {
    let sessionId: string | null = null
    let isAborted = false

    // Set up abort listener
    const abortHandler = () => {
      isAborted = true
    }
    abortController.signal.addEventListener('abort', abortHandler)

    try {
      for await (const event of queryGenerator) {
        if (isAborted) {
          logger.debug('claude', 'Query aborted, stopping event iteration')
          break
        }

        // Capture session_id from first event
        if (!sessionId && event.session_id) {
          sessionId = event.session_id
          logger.debug('claude', `Session started: ${sessionId}`)

          // Emit system.init event
          yield {
            type: 'system.init',
            sessionId: event.session_id,
            model: defaultModel,
            tools: [],
          }
        }

        const sid = sessionId || ''

        // Handle partial assistant messages (streaming text deltas)
        if (event.type === 'stream_event') {
          const streamEvent = event.event as any

          // Handle content_block_delta events for text streaming
          if (streamEvent.type === 'content_block_delta') {
            const delta = streamEvent.delta
            if (delta?.type === 'text_delta' && delta.text) {
              yield {
                type: 'text.delta',
                sessionId: sid,
                content: delta.text,
              }
            }
          }
          continue
        }

        // Map SDK events to domain events
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              yield {
                type: 'text.done',
                sessionId: sid,
                content: block.text,
                uuid: event.message.id || '',
              }
            } else if (block.type === 'thinking') {
              yield {
                type: 'thinking',
                sessionId: sid,
                content: block.thinking,
              }
            } else if (block.type === 'tool_use') {
              yield {
                type: 'tool.use',
                sessionId: sid,
                toolName: block.name,
                input: block.input,
                toolUseId: block.id,
              }
            } else if (block.type === 'tool_result') {
              const output =
                typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
              yield {
                type: 'tool.result',
                sessionId: sid,
                toolUseId: block.tool_use_id || '',
                output,
              }
            }
          }
        } else if (event.type === 'result') {
          // Map usage information
          const usage: TokenUsage | undefined = event.usage
            ? {
                inputTokens: event.usage.input_tokens || 0,
                outputTokens: event.usage.output_tokens || 0,
                cacheReadInputTokens: event.usage.cache_read_input_tokens,
                cacheCreationInputTokens: event.usage.cache_creation_input_tokens,
              }
            : undefined

          // Determine if this is an error result using type guard
          const isError = isResultError(event)
          const subtype = isError ? 'error' : 'success'

          // Extract error message from error results
          const errorMessage = isError ? event.errors?.[0] : undefined

          yield {
            type: 'result',
            sessionId: sid,
            subtype,
            usage,
            costUsd: event.total_cost_usd,
            errorMessage,
          }

          logger.debug('claude', `Query result: ${subtype}`, usage)
        }
      }
    } catch (error) {
      if (!isAborted) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        logger.error('claude', 'Query error:', errorMsg)

        yield {
          type: 'error',
          sessionId: sessionId ?? '',
          message: errorMsg,
        }
      }
    } finally {
      abortController.signal.removeEventListener('abort', abortHandler)
    }
  }

  function runQuery(options: QueryOptions): QueryHandle {
    prepareSdkProcessEnv()

    const abortController = new AbortController()
    let capturedSessionId: string | null = null
    const permissionOptions = mapPermissionMode(options.permissionMode)

    // Build SDK options
    const sdkOptions: Options = {
      model: options.model || defaultModel,
      cwd: options.cwd,
      settingSources: ['user', 'project'],
      ...permissionOptions,
      maxThinkingTokens: options.maxThinkingTokens,
      systemPrompt: options.systemPrompt,
      abortController,
      enableFileCheckpointing: true,
      includePartialMessages: true,
    }

    // Add maxBudgetUsd if provided
    if (options.maxBudgetUsd !== undefined) {
      sdkOptions.maxBudgetUsd = options.maxBudgetUsd
    }

    // Add agents if provided (map AgentDefinition records to SDK format)
    if (options.agents) {
      const sdkAgents: Record<string, any> = {}
      for (const [name, agent] of Object.entries(options.agents)) {
        sdkAgents[name] = {
          description: agent.description || '',
          prompt: agent.systemPrompt || '',
        }
      }
      sdkOptions.agents = sdkAgents
    }

    // Session handling:
    // - `sessionId`: forces a specific UUID for new sessions (1st message only)
    // - `resume`: loads existing conversation history from disk (2nd+ messages)
    // The SDK throws if both are used together without `forkSession`.
    if (options.sessionId) {
      if (options.isNewSession) {
        sdkOptions.sessionId = options.sessionId
      } else {
        sdkOptions.resume = options.sessionId
      }
    }

    // Add MCP servers if provided
    if (options.mcpServers) {
      sdkOptions.mcpServers = options.mcpServers as Record<
        string,
        { command: string; args?: string[]; env?: Record<string, string> }
      >
    }

    // Add custom Claude Code path if configured
    if (claudeCodePath) {
      sdkOptions.pathToClaudeCodeExecutable = claudeCodePath
    }

    logger.debug('claude', `Starting query with model: ${sdkOptions.model}`)

    // Build prompt: string for text-only, AsyncIterable<SDKUserMessage> for images
    const prompt = buildUserMessage(options.prompt, options.images)
    if (options.images?.length) {
      logger.debug('claude', `Sending ${options.images.length} inline images via SDKUserMessage`)
    }

    const queryInstance = query({ prompt, options: sdkOptions })

    // Create async generator wrapper that captures sessionId
    const messagesGenerator = (async function* () {
      for await (const event of transformEvents(queryInstance, abortController)) {
        if (event.type === 'system.init' && event.sessionId) {
          capturedSessionId = event.sessionId
        }
        yield event
      }
    })()

    return {
      messages: messagesGenerator,
      abort: () => {
        logger.debug('claude', 'Aborting query')
        abortController.abort()
      },
      get sessionId() {
        return capturedSessionId
      },
      async rewindFiles(uuid: string): Promise<boolean> {
        try {
          if (!queryInstance) {
            logger.warn('claude', 'rewindFiles called before query started')
            return false
          }
          // rewindFiles may not be available on all SDK versions
          if (typeof (queryInstance as any).rewindFiles === 'function') {
            await (queryInstance as any).rewindFiles(uuid)
            logger.debug('claude', `rewindFiles succeeded for uuid: ${uuid}`)
            return true
          }
          logger.warn('claude', 'rewindFiles not available on query instance')
          return false
        } catch (err) {
          logger.warn('claude', `rewindFiles error: ${err instanceof Error ? err.message : 'unknown'}`)
          return false
        }
      },
    }
  }

  // Cache for supported models (fetched once, reused)
  let cachedModels: ModelInfo[] | null = null

  async function getSupportedModels(): Promise<ModelInfo[]> {
    if (cachedModels) return cachedModels

    // Try to get dynamic model list from SDK
    try {
      prepareSdkProcessEnv()

      const tempQuery = query({
        prompt: '',
        options: {
          model: defaultModel,
          cwd: process.cwd(),
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          persistSession: false,
          ...(claudeCodePath ? { pathToClaudeCodeExecutable: claudeCodePath } : {}),
        },
      })

      const models = await tempQuery.supportedModels()
      tempQuery.close()

      cachedModels = models.map((m) => ({
        id: m.value,
        name: m.displayName,
      }))
      return cachedModels
    } catch (err) {
      logger.warn('claude', `Failed to get models from SDK: ${err instanceof Error ? err.message : 'unknown'}`)
      return [{ id: defaultModel, name: defaultModel }]
    }
  }

  return {
    runQuery,
    getSupportedModels,
  }
}
