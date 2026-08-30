import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  channelForVersion,
  prepareDesktopRelease,
  type DesktopReleaseSources,
} from '../scripts/release-contract.ts'

const temporaryDirectories: string[] = []

const temporaryDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'morphir-desktop-release-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
  temporaryDirectories.length = 0
})

const sourceArtifacts = (root: string): DesktopReleaseSources => {
  const sources = {
    windowsX86_64: join(root, 'desktop-windows.zip'),
    macosAarch64: join(root, 'desktop-macos.zip'),
    linuxX86_64: join(root, 'desktop-linux.tar.gz'),
  }
  writeFileSync(sources.windowsX86_64, 'signed windows desktop')
  writeFileSync(sources.macosAarch64, 'signed macos desktop')
  writeFileSync(sources.linuxX86_64, 'linux desktop')
  return sources
}

describe('Desktop release contract', () => {
  test('keeps developer channels unsigned and opts into notarization only for releases', async () => {
    const desktopRoot = join(import.meta.dir, '..')
    const repositoryRoot = join(desktopRoot, '..', '..')
    const packageJson = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))
    const builder = Bun.YAML.parse(
      readFileSync(join(desktopRoot, 'electron-builder.yml'), 'utf8'),
    ) as { mac: { notarize: boolean } }
    const releaseWorkflow = readFileSync(
      join(repositoryRoot, '.github', 'workflows', 'release-desktop.yml'),
      'utf8',
    )
    const ciWorkflow = readFileSync(join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8')

    expect(packageJson.scripts.package).toBe('bun run package:developer')
    expect(packageJson.scripts['package:developer']).toContain('--config.mac.notarize=false')
    expect(packageJson.scripts['package:developer']).toContain(
      '--config.extraMetadata.morphirBuildChannel=developer',
    )
    expect(packageJson.scripts['package:developer-insider']).toContain(
      '--config.mac.notarize=false',
    )
    expect(packageJson.scripts['package:developer-insider']).toContain(
      '--config.extraMetadata.morphirBuildChannel=developer-insider',
    )
    expect(builder.mac.notarize).toBeFalse()
    expect(ciWorkflow).toContain('bun run package:developer-insider')
    expect(releaseWorkflow).toContain('--config.mac.notarize=true')
    expect(releaseWorkflow).toContain(
      'tar -tzf "$archive" > "$RUNNER_TEMP/linux-archive-entries.txt"',
    )
    expect(releaseWorkflow).not.toContain('tar -tzf "$archive" | grep')
  })

  test('derives stable and preview channels from semantic versions', () => {
    expect(channelForVersion('1.2.3')).toEqual(['stable'])
    expect(channelForVersion('1.2.3+signed-build')).toEqual(['stable'])
    expect(channelForVersion('1.3.0-preview.4')).toEqual(['preview'])
    expect(() => channelForVersion('release-1')).toThrow('semantic version')
  })

  test('stages portable targets and deterministic authenticated target metadata', async () => {
    const root = temporaryDirectory()
    const output = join(root, 'repository')

    const release = await prepareDesktopRelease({
      version: '1.2.3',
      morphirCli: '>=0.4.0-alpha.5, <0.5.0',
      sources: sourceArtifacts(root),
      output,
    })

    expect(release.descriptor).toEqual({
      schemaVersion: 1,
      kind: 'morphir-tool-release',
      tool: { id: 'desktop', name: 'Morphir Desktop' },
      version: '1.2.3',
      channels: ['stable'],
      status: 'active',
      compatibility: { morphirCli: '>=0.4.0-alpha.5, <0.5.0' },
      artifacts: [
        {
          targetPath: 'artifacts/desktop/1.2.3/linux-x86_64.tar.gz',
          platform: { os: 'linux', arch: 'x86_64' },
          archive: { format: 'tar-gzip', entryPoint: 'morphir-desktop' },
          launch: { kind: 'executable', path: 'morphir-desktop', args: [] },
        },
        {
          targetPath: 'artifacts/desktop/1.2.3/macos-aarch64.zip',
          platform: { os: 'macos', arch: 'aarch64' },
          archive: {
            format: 'zip',
            entryPoint: 'Morphir Desktop.app/Contents/MacOS/morphir-desktop',
          },
          launch: {
            kind: 'executable',
            path: 'Morphir Desktop.app/Contents/MacOS/morphir-desktop',
            args: [],
          },
        },
        {
          targetPath: 'artifacts/desktop/1.2.3/windows-x86_64.zip',
          platform: { os: 'windows', arch: 'x86_64' },
          archive: { format: 'zip', entryPoint: 'morphir-desktop.exe' },
          launch: { kind: 'executable', path: 'morphir-desktop.exe', args: [] },
        },
      ],
    })
    expect(existsSync(join(output, 'artifacts/desktop/1.2.3/windows-x86_64.zip'))).toBeTrue()
    expect(JSON.parse(readFileSync(join(output, 'releases/desktop/1.2.3.json'), 'utf8'))).toEqual(
      release.descriptor,
    )
    expect(Object.keys(release.manifest.targets)).toEqual([
      'artifacts/desktop/1.2.3/linux-x86_64.tar.gz',
      'artifacts/desktop/1.2.3/macos-aarch64.zip',
      'artifacts/desktop/1.2.3/windows-x86_64.zip',
      'releases/desktop/1.2.3.json',
    ])
    expect(release.manifest.targets['artifacts/desktop/1.2.3/windows-x86_64.zip']).toMatchObject({
      length: 22,
      hashes: {
        sha256: '6f14a539c7a5cdd9d0b34169ec65f56f34819861f6d7433e30ca6fdbfe19f19b',
      },
      custom: {
        morphir: {
          schemaVersion: 1,
          kind: 'tool-artifact',
          toolId: 'desktop',
          version: '1.2.3',
          platform: { os: 'windows', arch: 'x86_64' },
        },
      },
    })
  })

  test('refuses to publish when a required portable artifact is missing', async () => {
    const root = temporaryDirectory()
    const sources = sourceArtifacts(root)
    rmSync(sources.macosAarch64)

    await expect(
      prepareDesktopRelease({
        version: '1.2.3',
        morphirCli: '>=0.4.0-alpha.5, <0.5.0',
        sources,
        output: join(root, 'repository'),
      }),
    ).rejects.toThrow('macos-aarch64')
  })
})
