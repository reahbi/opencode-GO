const MAX_EXTRACT_LENGTH = 3500
const FILE_PATH_PATTERN = /`([^\s`]*\/[^\s`]+\.[a-zA-Z]+)`/g
const HEADING_PATTERN = /^#{1,3}\s+(.+)$/

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function structuralExtract(markdown: string): string {
  const lines = markdown.split('\n')
  const headings: string[] = []
  const filePaths = new Set<string>()
  const bullets: string[] = []

  let insideCode = false

  for (const line of lines) {
    const trimmed = line.trimStart()

    if (trimmed.startsWith('```')) {
      insideCode = !insideCode
      continue
    }

    if (insideCode) continue

    const headingMatch = trimmed.match(HEADING_PATTERN)
    if (headingMatch) {
      headings.push(headingMatch[1])
      continue
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+\.\s/.test(trimmed)) {
      bullets.push(trimmed)
    }

    let pathMatch: RegExpExecArray | null
    FILE_PATH_PATTERN.lastIndex = 0
    while ((pathMatch = FILE_PATH_PATTERN.exec(line)) !== null) {
      filePaths.add(pathMatch[1])
    }
  }

  const parts: string[] = []

  if (headings.length > 0) {
    parts.push(headings.map((h) => `<b>${escapeHtml(h)}</b>`).join('\n'))
  }

  if (filePaths.size > 0) {
    const fileList = Array.from(filePaths)
      .slice(0, 20)
      .map((f) => `<code>${escapeHtml(f)}</code>`)
      .join(', ')
    parts.push(`Changed files: ${fileList}`)
  }

  if (bullets.length > 0) {
    parts.push(bullets.slice(0, 15).join('\n'))
  }

  const result = parts.join('\n\n')

  if (result.length > MAX_EXTRACT_LENGTH) {
    return result.slice(0, MAX_EXTRACT_LENGTH - 3) + '...'
  }

  return result || markdown.slice(0, MAX_EXTRACT_LENGTH)
}
