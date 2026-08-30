import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { WorkbenchSourceRefSchema, WorkspaceSnapshotSchema, sourceKey } from '../src/index.ts'

describe('workspace model', () => {
  test('sourceKey differentiates providers for the same locator', () => {
    const localSource = { providerId: 'local', locator: '/workspace', displayName: 'Local' }
    const remoteSource = { providerId: 'remote', locator: '/workspace', displayName: 'Remote' }

    expect(sourceKey(localSource)).not.toBe(sourceKey(remoteSource))
    expect(() => Schema.decodeUnknownSync(WorkbenchSourceRefSchema)(localSource)).not.toThrow()
  })

  test('decodes a workspace snapshot with one independently identified project', () => {
    const snapshot = {
      id: 'workspace-1',
      root: {
        providerId: 'local',
        locator: '/projects/example',
        displayName: 'Example workspace',
      },
      name: 'Example',
      configAnchor: null,
      state: 'open',
      projects: [
        {
          id: 'project-1',
          name: 'Example project',
          version: null,
          relativePath: '.',
          configAnchor: null,
          sourceDirectory: 'src',
          state: 'ready',
          modelSources: [
            { providerId: 'local', locator: '/projects/example', displayName: 'Local project' },
          ],
          knowledgeBaseSources: [],
          diagnostics: [],
        },
      ],
      modelSources: [],
      knowledgeBaseSources: [],
      diagnostics: [],
    }

    const decoded = Schema.decodeUnknownSync(WorkspaceSnapshotSchema)(snapshot)

    expect(decoded.projects).toHaveLength(1)
    expect(decoded.projects[0]?.id).toBe('project-1')
    expect(decoded.root).toEqual(snapshot.root)
  })

  test('rejects an unknown workspace lifecycle state', () => {
    const snapshot = {
      id: 'workspace-1',
      root: {
        providerId: 'local',
        locator: '/projects/example',
        displayName: 'Example workspace',
      },
      name: null,
      configAnchor: null,
      state: 'unknown',
      projects: [],
      modelSources: [],
      knowledgeBaseSources: [],
      diagnostics: [],
    }

    expect(() => Schema.decodeUnknownSync(WorkspaceSnapshotSchema)(snapshot)).toThrow()
  })
})
