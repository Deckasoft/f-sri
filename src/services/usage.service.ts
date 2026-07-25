import UsageEvent from '../models/UsageEvent';
import type { TipoDocumento } from '../utils/firma.utils';

/**
 * Fire-and-forget usage metering, hooked into each of the 5 document
 * services (invoice, credit-note, debit-note, delivery-note, withholding).
 *
 * Metering must never break emission: neither function here is ever awaited
 * by its caller, and both explicitly `.catch()` their own promise so a
 * metering failure (e.g. a transient Mongo error) can never fail or reject
 * the document emission it's attached to. This also satisfies the repo's
 * no-floating-promises rule — the promise is handled, just not awaited.
 */

export interface RecordEmissionParams {
  empresaEmisoraId: string;
  documentType: TipoDocumento;
  documentId: string;
  claveAcceso: string;
  sriEstado: string;
}

/**
 * Records the initial usage event for a newly-created document, right after
 * it's saved. Call once per document, per document service.
 */
export const recordEmission = (params: RecordEmissionParams): void => {
  // Deliberately NOT tracked via trackBackgroundWork/flushAllBackgroundWork
  // (src/utils/backgroundWork.utils.ts): most callers of the 5 document
  // services in tests don't mock the UsageEvent model, so this hits a real
  // (never-connected, in a unit test) Mongoose model — awaiting it in the
  // global afterEach would block on Mongoose's connection-buffering wait
  // (potentially for the rest of the test's whole timeout) instead of
  // resolving quickly, the way the tracked call sites do.
  UsageEvent.create({
    empresa_emisora_id: params.empresaEmisoraId,
    document_type: params.documentType,
    document_id: params.documentId,
    clave_acceso: params.claveAcceso,
    sri_estado: params.sriEstado,
  }).catch((err: unknown) => {
    console.error('No se pudo registrar el evento de uso (recordEmission)', err);
  });
};

/**
 * Updates the usage event's sri_estado whenever a document's own sri_estado
 * changes (received/authorized/rejected/error). Looked up by clave_acceso,
 * which UsageEvent indexes and which is unique per document.
 */
export const recordSriOutcome = (claveAcceso: string, estado: string): void => {
  // See the comment on recordEmission above — deliberately not tracked.
  UsageEvent.findOneAndUpdate({ clave_acceso: claveAcceso }, { sri_estado: estado }).catch((err: unknown) => {
    console.error('No se pudo actualizar el evento de uso (recordSriOutcome)', err);
  });
};
