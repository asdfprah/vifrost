import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Runtime counterpart of tsconfig.json's "paths" entry for the same
    // package — see the comment there for why "@vifrost/client" can't just
    // be a normal node_modules dependency here. Vite's resolver (unlike
    // plain Node/vitest without this) honors this alias at actual test-run
    // time, so tests exercise the monorepo's current local client code
    // instead of whatever's nested in node_modules.
    alias: {
      '@vifrost/client': fileURLToPath(new URL('../vifrost-client/dist/index.js', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
