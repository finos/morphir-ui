import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DiscoveryRequest, DiscoveryResponse, FileTree } from '@morphir/workspace'
import type { WorkspaceDiscoveryEngine } from '@morphir/workspace-engine'
import { morphirHome } from '../config.ts'
import { fileTreeFromNodeRoot } from './node-file-tree.ts'
import { getWorkspaceDiscoveryEngine } from './wasm-engine.ts'

export interface NodeWorkspaceDiscoveryOptions {
  readonly systemConfigRoot?: string | null
  readonly engine?: Promise<WorkspaceDiscoveryEngine>
}

const optionalTree = async (path: string | null): Promise<FileTree | null> => {
  if (path === null) return null
  try {
    await lstat(path)
  } catch (cause) {
    if (typeof cause === 'object' && cause !== null && Reflect.get(cause, 'code') === 'ENOENT') {
      return null
    }
    throw cause
  }
  return fileTreeFromNodeRoot(path)
}

const defaultSystemConfigRoot = (env: Record<string, string | undefined>): string =>
  process.platform === 'win32'
    ? join(env['PROGRAMDATA'] || 'C:\\ProgramData', 'morphir')
    : '/etc/morphir'

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
  const systemConfigRoot =
    options.systemConfigRoot === undefined ? defaultSystemConfigRoot(env) : options.systemConfigRoot
  const [developmentRootTree, morphirHomeTree, systemConfig] = await Promise.all([
    fileTreeFromNodeRoot(developmentRoot),
    optionalTree(morphirHome(env)),
    optionalTree(systemConfigRoot),
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
