import type {
  PortableWorkspaceSnapshot,
  WorkspaceDiagnostic,
  WorkspaceSnapshot,
} from '../../src/index.ts'

const projectPathFor = (projectId: string, projectPaths: ReadonlyMap<string, string>): string => {
  const path = projectPaths.get(projectId)
  if (path === undefined) {
    throw new Error(`Workspace diagnostic references unknown project ${projectId}`)
  }
  return path
}

const normalizeDiagnostic = (
  diagnostic: WorkspaceDiagnostic,
  projectPaths: ReadonlyMap<string, string>,
) => ({
  severity: diagnostic.severity,
  code: diagnostic.code,
  message: diagnostic.message,
  path: diagnostic.path,
  projectPath:
    diagnostic.projectId === null ? null : projectPathFor(diagnostic.projectId, projectPaths),
})

export const normalizeWorkspaceSnapshot = (snapshot: WorkspaceSnapshot) => {
  const projectPaths = new Map(
    snapshot.projects.map((project) => [project.id, project.relativePath] as const),
  )
  return {
    protocolVersion: 1 as const,
    configAnchor: snapshot.configAnchor,
    name: snapshot.name,
    state: snapshot.state,
    projects: snapshot.projects.map((project) => ({
      name: project.name,
      version: project.version,
      relativePath: project.relativePath,
      configAnchor: project.configAnchor,
      sourceDirectory: project.sourceDirectory,
      state: project.state,
      diagnostics: project.diagnostics.map((diagnostic) =>
        normalizeDiagnostic(diagnostic, projectPaths),
      ),
    })),
    diagnostics: snapshot.diagnostics.map((diagnostic) =>
      normalizeDiagnostic(diagnostic, projectPaths),
    ),
  }
}

export const expectedCorpusSnapshot = (
  snapshot: PortableWorkspaceSnapshot,
  fallbackName: string,
) => ({
  protocolVersion: snapshot.protocolVersion,
  configAnchor: snapshot.configAnchor,
  name: snapshot.name ?? fallbackName,
  state: snapshot.state,
  projects: snapshot.projects.map((project) => ({
    name: project.name,
    version: project.version,
    relativePath: project.relativePath,
    configAnchor: project.configAnchor,
    sourceDirectory: project.sourceDirectory,
    state: project.state,
    diagnostics: project.diagnostics.map((diagnostic) => ({ ...diagnostic })),
  })),
  diagnostics: snapshot.diagnostics.map((diagnostic) => ({ ...diagnostic })),
})
