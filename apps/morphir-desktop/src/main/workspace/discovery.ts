import { homedir } from 'node:os'
import { isAbsolute, join, posix, win32 } from 'node:path'
import type { DiscoveryRequest, DiscoveryResponse } from '@morphir/workspace'
import type { WorkspaceDiscoveryEngine } from '@morphir/workspace-engine'
import { fileTreeFromNodeConfigCandidates, fileTreeFromNodeRoot } from './node-file-tree.ts'
import { getWorkspaceDiscoveryEngine } from './wasm-engine.ts'

export interface NodeWorkspaceDiscoveryOptions {
  readonly systemConfigRoot?: string | null
  readonly globalConfigCandidates?: ReadonlyArray<string>
  readonly systemConfigCandidates?: ReadonlyArray<string>
  readonly engine?: Promise<WorkspaceDiscoveryEngine>
}

export const nodeGlobalConfigCandidates = (
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): ReadonlyArray<string> => {
  const paths = platform === 'win32' ? win32 : posix
  const xdg = env['XDG_CONFIG_HOME']
  const platformConfig =
    platform === 'win32'
      ? env['APPDATA'] || paths.join(home, 'AppData', 'Roaming')
      : xdg && isAbsolute(xdg)
        ? xdg
        : platform === 'darwin'
          ? paths.join(home, 'Library', 'Application Support')
          : paths.join(home, '.config')
  const resolvedHome =
    env['MORPHIR_HOME'] && env['MORPHIR_HOME'].length > 0
      ? env['MORPHIR_HOME']
      : paths.join(home, '.morphir')
  const roots = [paths.join(platformConfig, 'morphir'), resolvedHome]
  return [
    ...new Set(
      roots.flatMap((root) => [paths.join(root, 'morphir.toml'), paths.join(root, 'morphir.yaml')]),
    ),
  ]
}

export const nodeSystemConfigCandidates = (
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): ReadonlyArray<string> => {
  const paths = platform === 'win32' ? win32 : posix
  const root =
    platform === 'win32'
      ? paths.join(env['PROGRAMDATA'] || 'C:\\ProgramData', 'morphir')
      : '/etc/morphir'
  return [paths.join(root, 'morphir.toml'), paths.join(root, 'morphir.yaml')]
}

const morphirEnvironment = (
  env: Record<string, string | undefined>,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(env)
      .filter(
        (entry): entry is [string, string] =>
          entry[0].toUpperCase().startsWith('MORPHIR_') && entry[1] !== undefined,
      )
      .map(([key, value]) => [key, value] as const)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  )

export const buildNodeWorkspaceDiscoveryRequest = async (
  developmentRoot: string,
  env: Record<string, string | undefined> = process.env,
  options: NodeWorkspaceDiscoveryOptions = {},
): Promise<DiscoveryRequest> => {
  const globalCandidates = options.globalConfigCandidates ?? nodeGlobalConfigCandidates(env)
  const systemCandidates =
    options.systemConfigCandidates ??
    (options.systemConfigRoot === null
      ? []
      : options.systemConfigRoot === undefined
        ? nodeSystemConfigCandidates(env)
        : [
            join(options.systemConfigRoot, 'morphir.toml'),
            join(options.systemConfigRoot, 'morphir.yaml'),
          ])
  const [developmentRootTree, morphirHomeTree, systemConfig] = await Promise.all([
    fileTreeFromNodeRoot(developmentRoot),
    fileTreeFromNodeConfigCandidates(globalCandidates, 'global Morphir configuration'),
    fileTreeFromNodeConfigCandidates(systemCandidates, 'system Morphir configuration'),
  ])
  return {
    protocolVersion: 1,
    developmentRoot: developmentRootTree,
    morphirHome: morphirHomeTree,
    systemConfig,
    environment: morphirEnvironment(env),
    cliOverlay: {},
  }
}

export const discoverNodeWorkspace = async (
  developmentRoot: string,
  env: Record<string, string | undefined> = process.env,
  options: NodeWorkspaceDiscoveryOptions = {},
): Promise<DiscoveryResponse> => {
  const [engine, request] = await Promise.all([
    options.engine ?? getWorkspaceDiscoveryEngine(),
    buildNodeWorkspaceDiscoveryRequest(developmentRoot, env, options),
  ])
  return engine.discover(request)
}
