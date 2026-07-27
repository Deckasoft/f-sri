// __tests__/setup.ts mocks this module for every other suite, so its real
// implementation is never exercised anywhere else. Unmock it here: the force
// remove-then-add behaviour below is subtle enough that it was got wrong once
// already, and only a test against the real module can catch that.
jest.unmock('../../src/queue/queues');

const addMock = jest.fn();
const removeMock = jest.fn();
const closeMock = jest.fn();
const queueConstructor = jest.fn();

jest.mock('bullmq', () => ({
  __esModule: true,
  Queue: class {
    constructor(name: string, opts: unknown) {
      queueConstructor(name, opts);
    }
    add = (...args: any[]) => addMock(...args);
    remove = (...args: any[]) => removeMock(...args);
    close = (...args: any[]) => closeMock(...args);
  },
}));

jest.mock('../../src/queue/connection', () => ({
  __esModule: true,
  getRedisConnection: () => ({ fake: 'connection' }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  enqueueAuthorizationCheck,
  enqueuePdfGeneration,
  enqueueInvoiceEmail,
  authorizationJobId,
  closeQueues,
  AUTHORIZATION_QUEUE,
  PDF_QUEUE,
  EMAIL_QUEUE,
} = require('../../src/queue/queues');

describe('queue producers', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    addMock.mockResolvedValue({});
    removeMock.mockResolvedValue(undefined);
    closeMock.mockResolvedValue(undefined);
    await closeQueues();
    jest.clearAllMocks();
  });

  // BullMQ rejects a custom job id containing ':' ("Custom Id cannot contain
  // :"), because it composes its own Redis keys with that separator. The
  // original implementation used one and would have thrown on EVERY enqueue.
  it('builds job ids without a colon', () => {
    expect(authorizationJobId('01', 'abc123')).toBe('01-abc123');
    expect(authorizationJobId('01', 'abc123')).not.toContain(':');
  });

  it('enqueues an authorization check with retries and a deduplicating id', async () => {
    await enqueueAuthorizationCheck('01', 'factura-1', 5000);

    expect(queueConstructor).toHaveBeenCalledWith(AUTHORIZATION_QUEUE, expect.anything());
    const [name, payload, opts] = addMock.mock.calls[0];
    expect(name).toBe('check');
    expect(payload).toEqual({ documentType: '01', documentId: 'factura-1' });
    expect(opts.jobId).toBe('01-factura-1');
    expect(opts.delay).toBe(5000);
    expect(opts.attempts).toBe(10);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });

  // One producer per queue per process: a second enqueue must reuse it rather
  // than opening another connection.
  it('reuses a single Queue instance per queue name', async () => {
    await enqueueAuthorizationCheck('01', 'factura-1');
    await enqueueAuthorizationCheck('01', 'factura-2');

    expect(queueConstructor).toHaveBeenCalledTimes(1);
  });

  it('does not remove anything on a normal PDF enqueue', async () => {
    await enqueuePdfGeneration('01', 'factura-1');

    expect(removeMock).not.toHaveBeenCalled();
    expect(queueConstructor).toHaveBeenCalledWith(PDF_QUEUE, expect.anything());
    expect(addMock.mock.calls[0][2].jobId).toBe('01-factura-1');
  });

  // A job that already reached a terminal state keeps its id, and BullMQ
  // silently ignores an add reusing it. Recovery therefore has to drop the
  // stale job first, or the reconciler reports success while queueing nothing.
  it('removes the stale job before re-adding when forced', async () => {
    await enqueuePdfGeneration('01', 'factura-1', { force: true });

    expect(removeMock).toHaveBeenCalledWith('01-factura-1');
    expect(addMock).toHaveBeenCalled();
  });

  // Removing a job that is not there must not abort the recovery.
  it('still enqueues when removing the stale job fails', async () => {
    removeMock.mockRejectedValue(new Error('missing key'));

    await expect(enqueuePdfGeneration('01', 'factura-1', { force: true })).resolves.toBeUndefined();
    expect(addMock).toHaveBeenCalled();
  });

  it('enqueues an email keyed on the clave de acceso, and forces the same way', async () => {
    await enqueueInvoiceEmail('clave-1');
    expect(queueConstructor).toHaveBeenCalledWith(EMAIL_QUEUE, expect.anything());
    expect(addMock.mock.calls[0][2].jobId).toBe('email-clave-1');
    expect(removeMock).not.toHaveBeenCalled();

    await enqueueInvoiceEmail('clave-1', { force: true });
    expect(removeMock).toHaveBeenCalledWith('email-clave-1');
  });

  it('closes every queue it opened', async () => {
    await enqueueAuthorizationCheck('01', 'factura-1');
    await enqueuePdfGeneration('01', 'factura-1');

    await closeQueues();

    expect(closeMock).toHaveBeenCalledTimes(2);
  });
});
