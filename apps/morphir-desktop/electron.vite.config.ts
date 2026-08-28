import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  main: {},
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
