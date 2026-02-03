import type { GroupSettings } from '../models.js'

export interface GroupSettingsPort {
  getGroupSettings(): Promise<GroupSettings>
  saveGroupSettings(settings: GroupSettings): Promise<void>
}
