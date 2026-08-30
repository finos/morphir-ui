import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

type ReleaseChannel = 'stable' | 'preview'
type OperatingSystem = 'linux' | 'macos' | 'windows'
type Architecture = 'aarch64' | 'x86_64'
type ArchiveFormat = 'tar-gzip' | 'zip'

interface Platform {
  os: OperatingSystem
  arch: Architecture
}

interface ReleaseArtifact {
  targetPath: string
  platform: Platform
  archive: {
    format: ArchiveFormat
    entryPoint: string
  }
  launch: {
    kind: 'executable'
    path: string
    args: string[]
  }
}

interface DesktopReleaseDescriptor {
  schemaVersion: 1
  kind: 'morphir-tool-release'
  tool: { id: 'desktop'; name: 'Morphir Desktop' }
  version: string
  channels: ReleaseChannel[]
  status: 'active'
  compatibility: { morphirCli: string }
  artifacts: ReleaseArtifact[]
}

interface TargetDescription {
  length: number
  hashes: { sha256: string }
  custom: {
    morphir:
      | {
          schemaVersion: 1
          kind: 'tool-artifact'
          toolId: 'desktop'
          version: string
          platform: Platform
        }
      | {
          schemaVersion: 1
          kind: 'tool-release'
          toolId: 'desktop'
          version: string
          channels: ReleaseChannel[]
          status: 'active'
          compatibility: { morphirCli: string }
          platforms: Platform[]
        }
  }
}

interface DesktopReleaseManifest {
  schemaVersion: 1
  targets: Record<string, TargetDescription>
}

export interface DesktopReleaseSources {
  windowsX86_64: string
  macosAarch64: string
  linuxX86_64: string
}

export interface PrepareDesktopReleaseOptions {
  version: string
  morphirCli: string
  sources: DesktopReleaseSources
  output: string
}

interface PreparedDesktopRelease {
  descriptor: DesktopReleaseDescriptor
  manifest: DesktopReleaseManifest
}

interface ArtifactContract {
  key: keyof DesktopReleaseSources
  label: string
  platform: Platform
  format: ArchiveFormat
  entryPoint: string
  targetName: string
}

const semanticVersion =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

const artifactContracts: ArtifactContract[] = [
  {
    key: 'linuxX86_64',
    label: 'linux-x86_64',
    platform: { os: 'linux', arch: 'x86_64' },
    format: 'tar-gzip',
    entryPoint: 'morphir-desktop',
    targetName: 'linux-x86_64.tar.gz',
  },
  {
    key: 'macosAarch64',
    label: 'macos-aarch64',
    platform: { os: 'macos', arch: 'aarch64' },
    format: 'zip',
    entryPoint: 'Morphir Desktop.app/Contents/MacOS/morphir-desktop',
    targetName: 'macos-aarch64.zip',
  },
  {
    key: 'windowsX86_64',
    label: 'windows-x86_64',
    platform: { os: 'windows', arch: 'x86_64' },
    format: 'zip',
    entryPoint: 'morphir-desktop.exe',
    targetName: 'windows-x86_64.zip',
  },
]

export const channelForVersion = (version: string): ReleaseChannel[] => {
  if (!semanticVersion.test(version)) {
    throw new Error(`Desktop release version ${JSON.stringify(version)} is not a semantic version`)
  }
  return version.split('+', 1)[0]?.includes('-') ? ['preview'] : ['stable']
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`
}

const describeTarget = (
  bytes: Uint8Array,
  custom: TargetDescription['custom']['morphir'],
): TargetDescription => ({
  length: bytes.byteLength,
  hashes: { sha256: sha256(bytes) },
  custom: { morphir: custom },
})

const validateSources = async (sources: DesktopReleaseSources) => {
  for (const contract of artifactContracts) {
    const source = sources[contract.key]
    let metadata
    try {
      metadata = await stat(source)
    } catch (error) {
      throw new Error(`Required ${contract.label} portable artifact is missing at ${source}`, {
        cause: error,
      })
    }
    if (!metadata.isFile()) {
      throw new Error(`Required ${contract.label} portable artifact is not a file: ${source}`)
    }
  }
}

export const prepareDesktopRelease = async (
  options: PrepareDesktopReleaseOptions,
): Promise<PreparedDesktopRelease> => {
  const channels = channelForVersion(options.version)
  if (options.morphirCli.trim().length === 0) {
    throw new Error('Morphir CLI compatibility requirement cannot be empty')
  }
  await validateSources(options.sources)

  const artifacts = artifactContracts.map<ReleaseArtifact>((contract) => {
    const targetPath = `artifacts/desktop/${options.version}/${contract.targetName}`
    return {
      targetPath,
      platform: contract.platform,
      archive: { format: contract.format, entryPoint: contract.entryPoint },
      launch: { kind: 'executable', path: contract.entryPoint, args: [] },
    }
  })
  const descriptor: DesktopReleaseDescriptor = {
    schemaVersion: 1,
    kind: 'morphir-tool-release',
    tool: { id: 'desktop', name: 'Morphir Desktop' },
    version: options.version,
    channels,
    status: 'active',
    compatibility: { morphirCli: options.morphirCli },
    artifacts,
  }

  const targets: Record<string, TargetDescription> = {}
  for (const [index, contract] of artifactContracts.entries()) {
    const artifact = artifacts[index]
    if (!artifact) throw new Error(`Missing release artifact contract for ${contract.label}`)
    const source = options.sources[contract.key]
    const bytes = await readFile(source)
    const destination = join(options.output, ...artifact.targetPath.split('/'))
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
    targets[artifact.targetPath] = describeTarget(bytes, {
      schemaVersion: 1,
      kind: 'tool-artifact',
      toolId: 'desktop',
      version: options.version,
      platform: contract.platform,
    })
  }

  const descriptorPath = `releases/desktop/${options.version}.json`
  const descriptorBytes = new TextEncoder().encode(canonicalJson(descriptor))
  const descriptorDestination = join(options.output, ...descriptorPath.split('/'))
  await mkdir(dirname(descriptorDestination), { recursive: true })
  await writeFile(descriptorDestination, descriptorBytes)
  targets[descriptorPath] = describeTarget(descriptorBytes, {
    schemaVersion: 1,
    kind: 'tool-release',
    toolId: 'desktop',
    version: options.version,
    channels,
    status: 'active',
    compatibility: { morphirCli: options.morphirCli },
    platforms: artifacts.map((artifact) => artifact.platform),
  })

  const manifest: DesktopReleaseManifest = { schemaVersion: 1, targets }
  await writeFile(join(options.output, 'release-targets.json'), `${canonicalJson(manifest)}\n`)
  return { descriptor, manifest }
}

const requiredArgument = (argumentsByName: Map<string, string>, name: string): string => {
  const value = argumentsByName.get(name)
  if (!value) throw new Error(`Missing required argument --${name}`)
  return value
}

const parseArguments = (args: string[]): Map<string, string> => {
  const parsed = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error(`Expected --name value arguments, got ${JSON.stringify(args.slice(index))}`)
    }
    parsed.set(flag.slice(2), value)
  }
  return parsed
}

if (import.meta.main) {
  const argumentsByName = parseArguments(process.argv.slice(2))
  await prepareDesktopRelease({
    version: requiredArgument(argumentsByName, 'version'),
    morphirCli: requiredArgument(argumentsByName, 'morphir-cli'),
    output: requiredArgument(argumentsByName, 'output'),
    sources: {
      windowsX86_64: requiredArgument(argumentsByName, 'windows-x86-64'),
      macosAarch64: requiredArgument(argumentsByName, 'macos-aarch64'),
      linuxX86_64: requiredArgument(argumentsByName, 'linux-x86-64'),
    },
  })
}
