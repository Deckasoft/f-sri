import { Schema, model, Document, Types } from 'mongoose';

/**
 * One atomic counter per SRI numbering series. Backs
 * src/utils/sequence.utils.ts#getNextSecuencial, which replaces the old
 * read-then-increment "find the highest existing secuencial and add 1"
 * logic that raced under concurrent requests for the same tenant.
 *
 * The key is the full series the SRI recognises, not just (tenant, doc
 * type): numbering runs per estab-ptoEmi, and the ambiente is a separate
 * digit of the clave de acceso, so pruebas and producción are disjoint
 * universes rather than two phases of one series. Keying on less than this
 * means a tenant promoted to producción continues its test numbering, and
 * a tenant flipped back to pruebas burns production numbers on throwaway
 * documents — permanent, silent gaps in a series the SRI can audit.
 *
 * `current` is the LAST secuencial used, not the next one: it starts at 0
 * and getNextSecuencial increments before reading, so the first document
 * of a series is 000000001. Anything that seeds this value must use the
 * same convention (see src/routes/admin/sequence.ts).
 */
export interface ISequence extends Document {
  empresa_emisora_id: Types.ObjectId;
  tipo_ambiente: number;
  codigo_establecimiento: string;
  punto_emision: string;
  document_type: string;
  current: number;
}

const schema = new Schema<ISequence>({
  empresa_emisora_id: { type: Schema.Types.ObjectId, ref: 'IssuingCompany', required: true },
  tipo_ambiente: { type: Number, required: true },
  codigo_establecimiento: { type: String, required: true },
  punto_emision: { type: String, required: true },
  document_type: { type: String, required: true },
  current: { type: Number, required: true, default: 0 },
});

schema.index(
  { empresa_emisora_id: 1, tipo_ambiente: 1, codigo_establecimiento: 1, punto_emision: 1, document_type: 1 },
  { unique: true },
);

export default model<ISequence>('Sequence', schema);
