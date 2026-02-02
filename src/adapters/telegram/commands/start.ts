import type { Context } from 'grammy'
import type { StateStore } from '../../../domain/ports/StateStore.js'
import type { OpenCodePort } from '../../../domain/ports/OpenCodePort.js'

export function startCommand(state: StateStore, openCode: OpenCodePort, instanceName?: string) {
  return async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const chatState = await state.getChatState(chatId)
    let serverStatus: string
    try {
      const healthy = await openCode.healthCheck()
      serverStatus = healthy ? 'Online' : 'Offline'
    } catch {
      serverStatus = 'Offline'
    }

    const header = instanceName
      ? `<b>OpenCaddy</b> — ${instanceName}`
      : `<b>OpenCaddy</b>`

    const statusIcon = serverStatus === 'Online' ? '🟢' : '🔴'
    const sessionInfo = chatState.activeSessionId
      ? `활성 세션 있음 — 메시지를 보내 대화를 계속하세요`
      : `활성 세션 없음 — /new 로 새 세션을 시작하세요`

    const project = chatState.activeProjectDirectory ?? '설정 안됨'

    const lines = [
      header,
      '',
      `텔레그램에서 AI 코딩 어시스턴트를 원격으로 조작합니다.`,
      '',
      `<b>상태</b>`,
      `  OpenCode 서버: ${statusIcon} ${serverStatus}`,
      `  프로젝트: <code>${project}</code>`,
      `  세션: ${sessionInfo}`,
      '',
      `<b>시작하기</b>`,
      `/new — 새 세션을 만들어 AI와 대화를 시작하세요`,
      `/help — 전체 명령어 보기`,
      '',
      `문제가 있나요? 터미널에서 <code>bun run doctor</code> 를 실행해보세요.`,
    ]

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
  }
}
