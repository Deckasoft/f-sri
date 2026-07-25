import Sequence from '../models/Sequence';

/** SRI codDoc values (tabla 3) for the document kinds this system emits. */
export type DocumentType = '01' | '04' | '05' | '06' | '07';

const SECUENCIAL_LENGTH = 9;

/**
 * Atomically reserves and returns the next secuencial for a (tenant,
 * document type) pair, formatted as SRI's required 9-digit zero-padded
 * string (e.g. "000000001").
 *
 * Uses a single findOneAndUpdate with $inc (and upsert for the first call)
 * instead of "find the highest existing secuencial for this tenant, add 1,
 * save" — that older approach reads and writes in two steps, so two
 * concurrent requests for the same tenant can read the same "highest"
 * value and both compute the same next secuencial. SRI rejects duplicate
 * secuenciales, so this must be a single atomic database operation.
 */
export const getNextSecuencial = async (companyId: string, documentType: DocumentType): Promise<string> => {
  const sequence = await Sequence.findOneAndUpdate(
    { empresa_emisora_id: companyId, document_type: documentType },
    { $inc: { current: 1 } },
    { upsert: true, new: true },
  );

  return sequence.current.toString().padStart(SECUENCIAL_LENGTH, '0');
};
