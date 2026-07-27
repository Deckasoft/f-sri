module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
    // Process entrypoint, same category as src/index.ts above: it wires
    // together already-covered pieces (the job processors and the reconciler
    // sweeps are tested in __tests__/queue/), connects to Mongo and Redis, and
    // installs signal handlers. Exercising it would mean booting the worker,
    // which is an integration concern rather than a unit one.
    '!src/worker.ts',
    '!src/swagger.ts',
    '!src/config/**',
    '!src/middleware/corsErrorHandler.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 90,
      lines: 85,
      statements: 85,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
  verbose: true,
  bail: 1,
  forceExit: true,
  detectOpenHandles: true,
};
