import mongoose from 'mongoose';

const findMocks = {
  invoice: jest.fn(),
  creditNote: jest.fn(),
  debitNote: jest.fn(),
  deliveryNote: jest.fn(),
  withholding: jest.fn(),
};

const pdfFindMocks = {
  invoicePDF: jest.fn(),
  creditNotePDF: jest.fn(),
  debitNotePDF: jest.fn(),
  deliveryNotePDF: jest.fn(),
  withholdingPDF: jest.fn(),
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
jest.mock('../../src/models/InvoicePDF', () => mockModel(pdfFindMocks.invoicePDF));
jest.mock('../../src/models/CreditNotePDF', () => mockModel(pdfFindMocks.creditNotePDF));
jest.mock('../../src/models/DebitNotePDF', () => mockModel(pdfFindMocks.debitNotePDF));
jest.mock('../../src/models/DeliveryNotePDF', () => mockModel(pdfFindMocks.deliveryNotePDF));
jest.mock('../../src/models/WithholdingPDF', () => mockModel(pdfFindMocks.withholdingPDF));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  reconcilePendingAuthorizations,
  reconcileMissingPdfs,
  reconcileUnsentEmails,
  runReconcileSweep,
  runReconcileSweepOnStartup,
} = require('../../src/queue/reconciler');
// Mocked suite-wide in __tests__/setup.ts.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { enqueueAuthorizationCheck, enqueuePdfGeneration, enqueueInvoiceEmail } = require('../../src/queue/queues');

const NOW = new Date('2026-07-27T12:00:00.000Z').getTime();

describe('reconcilePendingAuthorizations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(findMocks).forEach((m) => m.mockReturnValue([]));
    Object.values(pdfFindMocks).forEach((m) => m.mockReturnValue([]));
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

// The authorization sweep only looks at PENDIENTE/RECIBIDA, so an AUTORIZADO
// comprobante falls outside it entirely. Without this sweep, a PDF job that
// failed, exhausted its retries, or vanished with Redis stranded the document
// permanently — authorized, no RIDE, nothing watching. That is exactly what a
// Chromium launch failure produced in the local stack.
describe('reconcileMissingPdfs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(findMocks).forEach((m) => m.mockReturnValue([]));
    Object.values(pdfFindMocks).forEach((m) => m.mockReturnValue([]));
  });

  // force matters: the previous job for this document has already reached a
  // terminal state, and BullMQ silently ignores an add reusing that id.
  // Without it the sweep reports success while queueing nothing at all —
  // which is exactly what happened the first time this was fixed.
  it('re-enqueues an authorized comprobante that has no RIDE, forcing past the stale job id', async () => {
    findMocks.invoice.mockReturnValue([{ _id: 'factura-1', clave_acceso: 'clave-1' }]);
    pdfFindMocks.invoicePDF.mockReturnValue([]);

    await expect(reconcileMissingPdfs(NOW)).resolves.toBe(1);
    expect(enqueuePdfGeneration).toHaveBeenCalledWith('01', 'factura-1', { force: true });
  });

  it('leaves an authorized comprobante alone once its RIDE exists', async () => {
    findMocks.invoice.mockReturnValue([{ _id: 'factura-1', clave_acceso: 'clave-1' }]);
    pdfFindMocks.invoicePDF.mockReturnValue([{ claveAcceso: 'clave-1' }]);

    await expect(reconcileMissingPdfs(NOW)).resolves.toBe(0);
    expect(enqueuePdfGeneration).not.toHaveBeenCalled();
  });

  // An ERROR row records a generation that failed, so the RIDE still does not
  // exist — the query only counts GENERADO as "has a RIDE".
  it('treats an ERROR row as still missing', async () => {
    findMocks.invoice.mockReturnValue([{ _id: 'factura-1', clave_acceso: 'clave-1' }]);
    pdfFindMocks.invoicePDF.mockReturnValue([]);

    await reconcileMissingPdfs(NOW);

    const [pdfQuery] = pdfFindMocks.invoicePDF.mock.calls[0];
    expect(pdfQuery.estado).toBe('GENERADO');
  });

  it('only considers AUTORIZADO comprobantes', async () => {
    findMocks.invoice.mockReturnValue([{ _id: 'factura-1', clave_acceso: 'clave-1' }]);

    await reconcileMissingPdfs(NOW);

    const [query] = findMocks.invoice.mock.calls[0];
    expect(query.sri_estado).toBe('AUTORIZADO');
  });
});

describe('reconcileUnsentEmails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(pdfFindMocks).forEach((m) => m.mockReturnValue([]));
  });

  it('re-enqueues a generated RIDE whose email was never attempted', async () => {
    pdfFindMocks.invoicePDF.mockReturnValue([{ claveAcceso: 'clave-1' }]);

    await expect(reconcileUnsentEmails(NOW)).resolves.toBe(1);
    expect(enqueueInvoiceEmail).toHaveBeenCalledWith('clave-1', { force: true });
  });

  // ERROR means the send was tried and failed — a bad address, or Resend
  // rejecting it. BullMQ has already retried that; sweeping it too would be
  // an endless five-minute redelivery loop against something needing a human.
  it('sweeps only NO_ENVIADO, never ERROR', async () => {
    await reconcileUnsentEmails(NOW);

    const [query] = pdfFindMocks.invoicePDF.mock.calls[0];
    expect(query.email_estado).toBe('NO_ENVIADO');
    expect(query.estado).toBe('GENERADO');
  });
});

describe('runReconcileSweep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(findMocks).forEach((m) => m.mockReturnValue([]));
    Object.values(pdfFindMocks).forEach((m) => m.mockReturnValue([]));
  });

  it('runs all three sweeps in one pass', async () => {
    findMocks.invoice.mockReturnValue([{ _id: 'factura-1', clave_acceso: 'clave-1' }]);

    await runReconcileSweep(NOW);

    // The authorization sweep and the missing-RIDE sweep query the same
    // collection with different states, so both must have run.
    const states = findMocks.invoice.mock.calls.map(([q]: any[]) => q.sri_estado);
    expect(states).toContainEqual({ $in: ['PENDIENTE', 'RECIBIDA'] });
    expect(states).toContain('AUTORIZADO');
    expect(pdfFindMocks.invoicePDF).toHaveBeenCalled();
  });

  // Non-fatal on purpose: the worker is what processes the jobs this sweep
  // queues, so a failing sweep must not stop it from starting. The repeatable
  // job will try again shortly.
  it('swallows failures at startup rather than stopping the worker', async () => {
    findMocks.invoice.mockImplementation(() => {
      throw new Error('mongo caído');
    });

    await expect(runReconcileSweepOnStartup()).resolves.toBeUndefined();
  });

  it('propagates failures when called directly, so the repeatable job records them', async () => {
    findMocks.invoice.mockImplementation(() => {
      throw new Error('mongo caído');
    });

    await expect(runReconcileSweep(NOW)).rejects.toThrow(/mongo caído/);
  });
});
