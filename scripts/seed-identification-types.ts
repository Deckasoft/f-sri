/**
 * Siembra el catálogo `IdentificationType` con los códigos fijos del SRI.
 *
 * POR QUÉ EXISTE ESTE SCRIPT
 * --------------------------
 * `identification-type` es un catálogo GLOBAL de solo lectura: sus rutas de
 * mutación (POST/PUT/DELETE) se eliminaron a propósito, porque cualquier
 * tenant autenticado podía añadir, modificar o borrar entradas de las que
 * dependen TODOS los demás tenants para emitir. Correcto desde el punto de
 * vista de aislamiento — pero deja la pregunta de quién lo puebla.
 *
 * Nadie lo hacía. En una base de datos nueva (el escenario que DEPLOYMENT.md
 * asume explícitamente para este release) la colección arranca vacía y no
 * hay forma de llenarla, así que:
 *
 *   - `Client.tipo_identificacion_id` es requerido y referencia este modelo,
 *   - y la emisión resuelve el tipo por código
 *     (InvoiceService.buscarTipoIdentificacion) y lanza
 *     'Identification type not found' cuando no lo encuentra.
 *
 * Es decir: sin sembrar esto, no se puede crear ningún cliente ni emitir
 * ningún comprobante. Este script es un paso OBLIGATORIO del primer
 * despliegue, igual que create-admin.
 *
 * Los códigos NO son configurables: los fija el SRI en su Ficha Técnica
 * (tabla "Tipo de Identificación del Comprador"), y el XML generado debe
 * usar exactamente esos valores, así que van hardcodeados aquí en vez de
 * leerse de variables de entorno.
 *
 * Es idempotente (no duplica si ya existe el `codigo`), así que se puede
 * correr las veces que haga falta — en cada despliegue, por ejemplo.
 *
 * Uso:
 *   npm run seed:identification-types
 *   # dentro del contenedor de producción (sin ts-node):
 *   node dist-scripts/scripts/seed-identification-types.js
 */
import dotenv from 'dotenv';

dotenv.config();

import mongoose from 'mongoose';
import { loadEnv } from '../src/config/env.config';
import IdentificationType from '../src/models/IdentificationType';

/**
 * Tabla de tipos de identificación del comprador definida por el SRI. El
 * `codigo` es lo que viaja en el XML (`tipoIdentificacionComprador`), así que
 * debe coincidir exactamente con la ficha técnica.
 */
const SRI_IDENTIFICATION_TYPES: ReadonlyArray<{ codigo: string; descripcion: string }> = [
  { codigo: '04', descripcion: 'RUC' },
  { codigo: '05', descripcion: 'CEDULA' },
  { codigo: '06', descripcion: 'PASAPORTE' },
  { codigo: '07', descripcion: 'VENTA A CONSUMIDOR FINAL' },
  { codigo: '08', descripcion: 'IDENTIFICACION DEL EXTERIOR' },
];

const seed = async (): Promise<void> => {
  const { MONGO_URI } = loadEnv();

  await mongoose.connect(MONGO_URI);

  const results = await Promise.all(
    SRI_IDENTIFICATION_TYPES.map(async ({ codigo, descripcion }) => {
      const existing = await IdentificationType.findOne({ codigo });
      if (existing) {
        return { codigo, descripcion, created: false };
      }
      await IdentificationType.create({ codigo, descripcion });
      return { codigo, descripcion, created: true };
    }),
  );

  const created = results.filter((r) => r.created);
  const skipped = results.filter((r) => !r.created);

  created.forEach(({ codigo, descripcion }) => {
    console.warn(`✅ Creado     ${codigo} — ${descripcion}`);
  });
  skipped.forEach(({ codigo, descripcion }) => {
    console.warn(`↩️  Ya existía ${codigo} — ${descripcion}`);
  });
  console.warn(
    `\nCatálogo de tipos de identificación listo: ${created.length} creado(s), ` +
      `${skipped.length} sin cambios, ${results.length} en total.`,
  );

  await mongoose.disconnect();
};

seed()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('❌ No se pudo sembrar el catálogo de tipos de identificación:', err);
    process.exit(1);
  });
