import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Vitest runs the pure-domain and persistence tests in a Node environment.
// No network access is permitted; tests inject clocks and id generators for
// determinism (see testing rules).
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    globals: true,
  },
});
