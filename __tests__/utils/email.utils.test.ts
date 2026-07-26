const sendMock = jest.fn().mockResolvedValue({ data: { id: 'msg-123' }, error: null });

jest.mock('resend', () => ({
  __esModule: true,
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}));

const getFileBufferMock = jest.fn().mockResolvedValue(Buffer.from('pdf-bytes'));
jest.mock('../../src/services/storage', () => ({
  __esModule: true,
  PDFStorageFactory: { create: () => ({ getFileBuffer: (...args: any[]) => getFileBufferMock(...args) }) },
}));

const invoiceFindByIdMock = jest.fn().mockResolvedValue(null);
jest.mock('../../src/models/Invoice', () => ({
  __esModule: true,
  default: { findById: (...args: any[]) => invoiceFindByIdMock(...args) },
}));

import { Resend } from 'resend';
import {
  generateInvoiceEmailTemplate,
  prepareEmailConfig,
  isValidEmail,
  sendInvoiceEmail,
} from '../../src/utils/email.utils';

const invoicePDFMock: any = {
  factura_id: 'factura-1',
  claveAcceso: '1705202501179001234500110010010000000011234567810',
  numero_autorizacion: '1705202501179001234500110010010000000011234567810',
  fecha_autorizacion: new Date('2025-05-17T12:00:00Z'),
  fecha_generacion: new Date('2025-05-17T12:05:00Z'),
  pdf_url: 'pdfs/1791234500110/1705202501179001234500110010010000000011234567810.pdf',
  pdf_public_id: 'pdfs/1791234500110/1705202501179001234500110010010000000011234567810.pdf',
};

describe('isValidEmail', () => {
  it('accepts valid emails', () => {
    expect(isValidEmail('cliente@test.com')).toBe(true);
    expect(isValidEmail('a.b+c@sub.dominio.ec')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(isValidEmail('no-arroba')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});

describe('generateInvoiceEmailTemplate', () => {
  it('builds subject, html and text with the invoice data (no download link — the PDF is attached, not linked)', () => {
    const template = generateInvoiceEmailTemplate(invoicePDFMock, 'Juan Pérez', 'EMPRESA DEMO S.A.');

    expect(template.subject).toContain(invoicePDFMock.claveAcceso);
    expect(template.html).toContain('Juan Pérez');
    expect(template.html).toContain('EMPRESA DEMO S.A.');
    expect(template.html).not.toContain(invoicePDFMock.pdf_url);
    expect(template.text).toContain(invoicePDFMock.claveAcceso);
    expect(template.text).not.toContain(invoicePDFMock.pdf_url);
  });

  it('throws when the PDF is not stored yet (no pdf_public_id)', () => {
    expect(() => generateInvoiceEmailTemplate({ ...invoicePDFMock, pdf_public_id: '' }, 'Juan', 'Empresa')).toThrow(
      'PDF no disponible',
    );
  });
});

describe('prepareEmailConfig', () => {
  it('maps the template into a sendable config without attachments by default', () => {
    const template = { subject: 's', html: '<p>h</p>', text: 't' };
    const config = prepareEmailConfig(invoicePDFMock, template, 'cliente@test.com');

    expect(config).toEqual({
      to: 'cliente@test.com',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
    });
  });

  it('includes attachments when provided', () => {
    const template = { subject: 's', html: '<p>h</p>', text: 't' };
    const attachments = [{ filename: 'f.pdf', content: Buffer.from('x'), contentType: 'application/pdf' }];
    const config = prepareEmailConfig(invoicePDFMock, template, 'cliente@test.com', attachments);

    expect(config.attachments).toEqual(attachments);
  });
});

describe('sendInvoiceEmail', () => {
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.EMAIL_FROM;

  beforeEach(() => {
    jest.clearAllMocks();
    getFileBufferMock.mockResolvedValue(Buffer.from('pdf-bytes'));
    invoiceFindByIdMock.mockResolvedValue(null);
    sendMock.mockResolvedValue({ data: { id: 'msg-123' }, error: null });
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'Facturas <facturas@test.com>';
  });

  afterAll(() => {
    process.env.RESEND_API_KEY = originalApiKey;
    process.env.EMAIL_FROM = originalFrom;
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    if (originalFrom === undefined) delete process.env.EMAIL_FROM;
  });

  it('fetches the PDF from storage, sends via Resend and returns the messageId', async () => {
    const result = await sendInvoiceEmail(invoicePDFMock, 'cliente@test.com', 'Juan', 'Empresa');

    expect(result).toEqual({ success: true, messageId: 'msg-123' });
    expect(getFileBufferMock).toHaveBeenCalledWith(invoicePDFMock.pdf_public_id);
    expect(Resend).toHaveBeenCalledWith('re_test_key');
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Facturas <facturas@test.com>',
        to: 'cliente@test.com',
        attachments: [
          expect.objectContaining({
            filename: `${invoicePDFMock.claveAcceso}.pdf`,
            content: Buffer.from('pdf-bytes'),
            contentType: 'application/pdf',
          }),
        ],
      }),
    );
  });

  it('also attaches the authorized XML when the invoice has one', async () => {
    invoiceFindByIdMock.mockResolvedValueOnce({ xml_firmado: '<xml>signed</xml>' });

    await sendInvoiceEmail(invoicePDFMock, 'cliente@test.com', 'Juan', 'Empresa');

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({ filename: `${invoicePDFMock.claveAcceso}.pdf` }),
          expect.objectContaining({
            filename: `${invoicePDFMock.claveAcceso}.xml`,
            content: Buffer.from('<xml>signed</xml>', 'utf-8'),
            contentType: 'application/xml',
          }),
        ],
      }),
    );
  });

  it('sends only the PDF when fetching the XML fails (best-effort)', async () => {
    invoiceFindByIdMock.mockRejectedValueOnce(new Error('mongo down'));

    const result = await sendInvoiceEmail(invoicePDFMock, 'cliente@test.com', 'Juan', 'Empresa');

    expect(result.success).toBe(true);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [expect.objectContaining({ filename: `${invoicePDFMock.claveAcceso}.pdf` })],
      }),
    );
  });

  it('fails for an invalid recipient email', async () => {
    const result = await sendInvoiceEmail(invoicePDFMock, 'invalido', 'Juan', 'Empresa');

    expect(result.success).toBe(false);
    expect(result.error).toContain('email inválido');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('fails gracefully when RESEND_API_KEY is not configured', async () => {
    delete process.env.RESEND_API_KEY;

    const result = await sendInvoiceEmail(invoicePDFMock, 'cliente@test.com', 'Juan', 'Empresa');

    expect(result.success).toBe(false);
    expect(result.error).toContain('no configurado');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('fails gracefully when EMAIL_FROM is not configured', async () => {
    delete process.env.EMAIL_FROM;

    const result = await sendInvoiceEmail(invoicePDFMock, 'cliente@test.com', 'Juan', 'Empresa');

    expect(result.success).toBe(false);
    expect(result.error).toContain('no configurado');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('fails when the PDF cannot be fetched from storage — the attachment is mandatory', async () => {
    getFileBufferMock.mockRejectedValueOnce(new Error('Error descargando PDF de S3: NoSuchKey'));

    const result = await sendInvoiceEmail(invoicePDFMock, 'cliente@test.com', 'Juan', 'Empresa');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Error descargando PDF de S3');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns the error when Resend rejects the send', async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'Resend down' } });

    const result = await sendInvoiceEmail(invoicePDFMock, 'cliente@test.com', 'Juan', 'Empresa');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Resend down');
  });
});
