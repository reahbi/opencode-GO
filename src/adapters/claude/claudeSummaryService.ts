import type { SummaryPort } from '../../domain/ports/SummaryPort.js'
import { logger } from '../../shared/logger.js'
import { LIMITS } from '../../app/policies/limits.js'

const SUMMARY_TIMEOUT_MS = 60_000
const MAX_INPUT_CHARS = 30_000
const SUMMARY_MODEL = 'claude-haiku-4-5'

function truncateInput(content: string): string {
  return content.length > MAX_INPUT_CHARS
    ? content.slice(0, MAX_INPUT_CHARS) + '\n\n[... truncated]'
    : content
}

function getExpertiseInstruction(expertise: 'vibe' | 'developer' | 'beginner'): string {
  switch (expertise) {
    case 'vibe':
      return `AUDIENCE: Non-technical user who builds apps using AI without coding knowledge (vibe coder).
- NEVER use technical jargon: no file names, no function names, no type names, no "JWT", no "middleware", no "port", no "adapter"
- Explain everything in terms of what the USER experiences: "login stays longer", "voice plays automatically", "settings page has new option"
- Use everyday analogies when helpful
- Focus on: what changed for the user, what works differently now, what they need to do next
- Tone: friendly assistant explaining to a non-technical friend`

    case 'beginner':
      return `AUDIENCE: Junior developer or coding student who is learning software development.
- Use technical terms but briefly explain unfamiliar ones on first mention
- For example: "포트라는 건 코드 모듈 사이의 연결 규약인데요" or "middleware, which processes requests in between"
- Balance between technical accuracy and accessibility
- Explain WHY things are done, not just WHAT - help them learn
- Focus on: what was done, what the concepts mean, what patterns to learn from
- Tone: patient senior developer mentoring a junior colleague`

    case 'developer':
    default:
      return `AUDIENCE: Professional software developer who understands code architecture and patterns.
- Use exact technical terms: file names, function names, type names, config values
- Include architecture reasoning and trade-offs when mentioned
- Mention test results, type safety, and build status
- Focus on: what was changed technically, why this approach was chosen, what needs attention
- Tone: concise peer engineer status update`
  }
}

function buildSummaryPrompt(content: string, expertise: 'vibe' | 'developer' | 'beginner'): string {
  return `You are a senior engineer checking work on your phone via Telegram.
Rewrite this AI response into a compact, mobile-friendly summary using Telegram HTML.

${getExpertiseInstruction(expertise)}
${expertise === 'vibe' ? '- In the Files section, describe changes in plain language instead of listing file paths\n' : ''}

Allowed HTML tags ONLY: <b>, <i>, <code>, <pre>, <a href="">, <s>, <u>, <blockquote>
Telegram has NO heading or list tags. Use these conventions:
- Headings: <b>Section Title</b> on its own line
- Bullets: start line with • or ▸ character
- File paths: wrap in <code>path/to/file</code>
- Code snippets: wrap in <code>inline</code> or <pre>block</pre>

Adaptive structure — include only sections that are relevant:

<b>Outcome</b>
• ALWAYS include. One line: ✅ OK | ⚠️ NEEDS INPUT | ❌ FAILED + short reason

<b>Key Points</b>
• ALWAYS include. 2-5 bullets of what was done and why

<b>Files</b>
• Include ONLY if files were modified. Top 10 files max, if more add "(+N more)"

<b>Commands</b>
• Include ONLY if there are commands to run or verify

<b>Errors</b>
• Include ONLY if errors or warnings occurred

<b>Questions</b>
• Include ONLY if the response asks the user something

Rules:
- Maximum ${LIMITS.SUMMARY_OUTPUT_TARGET} characters total
- Same language as the original response
- No filler phrases — every word must earn its place
- Avoid long URLs; prefer short link text, omit querystrings
- Do NOT use markdown syntax (no **, no \`\`\`, no #)
- Output ONLY the HTML summary, nothing else

---
${truncateInput(content)}`
}

function buildVoiceSummaryPrompt(
  content: string,
  maxLength: number,
  language: 'ko' | 'en',
  expertise: 'vibe' | 'developer' | 'beginner',
): string {
  const langName = language === 'ko' ? 'Korean' : 'English'
  const goodExample = language === 'ko'
    ? '"작업이 성공적으로 완료됐어요. 이번에 진행한 내용을 설명드릴게요. 먼저 인증 모듈을 전면 리팩토링했습니다. 기존에는 auth.ts 파일 하나에 모든 로직이 있었는데, 이걸 세 개의 파일로 분리했어요. authService.ts에는 로그인과 로그아웃 핵심 로직을, tokenManager.ts에는 JWT 토큰 생성과 검증 로직을, 그리고 authMiddleware.ts에는 Express 미들웨어를 넣었습니다. 이렇게 분리한 이유는 테스트하기 쉽게 만들고, 나중에 OAuth 같은 다른 인증 방식을 추가할 때 확장성을 확보하기 위해서예요. 토큰 만료 시간은 기존 1시간에서 24시간으로 늘렸고, 리프레시 토큰도 새로 구현했습니다. 테스트는 총 12개를 작성했는데 모두 통과했습니다. 다음으로 해주셔야 할 건 환경 변수에 JWT_SECRET 값을 설정하시는 거예요."'
    : '"The task completed successfully. First, I completely refactored the authentication module. Previously, all the logic was in a single auth.ts file, but I split it into three separate files. authService.ts now contains the core login and logout logic, tokenManager.ts handles JWT token generation and validation, and authMiddleware.ts has the Express middleware. The reason for this separation is to make testing easier and to ensure extensibility when adding other auth methods like OAuth later. I changed the token expiration from 1 hour to 24 hours and implemented refresh tokens as well. I wrote 12 tests total and they all pass. The next thing you need to do is set the JWT_SECRET environment variable."'

  return `Convert this AI coding assistant response into a spoken summary in ${langName}.
This text will be read aloud by text-to-speech. Write for listening, not reading.

OUTPUT LANGUAGE: ${langName} only. All output must be in ${langName}.

${getExpertiseInstruction(expertise)}

CRITICAL RULES:
- PLAIN TEXT ONLY — no HTML, no markdown, no formatting, no special symbols
- No code blocks, no file paths with slashes, no technical symbols
- Natural, conversational tone — write as spoken language
- No bullet points or lists — use flowing, connected sentences
- Spell out abbreviations (TypeScript not TS, JavaScript not JS)
- START IMMEDIATELY with the substance. ABSOLUTELY NO greetings, introductions, or filler at the start. No "Hello", no "Hi", no "So", no "여보세요", no "안녕하세요", no "네"
- LENGTH: approximately ${maxLength} characters. Prioritize COMPLETENESS — include all key points, decisions, and outcomes. Go up to ${maxLength * 2} if needed for completeness. Shorter is fine for simple content. Never pad with filler.

WHAT TO INCLUDE (cover ALL that apply):
- Result: success, failure, or needs input — and why
- Changes: which files were modified and how, specifically
- Logic: why this approach was chosen
- Details: function names, component names, config values
- Errors: any errors or warnings, in detail
- Next steps: what the user needs to do

Example of good output:
${goodExample}

---
${truncateInput(content)}`
}

async function runClaudeCliSummary(prompt: string, claudeCodePath?: string | null): Promise<string> {
  const executable = claudeCodePath || 'claude'
  const args = ['-p', prompt, '--model', SUMMARY_MODEL, '--output-format', 'text', '--max-turns', '1']

  const proc = Bun.spawn([executable, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  })

  const timeoutId = setTimeout(() => {
    proc.kill()
  }, SUMMARY_TIMEOUT_MS)

  try {
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    clearTimeout(timeoutId)

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`Claude CLI exited with code ${exitCode}: ${stderr.slice(0, 200)}`)
    }

    return output.trim()
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

export function createClaudeSummaryService(claudeCodePath?: string | null): SummaryPort {
  return {
    async summarize(_directory, content, _model, expertise) {
      const prompt = buildSummaryPrompt(content, expertise)
      try {
        let result = await runClaudeCliSummary(prompt, claudeCodePath)
        if (!result) throw new Error('Summary produced no output')
        if (result.length > LIMITS.SUMMARY_HTML_HARD_CAP) {
          result = result.slice(0, LIMITS.SUMMARY_HTML_HARD_CAP) + '\n\n<i>... (truncated)</i>'
        }
        logger.info('summary', `Summary generated: ${result.length} chars`)
        return result
      } catch (err) {
        logger.error('summary', `CLI summary failed: ${err instanceof Error ? err.message : 'unknown'}`)
        throw err
      }
    },

    async summarizeForVoice(_directory, content, _model, targetLength, language, hardCap, expertise) {
      const prompt = buildVoiceSummaryPrompt(content, targetLength, language, expertise)
      try {
        let result = await runClaudeCliSummary(prompt, claudeCodePath)
        if (!result) throw new Error('Voice summary produced no output')
        if (result.length > hardCap) {
          result = result.slice(0, hardCap) + '...'
        }
        logger.info('summary', `Voice summary generated: ${result.length} chars`)
        return result
      } catch (err) {
        logger.error('summary', `CLI voice summary failed: ${err instanceof Error ? err.message : 'unknown'}`)
        throw err
      }
    },
  }
}
