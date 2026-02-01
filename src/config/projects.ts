import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ProjectRef } from '../domain/models.js'

const PROJECTS_PATH = resolve(process.cwd(), 'data/projects.json')

interface RawProject {
  id: string
  name: string
  path: string
}

export function loadProjects(): ProjectRef[] {
  if (!existsSync(PROJECTS_PATH)) {
    return []
  }

  try {
    const raw = readFileSync(PROJECTS_PATH, 'utf-8')
    const data = JSON.parse(raw) as { projects?: RawProject[] }
    const projects = data.projects ?? []

    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      directory: p.path,
    }))
  } catch {
    return []
  }
}

export function findProjectByDirectory(
  projects: ProjectRef[],
  directory: string,
): ProjectRef | undefined {
  return projects.find((p) => p.directory === directory)
}

export function findProjectByIndex(
  projects: ProjectRef[],
  index: number,
): ProjectRef | undefined {
  return projects[index - 1] // 1-based indexing for user-facing commands
}
