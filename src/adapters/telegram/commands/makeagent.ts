import type { Context } from 'grammy'
import type { OpenCodeEvent } from '../../../domain/events.js'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { ChatOutputPort } from '../../../domain/ports/ChatOutputPort.js'
import type { OpenCodePort } from '../../../domain/ports/OpenCodePort.js'
import type { CustomAgentPort } from '../../../domain/ports/CustomAgentPort.js'
import type { Button, CustomAgent } from '../../../domain/models.js'
import { logger } from '../../../shared/logger.js'

interface MakeAgentWizardState {
  userDescription: string
  generatedName: string
  generatedDescription: string
  generatedSystemPrompt: string
  editedSystemPrompt?: string
}

const MAKEAGENT_TIMEOUT_MS = 60_000
const MAKEAGENT_SESSION_TITLE = '_makeagent'
const wizards = new Map<number, MakeAgentWizardState>()

function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildMakerPrompt(userDescription: string): string {
  return `You are an elite AI Agent Architect. Your job is to transform a user's brief, possibly vague description into a best-practice system prompt for an AI coding assistant.

<process>
Follow these 6 steps internally (do NOT output the steps — only output the final JSON):

1. EXTRACT CORE INTENT: Identify the fundamental purpose, even from a 2-word input. Infer the domain, target audience, and implicit requirements.
2. DESIGN EXPERT PERSONA: Create a specific, credible expert identity with relevant background and expertise areas.
3. ARCHITECT COMPREHENSIVE INSTRUCTIONS: Build detailed behavioral rules using structured sections (see template below).
4. OPTIMIZE FOR PERFORMANCE: Ensure the prompt is specific enough to constrain bad behavior but flexible enough for varied inputs. Add edge-case handling.
5. CREATE IDENTIFIER: Generate a memorable kebab-case name and a one-line description.
6. VALIDATE: Confirm the prompt covers Role, Behavior, Constraints, and Output expectations.
</process>

<system_prompt_template>
The generated systemPrompt MUST follow this structure (adapt sections as needed):

## Role & Identity
Who the agent is. Specific expertise. Professional background.

## Core Behavior
- Primary task or workflow
- How it should approach problems
- Decision-making principles

## Communication Style
- Language (Korean/English/both/etc.)
- Tone (formal/casual/technical/friendly)
- Response format preferences

## Instructions
- Step-by-step behavioral rules
- What to prioritize
- How to handle ambiguity

## Constraints
- What the agent must NOT do
- Boundaries and limitations
- Quality thresholds

## Output Format
- Preferred response structure
- Code style requirements (if applicable)
- Length and detail expectations
</system_prompt_template>

<few_shot_example>
User input: "코드 리뷰어"
Generated systemPrompt:

"## Role & Identity
You are a senior code reviewer with 10+ years of experience in software engineering. You specialize in identifying bugs, security vulnerabilities, performance bottlenecks, and maintainability issues.

## Core Behavior
- Review code changes with a focus on correctness, readability, and adherence to best practices.
- Prioritize critical issues (bugs, security) over style nitpicks.
- Provide actionable suggestions with code examples when proposing fixes.
- Acknowledge good patterns and well-written code — don't only criticize.

## Communication Style
- Language: 한국어 (Korean) by default, switch to English for code-specific terms.
- Tone: Direct but constructive. Like a senior colleague, not a gatekeeper.
- Use inline code references when pointing out issues.

## Instructions
1. First scan for critical issues: bugs, security vulnerabilities, data races, null pointer risks.
2. Then check architectural concerns: separation of concerns, dependency direction, API design.
3. Then review code quality: naming, duplication, complexity, test coverage.
4. For each issue, state: (a) what's wrong, (b) why it matters, (c) how to fix it.
5. End with a summary: overall assessment and priority items.

## Constraints
- Never approve code with known security vulnerabilities without explicit warning.
- Don't rewrite entire functions unless asked — suggest targeted fixes.
- Don't bikeshed on formatting if the project has a configured formatter.
- Keep reviews focused; max 5-7 key points per review.

## Output Format
- Use numbered lists for issues, grouped by severity (🔴 Critical, 🟡 Warning, 🔵 Suggestion).
- Include code snippets in fenced blocks with language tags.
- End with a one-line verdict: ✅ Approve / ⚠️ Approve with comments / ❌ Request changes."
</few_shot_example>

<critical_rules>
- Even if the user provides just 1-2 words (like "번역기" or "devops helper"), you MUST expand it into a comprehensive, structured system prompt using the template above.
- The systemPrompt should be 800-3500 characters — detailed enough to be useful, not so long it wastes tokens.
- Infer the likely language preference from the user's input language (Korean input → Korean-first agent, English input → English-first agent).
- Never produce a generic "you are a helpful assistant" prompt. Be SPECIFIC to the described role.
- If the description mentions a specific technology/framework, include relevant best practices for that technology.
</critical_rules>

<output_schema>
Respond with ONLY a JSON object — no markdown, no explanation, no preamble:
{
  "name": "kebab-case-identifier (2-4 words, max 40 chars)",
  "description": "One-line summary of the agent's purpose (max 120 chars)",
  "systemPrompt": "The full structured system prompt following the template above"
}
</output_schema>

User's description: ${userDescription}`
}

function activeSystemPrompt(wizard: MakeAgentWizardState): string {
  return wizard.editedSystemPrompt ?? wizard.generatedSystemPrompt
}

function makeAgentPreviewText(wizard: MakeAgentWizardState): string {
  return [
    '<b>🎭 Custom Agent Draft</b>',
    '',
    `<b>Name:</b> <code>${escapeHtml(wizard.generatedName)}</code>`,
    `<b>Description:</b> ${escapeHtml(wizard.generatedDescription)}`,
    '',
    '<b>System Prompt</b>',
    `<pre>${escapeHtml(activeSystemPrompt(wizard))}</pre>`,
  ].join('\n')
}

function makeAgentPreviewButtons(): Button[] {
  return [
    { label: '✅ Save', callbackData: 'ma:save' },
    { label: '🔄 Regenerate', callbackData: 'ma:regen' },
    { label: '✏️ Edit', callbackData: 'ma:edit' },
    { label: '❌ Cancel', callbackData: 'ma:cancel' },
  ]
}

function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) return fenced[1].trim()

  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1)

  return trimmed
}

function normalizeDraft(raw: string, userDescription: string): { name: string; description: string; systemPrompt: string } {
  const jsonText = extractJsonCandidate(raw)
  const parsed = JSON.parse(jsonText) as Partial<Record<'name' | 'description' | 'systemPrompt', string>>

  const name = (parsed.name ?? '').trim() || 'custom-agent'
  const description = (parsed.description ?? '').trim() || userDescription.slice(0, 120)
  const systemPrompt = (parsed.systemPrompt ?? '').trim()
  if (!systemPrompt) {
    throw new Error('Generated system prompt is empty')
  }

  return {
    name: name.slice(0, 80),
    description: description.slice(0, 240),
    systemPrompt: systemPrompt.slice(0, 4000),
  }
}

function generateAgentId(): string {
  return `ca_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

async function runMakerSession(openCode: OpenCodePort, directory: string, userDescription: string): Promise<string> {
  const prompt = buildMakerPrompt(userDescription)
  const session = await openCode.createSession(directory, MAKEAGENT_SESSION_TITLE)
  const sessionId = session.id

  try {
    const abortController = new AbortController()
    const assistantMessageIds = new Set<string>()
    let responseText = ''

    const eventHandler = async (event: OpenCodeEvent) => {
      switch (event.type) {
        case 'message.updated': {
          if (event.data.sessionId !== sessionId) return
          if (event.data.role === 'assistant') {
            assistantMessageIds.add(event.data.messageId)
          }
          break
        }
        case 'message.part.updated': {
          if (event.data.sessionId !== sessionId) return
          if (event.data.messageId && !assistantMessageIds.has(event.data.messageId)) return
          responseText = event.data.content
          break
        }
        case 'session.idle': {
          if (event.data.sessionId !== sessionId) return
          abortController.abort()
          break
        }
        case 'session.error': {
          if (event.data.sessionId !== sessionId) return
          logger.warn('summary', `Agent maker session error: ${event.data.error || '(empty)'}`)
          abortController.abort()
          break
        }
        default:
          break
      }
    }

    const ssePromise = openCode
      .streamEvents(directory, eventHandler, abortController.signal)
      .catch((err) => {
        if (abortController.signal.aborted) return
        logger.error('summary', `Agent maker SSE error: ${err instanceof Error ? err.message : 'unknown'}`)
      })

    await openCode.sendPromptAsync(sessionId, directory, prompt)

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    await Promise.race([
      ssePromise,
      new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          if (!abortController.signal.aborted) {
            abortController.abort()
          }
          resolve()
        }, MAKEAGENT_TIMEOUT_MS)
      }),
    ])

    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle)
    }

    if (!abortController.signal.aborted) {
      abortController.abort()
    }

    if (!responseText.trim()) {
      throw new Error('Agent maker produced no output')
    }

    return responseText
  } finally {
    try {
      await openCode.deleteSession(sessionId, directory)
    } catch (err) {
      logger.warn('summary', `Failed to delete agent maker temp session ${sessionId}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }
}

async function generateAndShowDraft(
  chatId: number,
  userDescription: string,
  state: StateStore,
  output: ChatOutputPort,
  openCode: OpenCodePort,
): Promise<boolean> {
  const chatState = await state.getChatState(chatId)
  const directory = chatState.activeProjectDirectory

  if (!directory) {
    await output.sendText(chatId, '❌ No active project. Set DEFAULT_PROJECT first.')
    return false
  }

  const waitingHandle = await output.sendText(chatId, '🧪 Generating custom agent draft...')

  try {
    const raw = await runMakerSession(openCode, directory, userDescription)
    const draft = normalizeDraft(raw, userDescription)

    wizards.set(chatId, {
      userDescription,
      generatedName: draft.name,
      generatedDescription: draft.description,
      generatedSystemPrompt: draft.systemPrompt,
    })

    chatState.awaitingInput = null
    await state.saveChatState(chatId, chatState)

    await output.editText(chatId, waitingHandle, '✅ Draft generated.')
    await output.sendInteraction(chatId, makeAgentPreviewText(wizards.get(chatId)!), makeAgentPreviewButtons())
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    await output.editText(chatId, waitingHandle, `❌ Failed to generate draft: ${escapeHtml(message)}`, 'HTML')
    return false
  }
}

export function makeagentCommand(state: StateStore, output: ChatOutputPort) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    wizards.delete(chatId)

    const chatState = await state.getChatState(chatId)
    chatState.awaitingInput = 'makeagent_describe'
    await state.saveChatState(chatId, chatState)

    await output.sendText(
      chatId,
      'Describe the agent you want to create. What should it do? What language/tone should it use?',
    )
  }
}

export async function handleMakeagentDescribe(
  chatId: number,
  text: string,
  state: StateStore,
  output: ChatOutputPort,
  openCode: OpenCodePort,
  _customAgents: CustomAgentPort,
): Promise<boolean> {
  const userDescription = text.trim()
  if (!userDescription) {
    await output.sendText(chatId, 'Please describe the agent first.')
    return true
  }

  await generateAndShowDraft(chatId, userDescription, state, output, openCode)
  return true
}

export async function startMakeagentSave(chatId: number, state: StateStore, output: ChatOutputPort): Promise<void> {
  const wizard = wizards.get(chatId)
  if (!wizard) {
    await output.sendText(chatId, '❌ No custom-agent draft in progress. Use /makeagent first.')
    return
  }

  const chatState = await state.getChatState(chatId)
  chatState.awaitingInput = 'makeagent_name'
  await state.saveChatState(chatId, chatState)

  await output.sendText(
    chatId,
    `Send a custom name for this agent.\nType <code>skip</code> to use AI suggestion: <code>${escapeHtml(wizard.generatedName)}</code>`,
    'HTML',
  )
}

export async function regenerateMakeagentDraft(
  chatId: number,
  state: StateStore,
  output: ChatOutputPort,
  openCode: OpenCodePort,
): Promise<void> {
  const wizard = wizards.get(chatId)
  if (!wizard) {
    await output.sendText(chatId, '❌ No custom-agent draft in progress. Use /makeagent first.')
    return
  }

  await generateAndShowDraft(chatId, wizard.userDescription, state, output, openCode)
}

export async function startMakeagentEdit(chatId: number, state: StateStore, output: ChatOutputPort): Promise<void> {
  const wizard = wizards.get(chatId)
  if (!wizard) {
    await output.sendText(chatId, '❌ No custom-agent draft in progress. Use /makeagent first.')
    return
  }

  const chatState = await state.getChatState(chatId)
  chatState.awaitingInput = 'makeagent_edit'
  await state.saveChatState(chatId, chatState)

  await output.sendText(
    chatId,
    [
      'Send the edited system prompt text.',
      '',
      'Current prompt:',
      `<pre>${escapeHtml(activeSystemPrompt(wizard))}</pre>`,
    ].join('\n'),
    'HTML',
  )
}

export async function handleMakeagentName(
  chatId: number,
  text: string,
  state: StateStore,
  output: ChatOutputPort,
  customAgents: CustomAgentPort,
): Promise<boolean> {
  const wizard = wizards.get(chatId)
  if (!wizard) {
    await output.sendText(chatId, '❌ No custom-agent draft in progress. Use /makeagent first.')
    return true
  }

  const input = text.trim()
  if (!input) {
    await output.sendText(chatId, 'Please send a name or type <code>skip</code>.', 'HTML')
    return true
  }

  const finalName = input.toLowerCase() === 'skip' ? wizard.generatedName : input
  const now = Date.now()
  const agent: CustomAgent = {
    id: generateAgentId(),
    name: finalName,
    description: wizard.generatedDescription,
    systemPrompt: activeSystemPrompt(wizard),
    createdAt: now,
    updatedAt: now,
  }

  await customAgents.save(agent)

  const chatState = await state.getChatState(chatId)
  chatState.awaitingInput = null
  await state.saveChatState(chatId, chatState)
  wizards.delete(chatId)

  await output.sendText(chatId, `✅ Custom agent saved: <b>${escapeHtml(agent.name)}</b>`, 'HTML')
  return true
}

export async function handleMakeagentEdit(
  chatId: number,
  text: string,
  state: StateStore,
  output: ChatOutputPort,
  _customAgents: CustomAgentPort,
): Promise<boolean> {
  const wizard = wizards.get(chatId)
  if (!wizard) {
    await output.sendText(chatId, '❌ No custom-agent draft in progress. Use /makeagent first.')
    return true
  }

  const edited = text.trim()
  if (!edited) {
    await output.sendText(chatId, 'Edited system prompt cannot be empty.')
    return true
  }

  wizard.editedSystemPrompt = edited.slice(0, 4000)
  wizards.set(chatId, wizard)

  const chatState = await state.getChatState(chatId)
  chatState.awaitingInput = null
  await state.saveChatState(chatId, chatState)

  await output.sendInteraction(chatId, makeAgentPreviewText(wizard), makeAgentPreviewButtons())
  return true
}

export function cancelMakeagentWizard(chatId: number): void {
  wizards.delete(chatId)
}

export async function clearMakeagentIfActive(chatId: number, state: StateStore): Promise<boolean> {
  const chatState = await state.getChatState(chatId)
  if (
    chatState.awaitingInput === 'makeagent_describe'
    || chatState.awaitingInput === 'makeagent_name'
    || chatState.awaitingInput === 'makeagent_edit'
  ) {
    chatState.awaitingInput = null
    await state.saveChatState(chatId, chatState)
    wizards.delete(chatId)
    return true
  }
  return false
}
