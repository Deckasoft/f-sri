import Sequence from '../models/Sequence';

/** SRI codDoc values (tabla 3) for the document kinds this system emits. */
export type DocumentType = '01' | '04' | '05' | '06' | '07';

const SECUENCIAL_LENGTH = 9;

/**
 * The fields of an issuing company that identify one SRI numbering series.
 *
 * Declared structurally rather than importing IIssuingCompany so this module
 * stays independent of the model, and so tests can pass a plain object.
 */
export type EmissionPoint = {
  _id: unknown;
  tipo_ambiente: number;
  codigo_establecimiento: string;
  punto_emision: string;
};

/** The Sequence document key for a given company and document type. */
export const seriesKeyOf = (empresa: EmissionPoint, documentType: DocumentType) => ({
  empresa_emisora_id: String(empresa._id),
  tipo_ambiente: empresa.tipo_ambiente,
  codigo_establecimiento: empresa.codigo_establecimiento,
  punto_emision: empresa.punto_emision,
  document_type: documentType,
});

/**
 * Atomically reserves and returns the next secuencial for one SRI numbering
 * series, formatted as SRI's required 9-digit zero-padded string
 * (e.g. "000000001").
 *
 * Uses a single findOneAndUpdate with $inc (and upsert for the first call)
 * instead of "find the highest existing secuencial for this tenant, add 1,
 * save" — that older approach reads and writes in two steps, so two
 * concurrent requests for the same tenant can read the same "highest"
 * value and both compute the same next secuencial. SRI rejects duplicate
 * secuenciales, so this must be a single atomic database operation.
 *
 * The series is keyed on (tenant, ambiente, estab, ptoEmi, document type) —
 * see the doc comment on src/models/Sequence.ts for why anything narrower
 * corrupts numbering when a tenant's ambiente or emission point changes.
 *
 * A series with no counter yet starts at 000000001. That is correct only
 * for a tenant that has never emitted this document type before; one
 * migrating from another system must have its counter seeded first, via
 * PUT /admin/api/tenants/:id/sequences/:documentType.
 */
export const getNextSecuencial = async (empresa: EmissionPoint, documentType: DocumentType): Promise<string> => {
  const sequence = await Sequence.findOneAndUpdate(
    seriesKeyOf(empresa, documentType),
    { $inc: { current: 1 } },
    { upsert: true, new: true },
  );

  return sequence.current.toString().padStart(SECUENCIAL_LENGTH, '0');
};
