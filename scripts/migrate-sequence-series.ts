/**
 * Migra la numeración a series completas del SRI.
 *
 * POR QUÉ EXISTE ESTE SCRIPT
 * --------------------------
 * El contador de secuenciales estaba indexado por (tenant, tipo de
 * documento). El SRI numera por estab-ptoEmi dentro de un ambiente, y el
 * ambiente es un dígito propio de la clave de acceso: pruebas y producción
 * son universos disjuntos, no dos fases de una misma serie.
 *
 * Al cambiar la clave del contador a
 * (tenant, ambiente, estab, ptoEmi, tipo de documento), los documentos
 * `Sequence` existentes dejan de coincidir con la nueva consulta. Sin migrar,
 * CADA serie vuelve a arrancar en 000000001 y el SRI rechaza todo por
 * duplicado. Los comprobantes ya emitidos tampoco guardaban su ambiente ni su
 * punto de emisión, así que el índice único nuevo no se puede construir sobre
 * ellos hasta rellenarlos.
 *
 * QUÉ HACE, EN ORDEN
 * ------------------
 *  1. Rellena tipo_ambiente / codigo_establecimiento / punto_emision en los
 *     cinco modelos de comprobante, leyéndolos de la propia clave de acceso
 *     (posiciones fijas, ver generarClaveAcceso en src/utils/invoice.utils.ts).
 *  2. Busca colisiones que el nuevo índice único rechazaría y ABORTA si las
 *     hay, en vez de fallar de forma opaca al crear el índice.
 *  3. Borra el índice único viejo de `sequences`. Tiene que ir ANTES del paso
 *     4: ese índice es (empresa, document_type), así que el primer tenant con
 *     dos series (p. ej. pruebas y producción) chocaría contra él.
 *  4. Deriva un contador por serie a partir del secuencial más alto realmente
 *     emitido en esa serie. Es más preciso que mover el contador viejo en
 *     bloque: si un tenant emitió en pruebas y en producción, el contador
 *     único no sabía distinguirlos y ahora cada serie queda en su máximo real.
 *     Un contador viejo SIN comprobantes que lo respalden no se puede derivar
 *     así, y borrarlo perdería su marca de agua, de modo que se sella en el
 *     sitio con los valores actuales de la empresa.
 *  5. Crea los índices nuevos.
 *
 * Es idempotente: al repetirlo no queda nada que rellenar ni contadores
 * heredados, y los índices ya existen.
 *
 * Uso:
 *   npm run migrate:sequence-series             # simulacro, no escribe nada
 *   npm run migrate:sequence-series -- --apply  # aplica los cambios
 *   # dentro del contenedor (sin ts-node):
 *   node dist-scripts/scripts/migrate-sequence-series.js --apply
 */
import dotenv from 'dotenv';

dotenv.config();

import mongoose, { Model } from 'mongoose';
import { loadEnv } from '../src/config/env.config';
import Invoice from '../src/models/Invoice';
import CreditNote from '../src/models/CreditNote';
import DebitNote from '../src/models/DebitNote';
import DeliveryNote from '../src/models/DeliveryNote';
import Withholding from '../src/models/Withholding';
import Sequence from '../src/models/Sequence';
import IssuingCompany from '../src/models/IssuingCompany';

const APPLY = process.argv.includes('--apply');

/**
 * Posiciones fijas dentro de la clave de acceso de 49 dígitos:
 * fecha(8) tipoComprobante(2) ruc(13) ambiente(1) serie(6) secuencial(9)
 * codigoNumerico(8) tipoEmision(1) verificador(1).
 */
const CLAVE_ACCESO_LENGTH = 49;
const AMBIENTE_INDEX = 23;
const ESTAB_INDEX = 24;
const PTO_EMI_INDEX = 27;
const SERIE_PART_LENGTH = 3;

type SeriesFromClave = {
  tipo_ambiente: number;
  codigo_establecimiento: string;
  punto_emision: string;
};

const parseSeriesFromClaveAcceso = (claveAcceso: string): SeriesFromClave | null => {
  if (!claveAcceso || claveAcceso.length !== CLAVE_ACCESO_LENGTH || !/^\d+$/.test(claveAcceso)) {
    return null;
  }
  return {
    tipo_ambiente: Number(claveAcceso[AMBIENTE_INDEX]),
    codigo_establecimiento: claveAcceso.substring(ESTAB_INDEX, ESTAB_INDEX + SERIE_PART_LENGTH),
    punto_emision: claveAcceso.substring(PTO_EMI_INDEX, PTO_EMI_INDEX + SERIE_PART_LENGTH),
  };
};

/** codDoc del SRI -> modelo que almacena ese comprobante. */
const DOCUMENT_MODELS: ReadonlyArray<{ documentType: string; label: string; model: Model<any> }> = [
  { documentType: '01', label: 'Factura', model: Invoice },
  { documentType: '04', label: 'Nota de crédito', model: CreditNote },
  { documentType: '05', label: 'Nota de débito', model: DebitNote },
  { documentType: '06', label: 'Guía de remisión', model: DeliveryNote },
  { documentType: '07', label: 'Retención', model: Withholding },
];

/** Paso 1: rellena la serie en comprobantes que aún no la tienen. */
const backfillDocuments = async (): Promise<{ updated: number; unparseable: number }> => {
  let updated = 0;
  let unparseable = 0;

  for (const { label, model } of DOCUMENT_MODELS) {
    const pending = await model.find({ tipo_ambiente: { $exists: false } }, { _id: 1, clave_acceso: 1 }).lean();

    const operations = pending.flatMap((doc: any) => {
      const series = parseSeriesFromClaveAcceso(doc.clave_acceso);
      if (!series) {
        unparseable += 1;
        console.warn(`⚠️  ${label} ${doc._id}: clave de acceso ilegible, se omite (${doc.clave_acceso ?? 'vacía'})`);
        return [];
      }
      return [{ updateOne: { filter: { _id: doc._id }, update: { $set: series } } }];
    });

    if (operations.length > 0) {
      if (APPLY) {
        await model.bulkWrite(operations);
      }
      updated += operations.length;
      console.warn(`   ${label}: ${operations.length} comprobante(s) rellenado(s)`);
    }
  }

  return { updated, unparseable };
};

/**
 * Etapas que derivan la serie de la propia clave de acceso, en vez de leer
 * los campos que rellena el paso 1.
 *
 * Es deliberado: en simulacro el paso 1 no escribe nada, así que agrupar por
 * tipo_ambiente/codigo_establecimiento/punto_emision juntaría todo bajo
 * valores inexistentes y el simulacro describiría una migración distinta de
 * la que se acabaría ejecutando. La clave de acceso ya está en todos los
 * comprobantes y no la toca esta migración, así que leerla de ahí hace que
 * simulacro y aplicación coincidan exactamente.
 */
const SERIES_FROM_CLAVE_STAGES = [
  { $match: { $expr: { $eq: [{ $strLenBytes: '$clave_acceso' }, CLAVE_ACCESO_LENGTH] } } },
  {
    $addFields: {
      _serie_ambiente: { $toInt: { $substrBytes: ['$clave_acceso', AMBIENTE_INDEX, 1] } },
      _serie_estab: { $substrBytes: ['$clave_acceso', ESTAB_INDEX, SERIE_PART_LENGTH] },
      _serie_pto_emi: { $substrBytes: ['$clave_acceso', PTO_EMI_INDEX, SERIE_PART_LENGTH] },
    },
  },
];

/** Paso 2: colisiones que el índice único nuevo rechazaría. */
const findCollisions = async (): Promise<number> => {
  let total = 0;

  for (const { label, model } of DOCUMENT_MODELS) {
    const duplicates = await model.aggregate([
      ...SERIES_FROM_CLAVE_STAGES,
      {
        $group: {
          _id: {
            empresa_emisora_id: '$empresa_emisora_id',
            tipo_ambiente: '$_serie_ambiente',
            codigo_establecimiento: '$_serie_estab',
            punto_emision: '$_serie_pto_emi',
            secuencial: '$secuencial',
          },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ]);

    duplicates.forEach((dup: any) => {
      const k = dup._id;
      console.error(
        `❌ ${label}: ${dup.count} comprobantes comparten la serie ` +
          `${k.tipo_ambiente}-${k.codigo_establecimiento}-${k.punto_emision} secuencial ${k.secuencial} ` +
          `(empresa ${k.empresa_emisora_id})`,
      );
    });
    total += duplicates.length;
  }

  return total;
};

/** Paso 3: el índice viejo bloquea las series nuevas, hay que soltarlo primero. */
const dropLegacySequenceIndex = async (): Promise<boolean> => {
  const indexes = await Sequence.collection.indexes();
  const legacy = indexes.find((idx) => idx.key && Object.keys(idx.key).join(',') === 'empresa_emisora_id,document_type');

  if (!legacy) {
    return false;
  }
  if (APPLY) {
    await Sequence.collection.dropIndex(legacy.name as string);
  }
  console.warn(`   Índice heredado ${legacy.name} eliminado de sequences`);
  return true;
};

/** Paso 4: un contador por serie, derivado del secuencial más alto emitido. */
const rebuildCounters = async (): Promise<{ derived: number; stamped: number }> => {
  const legacyCounters = await Sequence.find({ tipo_ambiente: { $exists: false } }).lean();
  let derived = 0;
  let stamped = 0;

  for (const counter of legacyCounters as any[]) {
    const entry = DOCUMENT_MODELS.find((d) => d.documentType === counter.document_type);
    if (!entry) {
      console.warn(`⚠️  Contador ${counter._id}: document_type '${counter.document_type}' desconocido, se omite`);
      continue;
    }

    const series = await entry.model.aggregate([
      { $match: { empresa_emisora_id: counter.empresa_emisora_id } },
      ...SERIES_FROM_CLAVE_STAGES,
      {
        $group: {
          _id: {
            tipo_ambiente: '$_serie_ambiente',
            codigo_establecimiento: '$_serie_estab',
            punto_emision: '$_serie_pto_emi',
          },
          // secuencial es una cadena de 9 dígitos con ceros a la izquierda,
          // así que el máximo lexicográfico coincide con el numérico.
          maxSecuencial: { $max: '$secuencial' },
        },
      },
    ]);

    if (series.length === 0) {
      // Contador sin comprobantes que lo respalden: no hay serie que derivar y
      // borrarlo perdería su marca de agua, así que se sella con los valores
      // actuales de la empresa conservando `current`.
      const empresa = await IssuingCompany.findById(counter.empresa_emisora_id).lean();
      if (!empresa) {
        console.warn(`⚠️  Contador ${counter._id}: la empresa ya no existe, se omite`);
        continue;
      }
      const company = empresa as any;
      if (APPLY) {
        await Sequence.updateOne(
          { _id: counter._id },
          {
            $set: {
              tipo_ambiente: company.tipo_ambiente,
              codigo_establecimiento: company.codigo_establecimiento,
              punto_emision: company.punto_emision,
            },
          },
        );
      }
      stamped += 1;
      console.warn(
        `   ${entry.label}: contador sin comprobantes sellado en ` +
          `${company.tipo_ambiente}-${company.codigo_establecimiento}-${company.punto_emision} ` +
          `(current ${counter.current})`,
      );
      continue;
    }

    if (series.length > 1) {
      console.warn(
        `⚠️  ${entry.label} (empresa ${counter.empresa_emisora_id}): el contador único cubría ` +
          `${series.length} series distintas; cada una queda en su propio máximo real.`,
      );
    }

    for (const s of series as any[]) {
      const key = {
        empresa_emisora_id: counter.empresa_emisora_id,
        tipo_ambiente: s._id.tipo_ambiente,
        codigo_establecimiento: s._id.codigo_establecimiento,
        punto_emision: s._id.punto_emision,
        document_type: counter.document_type,
      };
      const current = Number(s.maxSecuencial);
      if (APPLY) {
        await Sequence.updateOne(key, { $set: { current } }, { upsert: true });
      }
      derived += 1;
      console.warn(
        `   ${entry.label}: serie ${key.tipo_ambiente}-${key.codigo_establecimiento}-${key.punto_emision} ` +
          `-> current ${current}`,
      );
    }

    if (APPLY) {
      await Sequence.deleteOne({ _id: counter._id });
    }
  }

  return { derived, stamped };
};

/** Paso 5: crea los índices declarados en los modelos. */
const buildIndexes = async (): Promise<void> => {
  if (!APPLY) {
    console.warn('   (simulacro: no se crean índices)');
    return;
  }
  for (const { label, model } of DOCUMENT_MODELS) {
    await model.syncIndexes();
    console.warn(`   Índices sincronizados: ${label}`);
  }
  await Sequence.syncIndexes();
  console.warn('   Índices sincronizados: Sequence');
};

const migrate = async (): Promise<void> => {
  const { MONGO_URI } = loadEnv();
  await mongoose.connect(MONGO_URI);

  if (!APPLY) {
    console.warn('🔍 SIMULACRO — no se escribirá nada. Repite con --apply para aplicar.\n');
  }

  console.warn('1) Rellenando la serie en comprobantes existentes…');
  const { updated, unparseable } = await backfillDocuments();
  console.warn(`   ${updated} rellenado(s), ${unparseable} con clave de acceso ilegible\n`);

  console.warn('2) Buscando colisiones para el índice único…');
  const collisions = await findCollisions();
  if (collisions > 0) {
    console.error(
      `\n❌ ${collisions} colisión(es). El índice único no se puede crear sobre estos datos.\n` +
        '   Hay que resolverlas a mano: son comprobantes que reutilizan un secuencial\n' +
        '   dentro de la misma serie, justo lo que producía el contador antiguo.\n' +
        '   No se ha modificado ningún índice.',
    );
    await mongoose.disconnect();
    process.exit(1);
  }
  console.warn('   Sin colisiones\n');

  console.warn('3) Eliminando el índice heredado de sequences…');
  const dropped = await dropLegacySequenceIndex();
  if (!dropped) {
    console.warn('   No existe (ya se había eliminado)');
  }
  console.warn('');

  console.warn('4) Reconstruyendo contadores por serie…');
  const { derived, stamped } = await rebuildCounters();
  console.warn(`   ${derived} derivado(s) de comprobantes, ${stamped} sellado(s) sin comprobantes\n`);

  console.warn('5) Creando índices…');
  await buildIndexes();

  console.warn(
    APPLY ? '\n✅ Migración aplicada.' : '\n🔍 Simulacro terminado. Nada se ha escrito. Repite con --apply para aplicar.',
  );

  await mongoose.disconnect();
};

migrate()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('❌ La migración de series falló:', err);
    process.exit(1);
  });
