import { access, mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const GENERATED_FILES = [
  'morphir_workspace_wasm.d.ts',
  'morphir_workspace_wasm.js',
  'morphir_workspace_wasm_bg.wasm',
  'morphir_workspace_wasm_bg.wasm.d.ts',
  'provenance.json',
  'workspace-discovery-corpus.json',
] as const

export interface Provenance {
  readonly crateVersion: string
  readonly protocolVersion: 1
  readonly rustSourceCommit: string
  readonly wasmSha256: string
}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

const run = async (command: ReadonlyArray<string>, cwd: string): Promise<string> => {
  const child = Bun.spawn([...command], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).arrayBuffer(),
    child.exited,
  ])
  const output = decode(new Uint8Array(stdout))
  const errorOutput = decode(new Uint8Array(stderr))

  if (exitCode !== 0) {
    throw new Error(
      `${command[0]} failed with exit code ${exitCode}${errorOutput ? `:\n${errorOutput}` : ''}`,
    )
  }

  if (errorOutput) process.stderr.write(errorOutput)
  return output
}

const sourceStatus = (source: string): Promise<string> =>
  run(
    [
      'git',
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      '.',
      ':(exclude)target',
      ':(exclude)target/**',
      ':(exclude).beads/backup',
      ':(exclude).beads/backup/**',
      ':(exclude).beads/embeddeddolt',
      ':(exclude).beads/embeddeddolt/**',
    ],
    source,
  )

const assertCleanSource = async (source: string): Promise<void> => {
  const dirty = (await sourceStatus(source)).trim()
  if (dirty) throw new Error(`Refusing to vendor from a dirty Rust source tree:\n${dirty}`)
}

const parseSource = (args: ReadonlyArray<string>): string => {
  if (args.length !== 2 || args[0] !== '--source' || !args[1]) {
    throw new Error('Usage: bun tools/vendor-workspace-wasm.ts --source <morphir-rust-worktree>')
  }
  return args[1]
}

const sha256 = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher('sha256').update(bytes).digest('hex')

const artifact = (artifacts: ReadonlyMap<string, Uint8Array>, name: string): Uint8Array => {
  const bytes = artifacts.get(name)
  if (!bytes) throw new Error(`Generated workspace WASM package is missing ${name}`)
  return bytes
}

export const readGeneratedPackage = async (
  sourcePackage: string,
): Promise<ReadonlyMap<string, Uint8Array>> => {
  const entries = await Promise.all(
    GENERATED_FILES.map(
      async (file) =>
        [file, Uint8Array.from(await Bun.file(join(sourcePackage, file)).bytes())] as const,
    ),
  )
  return new Map(entries)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const validateProvenance = (
  value: unknown,
  sourceCommit: string,
  actualSha256: string,
): Provenance => {
  if (!isRecord(value) || Object.keys(value).length !== 4) {
    throw new Error('Invalid provenance object')
  }
  if (
    typeof value.crateVersion !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value.crateVersion)
  ) {
    throw new Error('Invalid provenance crateVersion')
  }
  if (value.protocolVersion !== 1) {
    throw new Error('Invalid provenance protocolVersion: expected 1')
  }
  if (
    typeof value.rustSourceCommit !== 'string' ||
    !/^[0-9a-f]{40}$/.test(value.rustSourceCommit)
  ) {
    throw new Error('Invalid provenance rustSourceCommit')
  }
  if (typeof value.wasmSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.wasmSha256)) {
    throw new Error('Invalid provenance wasmSha256')
  }
  if (value.rustSourceCommit !== sourceCommit) {
    throw new Error(
      `WASM provenance commit ${value.rustSourceCommit} does not match Rust HEAD ${sourceCommit}`,
    )
  }
  if (value.wasmSha256 !== actualSha256) {
    throw new Error(
      `WASM provenance SHA-256 ${value.wasmSha256} does not match binary SHA-256 ${actualSha256}`,
    )
  }

  return {
    crateVersion: value.crateVersion,
    protocolVersion: value.protocolVersion,
    rustSourceCommit: value.rustSourceCommit,
    wasmSha256: value.wasmSha256,
  }
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export const replaceGenerated = async (
  packageDirectory: string,
  generatedDirectory: string,
  artifacts: ReadonlyMap<string, Uint8Array>,
): Promise<void> => {
  for (const file of GENERATED_FILES) artifact(artifacts, file)
  await mkdir(packageDirectory, { recursive: true })
  const stagingDirectory = await mkdtemp(join(packageDirectory, '.generated-staging-'))
  const backupDirectory = await mkdtemp(join(packageDirectory, '.generated-backup-'))
  await rm(backupDirectory, { recursive: true })

  let backedUp = false
  let installed = false
  try {
    for (const file of GENERATED_FILES) {
      await Bun.write(join(stagingDirectory, file), artifact(artifacts, file))
    }

    if (await exists(generatedDirectory)) {
      await rename(generatedDirectory, backupDirectory)
      backedUp = true
    }
    await rename(stagingDirectory, generatedDirectory)
    installed = true
    if (backedUp) {
      await rm(backupDirectory, { recursive: true })
      backedUp = false
    }
  } catch (error) {
    if (installed && backedUp) {
      await rm(generatedDirectory, { recursive: true })
    }
    if (backedUp && !(await exists(generatedDirectory))) {
      await rename(backupDirectory, generatedDirectory)
      backedUp = false
    }
    throw error
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true })
    if (!backedUp) await rm(backupDirectory, { recursive: true, force: true })
  }
}

export const main = async (): Promise<void> => {
  const source = await realpath(parseSource(Bun.argv.slice(2)))
  const repositoryRoot = dirname(fileURLToPath(import.meta.url))
  const packageDirectory = join(repositoryRoot, '..', 'packages', 'morphir-workspace-engine')
  const generatedDirectory = join(packageDirectory, 'generated')
  const sourcePackage = join(source, 'target', 'workspace-wasm-package')

  await assertCleanSource(source)
  await run(['mise', 'run', 'build:workspace-wasm'], source)
  await assertCleanSource(source)

  const [head, artifacts] = await Promise.all([
    run(['git', 'rev-parse', 'HEAD'], source),
    readGeneratedPackage(sourcePackage),
  ])
  const sourceCommit = head.trim()
  const wasmBytes = artifact(artifacts, 'morphir_workspace_wasm_bg.wasm')
  const actualSha256 = sha256(wasmBytes)
  const provenance = JSON.parse(decode(artifact(artifacts, 'provenance.json'))) as unknown
  validateProvenance(provenance, sourceCommit, actualSha256)

  await replaceGenerated(packageDirectory, generatedDirectory, artifacts)
  console.log(`Vendored workspace discovery WASM from Rust commit ${sourceCommit}`)
}

if (import.meta.main) await main()
