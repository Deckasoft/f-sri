import type { Job } from 'bullmq';

const sendInvoiceEmailMock = jest.fn();
const invoicePDFFindOne = jest.fn();
const invoiceFindById = jest.fn();
const clientFindById = jest.fn();
const companyFindById = jest.fn();

jest.mock('../../src/utils/email.utils', () => ({
  __esModule: true,
  sendInvoiceEmail: (...args: any[]) => sendInvoiceEmailMock(...args),
}));
jest.mock('../../src/models/InvoicePDF', () => ({
  __esModule: true,
  default: { findOne: (...args: any[]) => invoicePDFFindOne(...args) },
}));
jest.mock('../../src/models/Invoice', () => ({
  __esModule: true,
  default: { findById: (...args: any[]) => invoiceFindById(...args) },
}));
jest.mock('../../src/models/Client', () => ({
  __esModule: true,
  default: { findById: (...args: any[]) => clientFindById(...args) },
}));
jest.mock('../../src/models/IssuingCompany', () => ({
  __esModule: true,
  default: { findById: (...args: any[]) => companyFindById(...args) },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processEmailJob } = require('../../src/queue/workers/email.worker');

const CLAVE = '2407202601179001234500110010020000000480000000010';

const job = () => ({ data: { claveAcceso: CLAVE } }) as Job<{ claveAcceso: string }>;

const createMockInvoicePDF = (overrides: Record<string, unknown> = {}): Record<string, any> => ({
  claveAcceso: CLAVE,
  factura_id: 'factura-1',
  email_estado: 'NO_ENVIADO',
  email_intentos: 0,
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('processEmailJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invoiceFindById.mockResolvedValue({ _id: 'factura-1', cliente_id: 'c-1', empresa_emisora_id: 'e-1' });
    clientFindById.mockResolvedValue({ email: 'cliente@example.test', razon_social: 'CLIENTE S.A.' });
    companyFindById.mockResolvedValue({ razon_social: 'EMISOR S.A.', email_notificacion: 'avisos@example.test' });
    sendInvoiceEmailMock.mockResolvedValue({ success: true, messageId: 'msg-1' });
  });

  it('sends to the client and records the send', async () => {
    const doc = createMockInvoicePDF();
    invoicePDFFindOne.mockResolvedValue(doc);

    await processEmailJob(job());

    expect(sendInvoiceEmailMock).toHaveBeenCalledWith(doc, 'cliente@example.test', 'CLIENTE S.A.', 'EMISOR S.A.');
    expect(doc.email_estado).toBe('ENVIADO');
    expect(doc.email_intentos).toBe(1);
    expect(doc.save).toHaveBeenCalled();
  });

  // The reconciler can legitimately drive an already-authorized comprobante
  // back through the PDF job, which re-enqueues this one. Without the guard
  // the client would be mailed the same factura again.
  it('is idempotent: skips a RIDE already marked ENVIADO', async () => {
    const doc = createMockInvoicePDF({ email_estado: 'ENVIADO', email_intentos: 1 });
    invoicePDFFindOne.mockResolvedValue(doc);

    await processEmailJob(job());

    expect(sendInvoiceEmailMock).not.toHaveBeenCalled();
    expect(doc.email_intentos).toBe(1);
  });

  // The fallback keeps an authorized factura from being undeliverable, but it
  // means the RIDE reached the emisor and NOT the customer. email_estado
  // would read ENVIADO either way, so the substitution is flagged on the row
  // — otherwise "the client never got their invoice" is invisible.
  it('falls back to the emisor address when the client has no email, and records that it did', async () => {
    clientFindById.mockResolvedValue({ email: undefined, razon_social: 'CLIENTE S.A.' });
    const doc = createMockInvoicePDF();
    invoicePDFFindOne.mockResolvedValue(doc);

    await processEmailJob(job());

    expect(sendInvoiceEmailMock).toHaveBeenCalledWith(
      expect.anything(),
      'avisos@example.test',
      'CLIENTE S.A.',
      'EMISOR S.A.',
    );
    expect(doc.email_enviado_al_emisor).toBe(true);
    expect(doc.email_destinatario).toBe('avisos@example.test');
  });

  it('does not flag the substitution when the client does have an email', async () => {
    const doc = createMockInvoicePDF();
    invoicePDFFindOne.mockResolvedValue(doc);

    await processEmailJob(job());

    expect(doc.email_destinatario).toBe('cliente@example.test');
    expect(doc.email_enviado_al_emisor).toBe(false);
  });

  // Retrying cannot conjure an address, so this records the gap instead of
  // burning the retry budget on it.
  // ERROR rather than NO_ENVIADO is load-bearing: NO_ENVIADO is the model
  // default and means "never attempted", which is what the reconciler sweeps
  // for. Marking an undeliverable RIDE NO_ENVIADO would have it re-enqueued
  // every five minutes forever.
  it('records ERROR without throwing when there is no address at all', async () => {
    clientFindById.mockResolvedValue({ razon_social: 'CLIENTE S.A.' });
    companyFindById.mockResolvedValue({ razon_social: 'EMISOR S.A.' });
    const doc = createMockInvoicePDF();
    invoicePDFFindOne.mockResolvedValue(doc);

    await expect(processEmailJob(job())).resolves.toBeUndefined();

    expect(sendInvoiceEmailMock).not.toHaveBeenCalled();
    expect(doc.email_estado).toBe('ERROR');
    expect(doc.email_estado).not.toBe('NO_ENVIADO');
    expect(doc.email_ultimo_error).toMatch(/no tiene email/);
  });

  // A transient Resend failure should cost a retry, not the client's factura.
  it('records ERROR and throws so BullMQ retries when the send fails', async () => {
    sendInvoiceEmailMock.mockResolvedValue({ success: false, error: 'Resend caído' });
    const doc = createMockInvoicePDF();
    invoicePDFFindOne.mockResolvedValue(doc);

    await expect(processEmailJob(job())).rejects.toThrow(/Resend caído/);

    expect(doc.email_estado).toBe('ERROR');
    expect(doc.email_intentos).toBe(1);
  });

  it('throws when there is no RIDE for the clave de acceso', async () => {
    invoicePDFFindOne.mockResolvedValue(null);

    await expect(processEmailJob(job())).rejects.toThrow(/No hay RIDE/);
  });
});
