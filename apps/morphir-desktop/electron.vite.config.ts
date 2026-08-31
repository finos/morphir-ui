import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

const require = createRequire(import.meta.url)

const workspaceWasmAsset = (): Plugin => ({
  name: 'morphir-workspace-wasm-asset',
  async generateBundle() {
    this.emitFile({
      type: 'asset' as const,
      fileName: 'morphir_workspace_wasm_bg.wasm',
      source: await readFile(require.resolve('@morphir/workspace-engine/wasm')),
    })
    this.emitFile({
      type: 'asset' as const,
      fileName: 'node-file-tree-worker.mjs',
      source: await readFile(
        new URL('./src/main/workspace/node-file-tree-worker.mjs', import.meta.url),
      ),
    })
  },
})

export default defineConfig({
  main: { plugins: [workspaceWasmAsset()] },
  // Sandboxed preload scripts must be CommonJS (Electron cannot load ESM preload
  // under webPreferences.sandbox: true). Force cjs output + .cjs extension so the
  // file is treated as CommonJS despite this package's "type": "module".
  preload: {
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: { plugins: [svelte()] },
})
