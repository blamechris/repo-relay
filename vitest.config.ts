import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: 'src',
    coverage: {
      provider: 'v8',
      // root is src/, so coverage paths are relative to it
      include: ['**/*.ts'],
      exclude: ['**/__tests__/**', 'setup.ts', 'setup/wizard.ts'],
      reporter: ['text', 'html'],
      reportsDirectory: '../coverage',
      // Ratchets: set slightly below current coverage so regressions fail
      // but routine churn doesn't. Raise as coverage grows.
      thresholds: {
        statements: 75,
        branches: 78,
        functions: 78,
        lines: 75,
        '**/handlers/**': { statements: 78, branches: 73, functions: 95, lines: 78 },
        '**/embeds/**': { statements: 74, branches: 70, functions: 77, lines: 74 },
        '**/github/**': { statements: 95, branches: 85, functions: 95, lines: 95 },
        '**/db/**': { statements: 62, branches: 78, functions: 45, lines: 62 },
        '**/utils/**': { statements: 95, branches: 95, functions: 95, lines: 95 },
        '**/patterns/**': { statements: 95, branches: 95, functions: 95, lines: 95 },
      },
    },
  },
});
