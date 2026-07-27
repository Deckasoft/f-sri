import crypto from 'crypto';
import { flushAllBackgroundWork } from '../src/utils/backgroundWork.utils';

// Every document service enqueues an authorization check after a successful
// recepción. Mocking the queue module suite-wide keeps that from opening a
// real Redis connection in tests: there is no Redis here, and BullMQ's
// blocking client would hang the run rather than fail fast. Tests that care
// can still assert on enqueueAuthorizationCheck, since it is a jest.fn().
//
// This replaces the old clearAllScheduledAuthorizationChecks() afterEach —
// the in-memory setTimeout it cancelled no longer exists.
jest.mock('../src/queue/queues', () => ({
  __esModule: true,
  AUTHORIZATION_QUEUE: 'sri-authorization',
  authorizationJobId: (documentType: string, documentId: string) => `${documentType}-${documentId}`,
  enqueueAuthorizationCheck: jest.fn().mockResolvedValue(undefined),
  closeQueues: jest.fn().mockResolvedValue(undefined),
}));

// Global test setup
jest.setTimeout(30000);

// Mock environment variables for tests
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_key_for_testing';
// Generado en tiempo de ejecución (no hardcodeado) para evitar falsos positivos de escaneo de secretos
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.MONGO_URI = 'mongodb://localhost:27017/veronica_test';
process.env.PUBLIC_URL = 'http://localhost:3000';
// loadEnv() requires this. Nothing in the suite connects to it — the queue
// module is mocked just below — but the value has to be present or every
// test that builds the app fails at startup validation.
process.env.REDIS_URL = 'redis://localhost:6379';

// Global mocks for CI environment
if (process.env.CI) {
  // Mock external services in CI
  jest.mock('puppeteer', () => ({
    launch: jest.fn(() =>
      Promise.resolve({
        newPage: jest.fn(() =>
          Promise.resolve({
            setViewport: jest.fn(),
            setContent: jest.fn(),
            pdf: jest.fn(() => Promise.resolve(Buffer.from('mock pdf content'))),
          }),
        ),
        close: jest.fn(),
      }),
    ),
  }));
}

// Console override for cleaner test output
const originalLog = console.log;
const originalError = console.error;

beforeAll(() => {
  // Suppress console.log in tests unless DEBUG is set
  if (!process.env.DEBUG) {
    console.log = jest.fn();
  }

  // Keep error logs for debugging
  console.error = jest.fn((message) => {
    if (process.env.DEBUG) {
      originalError(message);
    }
  });
});

afterAll(() => {
  // Restore console methods
  console.log = originalLog;
  console.error = originalError;
});

// Global test cleanup
afterEach(async () => {
  // Wait for any fire-and-forget async work a test's request may have
  // kicked off — procesarEnvioSRI's own chain (all 5 document services) and
  // apiKeyAuth's touchLastUsed — to settle, before resetting mocks below.
  // See src/utils/backgroundWork.utils.ts: none of this is awaited by its
  // real caller (by design), so without this a test can end while that work
  // is still running, which then keeps calling mocks that the NEXT,
  // unrelated test's beforeEach has already reconfigured — corrupting that
  // test's call counts/arguments instead of its own.
  await flushAllBackgroundWork();

  // Clear all mocks after each test
  jest.clearAllMocks();
});
