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
}

export type HookNotification =
  | {
      type: 'completion'
      sessionId: string
      directory: string
      projectName: string
      sessionTitle?: string
      duration: number
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
      type: 'permission'
      sessionId: string
      directory: string
      projectName: string
      requestId: string
      permission: string
      patterns: string[]
      title: string
    }
  | {
      type: 'question'
      sessionId: string
      directory: string
      projectName: string
      requestId: string
      questions: Array<{ text: string; options?: string[]; multiple?: boolean }>
    }
