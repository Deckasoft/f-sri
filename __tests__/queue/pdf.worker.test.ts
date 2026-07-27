import type { Job } from 'bullmq';

const generateMocks = {
  invoice: jest.fn(),
  creditNote: jest.fn(),
};

const docFindById = jest.fn();
const pdfFindOne = jest.fn();

jest.mock('../../src/services/invoice.service', () => ({
  __esModule: true,
  InvoiceService: { generarPDFDesdeId: (...a: any[]) => generateMocks.invoice(...a) },
}));
jest.mock('../../src/services/credit-note.service', () => ({
  __esModule: true,
  CreditNoteService: { generarPDFDesdeId: (...a: any[]) => generateMocks.creditNote(...a) },
}));

const lean = (fn: jest.Mock) => ({
  __esModule: true,
  default: {
    findById: (...args: any[]) => {
      const r: any = Promise.resolve(fn(...args));
      r.lean = () => r;
      return r;
    },
    findOne: (...args: any[]) => {
      const r: any = Promise.resolve(pdfFindOne(...args));
      r.lean = () => r;
      return r;
    },
  },
});

jest.mock('../../src/models/Invoice', () => lean(docFindById));
jest.mock('../../src/models/CreditNote', () => lean(docFindById));
jest.mock('../../src/models/InvoicePDF', () => lean(docFindById));
jest.mock('../../src/models/CreditNotePDF', () => lean(docFindById));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processPdfJob } = require('../../src/queue/workers/pdf.worker');
// Mocked suite-wide in __tests__/setup.ts.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { enqueueInvoiceEmail } = require('../../src/queue/queues');

const CLAVE = '2707202601092549093000110010010000000032225055917';

const job = (documentType: string, documentId: string) => ({ data: { documentType, documentId } }) as Job<any>;

describe('processPdfJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    generateMocks.invoice.mockResolvedValue(undefined);
    generateMocks.creditNote.mockResolvedValue(undefined);
    docFindById.mockResolvedValue({ clave_acceso: CLAVE });
    pdfFindOne.mockResolvedValue({ estado: 'GENERADO' });
  });

  it('generates the RIDE and queues the email for a factura', async () => {
    await expect(processPdfJob(job('01', 'factura-1'))).resolves.toBeUndefined();

    expect(generateMocks.invoice).toHaveBeenCalledWith('factura-1');
    expect(enqueueInvoiceEmail).toHaveBeenCalledWith(CLAVE);
  });

  // Only facturas are emailed: InvoicePDF is the only PDF model carrying the
  // email_* fields, and the RIDE a client expects to receive is the invoice.
  it('does not queue an email for other document types', async () => {
    await processPdfJob(job('04', 'cn-1'));

    expect(generateMocks.creditNote).toHaveBeenCalledWith('cn-1');
    expect(enqueueInvoiceEmail).not.toHaveBeenCalled();
  });

  // The regression this exists to prevent: the generators catch their own
  // failures and return normally, so a job whose Chromium never launched used
  // to be marked COMPLETED and the configured retries never applied. Checking
  // the outcome rather than the absence of an exception is what makes the
  // retry budget real.
  it('throws when no RIDE was produced, even though the generator resolved', async () => {
    pdfFindOne.mockResolvedValue(null);

    await expect(processPdfJob(job('01', 'factura-1'))).rejects.toThrow(/no se generó/);
    expect(enqueueInvoiceEmail).not.toHaveBeenCalled();
  });

  // An ERROR row means generation was attempted and failed; the RIDE still
  // does not exist, so the job must fail rather than report success.
  it('throws when the RIDE row records an ERROR', async () => {
    pdfFindOne.mockResolvedValue({ estado: 'ERROR' });

    await expect(processPdfJob(job('01', 'factura-1'))).rejects.toThrow(/no se generó/);
  });

  it('throws when the comprobante disappeared', async () => {
    docFindById.mockResolvedValue(null);

    await expect(processPdfJob(job('01', 'factura-1'))).rejects.toThrow(/no encontrado/);
  });

  it('rejects an unknown document type', async () => {
    await expect(processPdfJob(job('99', 'x-1'))).rejects.toThrow(/Tipo de documento desconocido/);
  });
});
