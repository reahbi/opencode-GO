import { InlineKeyboard } from 'grammy'
import type { Button } from '../../../domain/models.js'

export function buildButtonGrid(buttons: Button[], columns: number = 2): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  
  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i]
    keyboard.text(btn.label, btn.callbackData)
    
    if ((i + 1) % columns === 0 || i === buttons.length - 1) {
      keyboard.row()
    }
  }
  
  return keyboard
}

export function buildPermissionKeyboard(interactionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Allow Once', `perm:${interactionId}:once`)
    .text('Allow Always', `perm:${interactionId}:always`)
    .text('Deny', `perm:${interactionId}:reject`)
}


