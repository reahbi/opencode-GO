import type { HookNotification } from '../hookBotTypes.js'

export interface HookNotificationPort {
  notify(notification: HookNotification): Promise<void>
}
