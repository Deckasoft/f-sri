import mongoose from 'mongoose';

const findMocks = {
  invoice: jest.fn(),
  creditNote: jest.fn(),
  debitNote: jest.fn(),
  deliveryNote: jest.fn(),
  withholding: jest.fn(),
};

const mockModel = (find: jest.Mock) => ({
  __esModule: true,
  default: {
    find: (...args: any[]) => {
      const result: any = Promise.resolve(find(...args));
      result.lean = () => result;
      return result;
    },
  },
});

jest.mock('../../src/models/Invoice', () => mockModel(findMocks.invoice));
jest.mock('../../src/models/CreditNote', () => mockModel(findMocks.creditNote));
jest.mock('../../src/models/DebitNote', () => mockModel(findMocks.debitNote));
jest.mock('../../src/models/DeliveryNote', () => mockModel(findMocks.deliveryNote));
jest.mock('../../src/models/Withholding', () => mockModel(findMocks.withholding));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { reconcilePendingAuthorizations } = require('../../src/queue/reconciler');
// Mocked suite-wide in __tests__/setup.ts.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { enqueueAuthorizationCheck } = require('../../src/queue/queues');

const NOW = new Date('2026-07-27T12:00:00.000Z').getTime();

describe('reconcilePendingAuthorizations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(findMocks).forEach((m) => m.mockReturnValue([]));
  });

  it('re-enqueues every comprobante still awaiting authorization', async () => {
    findMocks.invoice.mockReturnValue([{ _id: 'factura-1' }, { _id: 'factura-2' }]);
    findMocks.withholding.mockReturnValue([{ _id: 'ret-1' }]);

    const requeued = await reconcilePendingAuthorizations(NOW);

    expect(requeued).toBe(3);
    expect(enqueueAuthorizationCheck).toHaveBeenCalledWith('01', 'factura-1', 0);
    expect(enqueueAuthorizationCheck).toHaveBeenCalledWith('01', 'factura-2', 0);
    expect(enqueueAuthorizationCheck).toHaveBeenCalledWith('07', 'ret-1', 0);
  });

  it('only looks at non-terminal states', async () => {
    await reconcilePendingAuthorizations(NOW);

    const [query] = findMocks.invoice.mock.calls[0];
    expect(query.sri_estado).toEqual({ $in: ['PENDIENTE', 'RECIBIDA'] });
  });

  // Freshly-submitted comprobantes already have a job in flight; sweeping
  // them would just churn. The cutoff is expressed as an ObjectId bound
  // because the document models carry no createdAt field.
  it('ignores comprobantes newer than the staleness cutoff', async () => {
    await reconcilePendingAuthorizations(NOW);

    const [query] = findMocks.invoice.mock.calls[0];
    const cutoff: mongoose.Types.ObjectId = query._id.$lt;
    expect(cutoff).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(cutoff.getTimestamp().getTime()).toBe(NOW - 2 * 60 * 1000);
  });

  it('reports zero when nothing is pending', async () => {
    await expect(reconcilePendingAuthorizations(NOW)).resolves.toBe(0);
    expect(enqueueAuthorizationCheck).not.toHaveBeenCalled();
  });
});
