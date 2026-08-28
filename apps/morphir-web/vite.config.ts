import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [svelte()],
  define: { __MORPHIR_WEB_VERSION__: JSON.stringify(pkg.version) },
  test: { environment: 'happy-dom', include: ['test/**/*.test.ts'] },
  resolve: { conditions: ['browser'] },
})
