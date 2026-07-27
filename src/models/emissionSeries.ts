import { Schema } from 'mongoose';

/**
 * The emission context every SRI document is issued under.
 *
 * Documents did not previously record this at all: an invoice stored its
 * secuencial but nothing about which ambiente or emission point produced
 * it, so the only trace was the clave de acceso's embedded digits. Storing
 * it explicitly is what makes the uniqueness constraint below expressible.
 */
export type EmissionSeriesValues = {
  tipo_ambiente: number;
  codigo_establecimiento: string;
  punto_emision: string;
};

/** Schema field definitions, spread into each document model. */
export const emissionSeriesFields = {
  tipo_ambiente: { type: Number, required: true },
  codigo_establecimiento: { type: String, required: true },
  punto_emision: { type: String, required: true },
};

/**
 * Guards against emitting the same secuencial twice within one series.
 *
 * Note this cannot be an index on clave_acceso instead: the clave embeds an
 * 8-digit codigoNumerico chosen at random per document (see
 * generarClaveAcceso), so two documents that reuse a secuencial produce two
 * *different* claves and would both pass a unique clave_acceso index. The
 * constraint has to name the series fields directly.
 *
 * This catches our own faults — a counter reset, a botched migration, two
 * processes writing one series. It cannot catch a tenant under-reporting
 * their pre-migration secuencial, because the SRI knows about those
 * documents and we do not; that shows up as a rejection at recepción.
 *
 * Build order matters on an existing database: legacy documents have none
 * of these three fields, so they all index as the same null-valued key and
 * the build fails if any two share a secuencial — which is precisely what
 * the old ambiente-blind counter produced. scripts/migrate-sequence-series.ts
 * backfills before creating the index for that reason.
 */
export const applyEmissionSeriesIndex = (schema: Schema): void => {
  schema.index(
    {
      empresa_emisora_id: 1,
      tipo_ambiente: 1,
      codigo_establecimiento: 1,
      punto_emision: 1,
      secuencial: 1,
    },
    { unique: true },
  );
};

/** Reads the emission context off a loaded issuing company. */
export const emissionSeriesOf = (empresa: EmissionSeriesValues): EmissionSeriesValues => ({
  tipo_ambiente: empresa.tipo_ambiente,
  codigo_establecimiento: empresa.codigo_establecimiento,
  punto_emision: empresa.punto_emision,
});
