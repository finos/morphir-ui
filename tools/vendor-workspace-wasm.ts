import { access, mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const GENERATED_FILES = [
  'morphir_workspace_wasm.d.ts',
  'morphir_workspace_wasm.js',
  'morphir_workspace_wasm_bg.wasm',
  'morphir_workspace_wasm_bg.wasm.d.ts',
  'provenance.json',
  'workspace-discovery-corpus.json',
] as const

interface Provenance {
  readonly crateVersion: string
  readonly protocolVersion: number
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

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const replaceGenerated = async (
  packageDirectory: string,
  generatedDirectory: string,
  sourcePackage: string,
): Promise<void> => {
  await mkdir(packageDirectory, { recursive: true })
  const stagingDirectory = await mkdtemp(join(packageDirectory, '.generated-staging-'))
  const backupDirectory = await mkdtemp(join(packageDirectory, '.generated-backup-'))
  await rm(backupDirectory, { recursive: true })

  let backedUp = false
  let installed = false
  try {
    for (const file of GENERATED_FILES) {
      await Bun.write(join(stagingDirectory, file), Bun.file(join(sourcePackage, file)))
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

const main = async (): Promise<void> => {
  const source = await realpath(parseSource(Bun.argv.slice(2)))
  const repositoryRoot = dirname(fileURLToPath(import.meta.url))
  const packageDirectory = join(repositoryRoot, '..', 'packages', 'morphir-workspace-engine')
  const generatedDirectory = join(packageDirectory, 'generated')
  const sourcePackage = join(source, 'target', 'workspace-wasm-package')

  await assertCleanSource(source)
  await run(['mise', 'run', 'build:workspace-wasm'], source)
  await assertCleanSource(source)

  const [head, provenanceText, wasmBytes] = await Promise.all([
    run(['git', 'rev-parse', 'HEAD'], source),
    Bun.file(join(sourcePackage, 'provenance.json')).text(),
    Bun.file(join(sourcePackage, 'morphir_workspace_wasm_bg.wasm')).bytes(),
  ])
  const provenance = JSON.parse(provenanceText) as Provenance
  const sourceCommit = head.trim()
  const actualSha256 = sha256(wasmBytes)

  if (provenance.rustSourceCommit !== sourceCommit) {
    throw new Error(
      `WASM provenance commit ${provenance.rustSourceCommit} does not match Rust HEAD ${sourceCommit}`,
    )
  }
  if (provenance.wasmSha256 !== actualSha256) {
    throw new Error(
      `WASM provenance SHA-256 ${provenance.wasmSha256} does not match binary ${actualSha256}`,
    )
  }

  await replaceGenerated(packageDirectory, generatedDirectory, sourcePackage)
  console.log(`Vendored workspace discovery WASM from Rust commit ${sourceCommit}`)
}

await main()
