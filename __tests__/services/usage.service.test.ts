const usageEventStaticMocks = {
  create: jest.fn(),
  findOneAndUpdate: jest.fn(),
};
jest.mock('../../src/models/UsageEvent', () => ({
  __esModule: true,
  default: {
    create: (...args: any[]) => usageEventStaticMocks.create(...args),
    findOneAndUpdate: (...args: any[]) => usageEventStaticMocks.findOneAndUpdate(...args),
  },
}));

import { recordEmission, recordSriOutcome } from '../../src/services/usage.service';

// Flushes the microtask queue so a fire-and-forget promise's .then/.catch
// handlers (recordEmission/recordSriOutcome are never awaited by design) get
// a chance to run before assertions.
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('usage.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('recordEmission', () => {
    it('creates a UsageEvent with the given fields', async () => {
      usageEventStaticMocks.create.mockResolvedValue({ _id: 'usage-1' });

      recordEmission({
        empresaEmisoraId: 'company-1',
        documentType: '01',
        documentId: 'invoice-1',
        claveAcceso: 'clave-123',
        sriEstado: 'PENDIENTE',
      });

      await flushPromises();

      expect(usageEventStaticMocks.create).toHaveBeenCalledWith({
        empresa_emisora_id: 'company-1',
        document_type: '01',
        document_id: 'invoice-1',
        clave_acceso: 'clave-123',
        sri_estado: 'PENDIENTE',
      });
    });

    it('never throws or rejects when UsageEvent.create fails (metering must never break emission)', async () => {
      usageEventStaticMocks.create.mockRejectedValue(new Error('mongo down'));

      expect(() =>
        recordEmission({
          empresaEmisoraId: 'company-1',
          documentType: '01',
          documentId: 'invoice-1',
          claveAcceso: 'clave-123',
          sriEstado: 'PENDIENTE',
        }),
      ).not.toThrow();

      await flushPromises();
      // If the rejection had propagated unhandled, Jest would report an
      // unhandled rejection for this test — reaching this line means it didn't.
    });
  });

  describe('recordSriOutcome', () => {
    it('updates the matching UsageEvent by clave_acceso', async () => {
      usageEventStaticMocks.findOneAndUpdate.mockResolvedValue({ _id: 'usage-1' });

      recordSriOutcome('clave-123', 'RECIBIDA');

      await flushPromises();

      expect(usageEventStaticMocks.findOneAndUpdate).toHaveBeenCalledWith(
        { clave_acceso: 'clave-123' },
        { sri_estado: 'RECIBIDA' },
      );
    });

    it('never throws or rejects when UsageEvent.findOneAndUpdate fails', async () => {
      usageEventStaticMocks.findOneAndUpdate.mockRejectedValue(new Error('mongo down'));

      expect(() => recordSriOutcome('clave-123', 'RECIBIDA')).not.toThrow();

      await flushPromises();
    });
  });
});
