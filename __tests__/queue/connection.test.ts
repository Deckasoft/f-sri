const redisConstructor = jest.fn();
const quitMock = jest.fn();

jest.mock('ioredis', () => ({
  __esModule: true,
  default: class {
    constructor(url: string, opts: unknown) {
      redisConstructor(url, opts);
    }
    quit = (...args: any[]) => quitMock(...args);
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getRedisConnection, closeRedisConnection } = require('../../src/queue/connection');

describe('redis connection', () => {
  const originalUrl = process.env.REDIS_URL;

  beforeEach(async () => {
    jest.clearAllMocks();
    quitMock.mockResolvedValue(undefined);
    await closeRedisConnection();
    process.env.REDIS_URL = originalUrl ?? 'redis://localhost:6379';
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.REDIS_URL = originalUrl;
  });

  // Nothing may connect at import time: every document service imports the
  // queue helpers, so an eager connection would open a socket the moment any
  // of them is loaded — including across the whole test suite, which has no
  // Redis and would hang rather than fail.
  it('does not connect until first use, then caches the connection', () => {
    expect(redisConstructor).not.toHaveBeenCalled();

    const first = getRedisConnection();
    const second = getRedisConnection();

    expect(redisConstructor).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  // maxRetriesPerRequest must be null: BullMQ's blocking commands sit open far
  // longer than ioredis's default retry budget, and the default aborts them
  // mid-wait.
  it('disables the per-request retry limit that would abort blocking commands', () => {
    getRedisConnection();

    const [url, opts] = redisConstructor.mock.calls[0];
    expect(url).toBe(process.env.REDIS_URL);
    expect(opts).toEqual({ maxRetriesPerRequest: null });
  });

  it('throws a descriptive error when REDIS_URL is missing', () => {
    delete process.env.REDIS_URL;

    expect(() => getRedisConnection()).toThrow(/REDIS_URL no está configurada/);
    expect(redisConstructor).not.toHaveBeenCalled();
  });

  it('quits and lets a later call open a fresh connection', async () => {
    getRedisConnection();
    await closeRedisConnection();

    expect(quitMock).toHaveBeenCalledTimes(1);

    getRedisConnection();
    expect(redisConstructor).toHaveBeenCalledTimes(2);
  });

  it('is a no-op to close when nothing was ever opened', async () => {
    await expect(closeRedisConnection()).resolves.toBeUndefined();
    expect(quitMock).not.toHaveBeenCalled();
  });
});
