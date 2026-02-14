export interface HookBotConfig {
  botToken: string
  chatId: number
  projects: { directory: string; name: string }[]
  serverUrl: string
  serverUsername: string
  serverPassword: string
  mode: 'all' | 'selected'
}

export interface TrackedSession {
  sessionId: string
  directory: string
  projectName: string
  busySince: number
  lastActivityTime: number
  sessionTitle?: string
  /** true = saw real session.busy event; false = seeded at startup or auto-registered */
  observed?: boolean
}

export type HookNotification =
  | {
      type: 'completion'
      sessionId: string
      directory: string
      projectName: string
      sessionTitle?: string
      duration: number | null
      lastMessage?: string
    }
  | {
      type: 'stall'
      sessionId: string
      directory: string
      projectName: string
      inactiveDuration: number
    }
  | {
      type: 'error'
      sessionId: string
      directory: string
      projectName: string
      error: string
    }
  | {
      type: 'question'
      sessionId: string
      directory: string
      projectName: string
      requestId: string
      questions: Array<{ text: string; options?: string[]; multiple?: boolean }>
    }
  | {
      type: 'turn'
      sessionId: string
      directory: string
      projectName: string
      userPrompt: string
      assistantResponse: string
      costUsd?: number
    }
