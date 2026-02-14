export type ParsedCallback =
  | { type: 'question_answer'; interactionId: string; questionIndex: number; answerIndex: number }
  | { type: 'question_toggle'; interactionId: string; questionIndex: number; answerIndex: number }
  | { type: 'question_next'; interactionId: string; questionIndex: number }
  | { type: 'question_skip'; interactionId: string; questionIndex: number }
  | { type: 'question_type'; interactionId: string; questionIndex: number }
  | { type: 'question_back'; interactionId: string; questionIndex: number }
  | { type: 'question_confirm'; interactionId: string }
  | { type: 'question_reset'; interactionId: string }
  | { type: 'agent'; agentName: string }
  | { type: 'settings'; action: string; value?: string }
  | { type: 'selectmodel'; value: string }
  | { type: 'listpage'; page: number }
  | { type: 'listsel'; sessionId: string }
  | { type: 'history'; sessionId: string }
  | { type: 'settings_agent'; agentName: string }
  | { type: 'addbot_role'; role: 'writer' | 'reader' }
  | { type: 'addbot_project'; projectDir: string }
  | { type: 'addbot_agent'; agentId: string }
  | { type: 'addbot_start'; instanceName: string }
  | { type: 'addbot_remove'; instanceName: string }
  | { type: 'addbot_new' }
  | { type: 'makeagent_save' }
  | { type: 'makeagent_regen' }
  | { type: 'makeagent_edit' }
  | { type: 'makeagent_cancel' }
  | { type: 'settings_custom_agent'; agentId: string }
  | { type: 'settings_remove_agent' }
  | { type: 'debate_accept'; debateId: string }
  | { type: 'debate_reject'; debateId: string }
  | { type: 'groupsettings'; action: string; value?: string }
  | { type: 'tunnel'; action: 'stop' | 'custom' | 'start'; port?: number }
  | { type: 'git'; action: string }
  | { type: 'voice'; action: 'listen'; responseId: string }
  | { type: 'addhookbot_project'; projectDir: string; action: 'select' | 'deselect' }
  | { type: 'addhookbot_all' }
  | { type: 'addhookbot_done' }
  | { type: 'addhookbot_start'; action: 'start' | 'skip' }
  | { type: 'addhookbot_remove' }
  | { type: 'addhookbot_reconfigure' }
  | { type: 'restart'; action: string }
  | { type: 'unknown'; raw: string }

export function parseCallback(data: string): ParsedCallback {
  if (data.startsWith('agent:')) {
    const agentName = data.slice('agent:'.length)
    if (!agentName) {
      return { type: 'unknown', raw: data }
    }
    return { type: 'agent', agentName }
  }

  if (data.startsWith('sm:')) {
    const value = data.slice(3)
    if (!value) return { type: 'unknown', raw: data }
    return { type: 'selectmodel', value }
  }

  if (data.startsWith('selectmodel:')) {
    const value = data.slice('selectmodel:'.length)
    if (!value) return { type: 'unknown', raw: data }
    return { type: 'selectmodel', value }
  }

  if (data.startsWith('settings:')) {
    const parts = data.split(':')
    const action = parts[1]
    const value = parts.slice(2).join(':') || undefined
    if (!action) return { type: 'unknown', raw: data }
    return { type: 'settings', action, value }
  }

  if (data.startsWith('lp:')) {
    const page = parseInt(data.slice(3), 10)
    if (!Number.isFinite(page) || page < 1) return { type: 'unknown', raw: data }
    return { type: 'listpage', page }
  }

  if (data.startsWith('ls:')) {
    const sessionId = data.slice(3)
    if (!sessionId) return { type: 'unknown', raw: data }
    return { type: 'listsel', sessionId }
  }

  if (data.startsWith('hist:')) {
    const sessionId = data.slice(5)
    if (!sessionId) return { type: 'unknown', raw: data }
    return { type: 'history', sessionId }
  }

  // Question callbacks: q:{interactionId}:{action}
  // Formats:
  //   q:{id}:{qIdx}:{answerIdx}  — select option answer
  //   q:{id}:{qIdx}:skip         — skip question
  //   q:{id}:{qIdx}:type         — type custom answer
  //   q:{id}:{qIdx}:back         — go to previous question
  //   q:{id}:ok                  — confirm/submit all
  //   q:{id}:redo                — reset all answers
  if (data.startsWith('q:')) {
    const parts = data.split(':')
    const interactionId = parts[1]
    if (!interactionId) return { type: 'unknown', raw: data }

    if (parts[2] === 'ok' && parts.length === 3) {
      return { type: 'question_confirm', interactionId }
    }

    if (parts[2] === 'redo' && parts.length === 3) {
      return { type: 'question_reset', interactionId }
    }

    const questionIndex = parseInt(parts[2], 10)
    if (!Number.isFinite(questionIndex) || questionIndex < 0) {
      return { type: 'unknown', raw: data }
    }

    const action = parts[3]
    if (action === undefined) return { type: 'unknown', raw: data }

    if (action === 'skip') {
      return { type: 'question_skip', interactionId, questionIndex }
    }
    if (action === 'type') {
      return { type: 'question_type', interactionId, questionIndex }
    }
    if (action === 'back') {
      return { type: 'question_back', interactionId, questionIndex }
    }
    if (action === 'next') {
      return { type: 'question_next', interactionId, questionIndex }
    }
    if (action === 'toggle') {
      const answerIndex = parseInt(parts[4], 10)
      if (Number.isFinite(answerIndex) && answerIndex >= 0) {
        return { type: 'question_toggle', interactionId, questionIndex, answerIndex }
      }
      return { type: 'unknown', raw: data }
    }

    const answerIndex = parseInt(action, 10)
    if (Number.isFinite(answerIndex) && answerIndex >= 0) {
      return { type: 'question_answer', interactionId, questionIndex, answerIndex }
    }

    return { type: 'unknown', raw: data }
  }

  if (data.startsWith('sa:')) {
    const agentName = data.slice(3)
    if (!agentName) return { type: 'unknown', raw: data }
    return { type: 'settings_agent', agentName }
  }

  if (data.startsWith('addbot:')) {
    const role = data.slice('addbot:'.length)
    if (role === 'writer' || role === 'reader') {
      return { type: 'addbot_role', role }
    }
    return { type: 'unknown', raw: data }
  }

  if (data.startsWith('addbot_proj:')) {
    const projectDir = data.slice('addbot_proj:'.length)
    if (!projectDir) return { type: 'unknown', raw: data }
    return { type: 'addbot_project', projectDir }
  }

  if (data.startsWith('addbot_agent:')) {
    const agentId = data.slice('addbot_agent:'.length)
    if (!agentId) return { type: 'unknown', raw: data }
    return { type: 'addbot_agent', agentId }
  }

  if (data.startsWith('addbot_start:')) {
    const instanceName = data.slice('addbot_start:'.length)
    if (!instanceName) return { type: 'unknown', raw: data }
    return { type: 'addbot_start', instanceName }
  }

  if (data.startsWith('addbot_rm:')) {
    const instanceName = data.slice('addbot_rm:'.length)
    if (!instanceName) return { type: 'unknown', raw: data }
    return { type: 'addbot_remove', instanceName }
  }

  if (data === 'addbot_new') return { type: 'addbot_new' }

  if (data === 'ma:save') return { type: 'makeagent_save' }
  if (data === 'ma:regen') return { type: 'makeagent_regen' }
  if (data === 'ma:edit') return { type: 'makeagent_edit' }
  if (data === 'ma:cancel') return { type: 'makeagent_cancel' }

  if (data === 'sca:remove') return { type: 'settings_remove_agent' }
  if (data.startsWith('sca:')) {
    const agentId = data.slice(4)
    if (!agentId) return { type: 'unknown', raw: data }
    return { type: 'settings_custom_agent', agentId }
  }

  if (data.startsWith('gs:')) {
    const parts = data.split(':')
    const action = parts[1]
    const value = parts.slice(2).join(':') || undefined
    if (!action) return { type: 'unknown', raw: data }
    return { type: 'groupsettings', action, value }
  }

  if (data.startsWith('dba:')) {
    const debateId = data.slice(4)
    if (!debateId) return { type: 'unknown', raw: data }
    return { type: 'debate_accept', debateId }
  }

  if (data.startsWith('dbr:')) {
    const debateId = data.slice(4)
    if (!debateId) return { type: 'unknown', raw: data }
    return { type: 'debate_reject', debateId }
  }

  if (data.startsWith('tunnel:')) {
    const value = data.slice(7)
    if (value === 'stop') return { type: 'tunnel', action: 'stop' }
    if (value === 'custom') return { type: 'tunnel', action: 'custom' }
    const port = parseInt(value, 10)
    if (Number.isFinite(port) && port > 0 && port <= 65535) {
      return { type: 'tunnel', action: 'start', port }
    }
    return { type: 'unknown', raw: data }
  }

  if (data.startsWith('git:')) {
    const action = data.slice(4)
    if (!action) return { type: 'unknown', raw: data }
    return { type: 'git', action }
  }

  if (data.startsWith('voice:')) {
    const parts = data.split(':')
    if (parts[1] === 'listen' && parts[2]) {
      return { type: 'voice', action: 'listen', responseId: parts[2] }
    }
    return { type: 'unknown', raw: data }
  }

  if (data.startsWith('ahb_proj:')) {
    const rest = data.slice('ahb_proj:'.length)
    const sepIdx = rest.lastIndexOf(':')
    if (sepIdx > 0) {
      const projectDir = rest.slice(0, sepIdx)
      const action = rest.slice(sepIdx + 1)
      if ((action === 'select' || action === 'deselect') && projectDir) {
        return { type: 'addhookbot_project', projectDir, action }
      }
    }
    return { type: 'unknown', raw: data }
  }

  if (data === 'ahb:all') return { type: 'addhookbot_all' }
  if (data === 'ahb:done') return { type: 'addhookbot_done' }
  if (data === 'ahb:remove') return { type: 'addhookbot_remove' }
  if (data === 'ahb:reconfigure') return { type: 'addhookbot_reconfigure' }

  if (data.startsWith('ahb_start:')) {
    const action = data.slice('ahb_start:'.length)
    if (action === 'start' || action === 'skip') {
      return { type: 'addhookbot_start', action }
    }
    return { type: 'unknown', raw: data }
  }

  if (data.startsWith('restart:')) {
    const action = data.slice('restart:'.length)
    if (!action) return { type: 'unknown', raw: data }
    return { type: 'restart', action }
  }

  return { type: 'unknown', raw: data }
}
