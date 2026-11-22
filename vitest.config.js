import { defineConfig } from 'vitest/config';

// Tests run the app's own modules (app/js) under node + jsdom. Bare imports such as 'react' and 'dexie'
// resolve from node_modules (same versions as the import map in app/index.html), so no aliases are needed.
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'jsdom',
    setupFiles: ['test/helpers/setup.js'],
    globals: true,
  },
});
