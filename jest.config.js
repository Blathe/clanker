/**
 * Jest Configuration
 * Configured for TypeScript ESM projects
 */

export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.test.json',
        diagnostics: { ignoreCodes: [1343] },
      },
    ],
  },
  testMatch: ['**/tests/**/*.test.ts', '**/*.test.ts'],
  collectCoverageFrom: [
    'agent/**/*.ts',
    '!agent/**/*.d.ts',
    '!agent/types.ts', // Type definitions
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageThreshold: {
    global: { branches: 30, functions: 40, lines: 40, statements: 40 },
  },
};
