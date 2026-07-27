import type { Job } from 'bullmq';
import { processAuthorizationJob } from '../../src/queue/workers/authorization.worker';
import { InvoiceService } from '../../src/services/invoice.service';
import { CreditNoteService } from '../../src/services/credit-note.service';
import type { AuthorizationJob } from '../../src/queue/queues';

const job = (documentType: string, documentId: string) =>
  ({ data: { documentType, documentId } }) as Job<AuthorizationJob>;

describe('processAuthorizationJob', () => {
  afterEach(() => jest.restoreAllMocks());

  it('resolves once the SRI reports AUTORIZADO', async () => {
    const spy = jest
      .spyOn(InvoiceService, 'consultarAutorizacionSRI')
      .mockResolvedValue({ estado: 'AUTORIZADO' } as any);

    await expect(processAuthorizationJob(job('01', 'factura-1'))).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith('factura-1');
  });

  // NO AUTORIZADO is terminal too: the comprobante was rejected, and asking
  // again will not change that. Retrying would poll forever.
  it('resolves on NO AUTORIZADO rather than retrying forever', async () => {
    jest.spyOn(InvoiceService, 'consultarAutorizacionSRI').mockResolvedValue({ estado: 'NO AUTORIZADO' } as any);

    await expect(processAuthorizationJob(job('01', 'factura-1'))).resolves.toBeUndefined();
  });

  // Throwing is the retry signal: BullMQ reschedules with exponential
  // backoff. This is what replaced the old fixed budget of three attempts,
  // after which a slow comprobante was abandoned in PENDIENTE forever.
  it('throws while the comprobante is still being processed, so the job retries', async () => {
    jest.spyOn(InvoiceService, 'consultarAutorizacionSRI').mockResolvedValue({ estado: 'EN PROCESO' } as any);

    await expect(processAuthorizationJob(job('01', 'factura-1'))).rejects.toThrow(/aún sin autorizar/);
  });

  it('throws when the SRI query returns nothing at all', async () => {
    jest.spyOn(InvoiceService, 'consultarAutorizacionSRI').mockResolvedValue(null);

    await expect(processAuthorizationJob(job('01', 'factura-1'))).rejects.toThrow(/sin respuesta/);
  });

  it('routes each document type to its own service', async () => {
    const creditNoteSpy = jest
      .spyOn(CreditNoteService, 'consultarAutorizacionSRI')
      .mockResolvedValue({ estado: 'AUTORIZADO' } as any);
    const invoiceSpy = jest.spyOn(InvoiceService, 'consultarAutorizacionSRI');

    await processAuthorizationJob(job('04', 'cn-1'));

    expect(creditNoteSpy).toHaveBeenCalledWith('cn-1');
    expect(invoiceSpy).not.toHaveBeenCalled();
  });

  it('rejects an unknown document type', async () => {
    await expect(processAuthorizationJob(job('99', 'x-1'))).rejects.toThrow(/Tipo de documento desconocido/);
  });
});
