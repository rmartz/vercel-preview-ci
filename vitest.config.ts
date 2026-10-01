import { defineConfig } from 'vitest/config';

// The tests read the workflow YAML and assert its contracts; there is no src/.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
