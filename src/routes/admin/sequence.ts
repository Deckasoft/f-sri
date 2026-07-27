import { Router } from 'express';
import { z } from 'zod';
import Sequence from '../../models/Sequence';
import SequenceAudit from '../../models/SequenceAudit';
import IssuingCompany from '../../models/IssuingCompany';
import { getAdminUserId } from '../../utils/admin.utils';
import type { DocumentType } from '../../utils/sequence.utils';

/**
 * Admin-only seeding of secuencial counters. Mounted at
 * /admin/api/tenants/:id/sequences, behind adminAuth.
 *
 * WHY THIS EXISTS
 * ---------------
 * A counter with no history starts at 000000001, which is only correct for
 * a tenant that has never emitted this document type. Most incoming tenants
 * are migrating from another system or from manual talonarios and arrive
 * mid-series, so their counter has to be told where the previous system
 * left off. The SRI offers no way to discover that: its only endpoints take
 * a clave de acceso you already hold, and reconstructing one requires the
 * 8-digit codigoNumerico the previous emitter chose freely. The number is
 * therefore operator input, collected from the customer during onboarding.
 *
 * WHY RAISE-ONLY
 * --------------
 * The two failure directions are not symmetric:
 *
 *  - Too low  -> we re-emit a secuencial the tenant already used. The SRI
 *    rejects it at recepción. Loud, immediate, recoverable.
 *  - Too high -> a permanent gap in the series. Silent; the SRI accepts
 *    everything. Unfixable once the counter moves past it.
 *
 * Lowering a counter is the only operation that *guarantees* duplicate
 * claves de acceso, so it is refused outright rather than confirmed. There
 * is deliberately no break-glass override: if nothing has been emitted
 * since, the audit trail shows the mistake is safe to correct by other
 * means, and if something has, lowering is unambiguously wrong.
 *
 * Enforcement lives in the update operator, not in application logic:
 * $max with upsert raises-or-creates in one atomic step, so two concurrent
 * seeds cannot interleave into a lower value.
 */
const router = Router({ mergeParams: true });

// See the note in src/routes/admin/apiKey.ts: Express infers `{}` for a
// literal path, with no way to know mergeParams merges the parent's :id.
interface TenantParams {
  [key: string]: string;
  id: string;
}

interface TenantSequenceParams extends TenantParams {
  documentType: string;
}

/** SRI codDoc values, with the labels the admin UI shows. */
const DOCUMENT_TYPES: ReadonlyArray<{ documentType: DocumentType; label: string }> = [
  { documentType: '01', label: 'Factura' },
  { documentType: '04', label: 'Nota de crédito' },
  { documentType: '05', label: 'Nota de débito' },
  { documentType: '06', label: 'Guía de remisión' },
  { documentType: '07', label: 'Retención' },
];

const MAX_SECUENCIAL = 999_999_999;
const SECUENCIAL_LENGTH = 9;

/**
 * The field is the LAST secuencial emitted, never the next one — `current`
 * starts at 0 and getNextSecuencial increments before reading, so seeding 47
 * makes the next document 000000048. Naming it `ultimo_secuencial` rather
 * than something ambiguous is what keeps every tenant from skipping a number
 * on their first emission.
 */
const seedSchema = z.object({
  ultimo_secuencial: z.number().int().min(0).max(MAX_SECUENCIAL),
});

type SeriesFields = { tipo_ambiente: number; codigo_establecimiento: string; punto_emision: string };

const seriesOf = (company: SeriesFields): SeriesFields => ({
  tipo_ambiente: company.tipo_ambiente,
  codigo_establecimiento: company.codigo_establecimiento,
  punto_emision: company.punto_emision,
});

router.get<TenantParams>('/', async (req, res) => {
  try {
    const company = await IssuingCompany.findById(req.params.id);
    if (!company) return res.status(404).json({ message: 'Tenant not found' });

    const serie = seriesOf(company);
    const counters = await Sequence.find({ empresa_emisora_id: req.params.id }).lean();

    const isActiveSeries = (c: SeriesFields) =>
      c.tipo_ambiente === serie.tipo_ambiente &&
      c.codigo_establecimiento === serie.codigo_establecimiento &&
      c.punto_emision === serie.punto_emision;

    res.json({
      // The series the tenant is emitting into right now; this is what PUT
      // targets. Counters for other series are returned separately so a
      // promoted tenant can still see its old pruebas numbering.
      serie,
      secuenciales: DOCUMENT_TYPES.map(({ documentType, label }) => {
        const counter = counters.find((c) => isActiveSeries(c) && c.document_type === documentType);
        return {
          document_type: documentType,
          label,
          ultimo_secuencial: counter ? counter.current : 0,
          existe: Boolean(counter),
        };
      }),
      otras_series: counters
        .filter((c) => !isActiveSeries(c))
        .map((c) => ({
          tipo_ambiente: c.tipo_ambiente,
          codigo_establecimiento: c.codigo_establecimiento,
          punto_emision: c.punto_emision,
          document_type: c.document_type,
          ultimo_secuencial: c.current,
        })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put<TenantSequenceParams>('/:documentType', async (req, res) => {
  const known = DOCUMENT_TYPES.some((d) => d.documentType === req.params.documentType);
  if (!known) {
    return res.status(400).json({
      message: `Tipo de documento inválido. Válidos: ${DOCUMENT_TYPES.map((d) => d.documentType).join(', ')}`,
    });
  }

  const parsed = seedSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: 'Datos inválidos: { ultimo_secuencial: number } requerido', errors: parsed.error.issues });
  }

  const { ultimo_secuencial } = parsed.data;

  try {
    const company = await IssuingCompany.findById(req.params.id);
    if (!company) return res.status(404).json({ message: 'Tenant not found' });

    const key = {
      empresa_emisora_id: req.params.id,
      ...seriesOf(company),
      document_type: req.params.documentType,
    };

    // $max raises or creates atomically: a concurrent seed can never land a
    // lower value, and no separate existence check is needed. `new: false`
    // returns the pre-update document, which is null when it was created --
    // that is how the audit records what it changed from.
    const before = await Sequence.findOneAndUpdate(
      key,
      { $max: { current: ultimo_secuencial } },
      { upsert: true, new: false },
    );

    if (before && before.current > ultimo_secuencial) {
      return res.status(409).json({
        message:
          `No se puede disminuir el secuencial: está en ${before.current} y se intentó fijar ` +
          `en ${ultimo_secuencial}. Bajarlo garantiza claves de acceso duplicadas que el SRI rechazará.`,
        ultimo_secuencial: before.current,
      });
    }

    const unchanged = Boolean(before) && before?.current === ultimo_secuencial;
    if (!unchanged) {
      await SequenceAudit.create({
        ...key,
        from: before ? before.current : null,
        to: ultimo_secuencial,
        changed_by: getAdminUserId(req),
      });
    }

    res.json({
      serie: seriesOf(company),
      document_type: req.params.documentType,
      ultimo_secuencial,
      proximo_secuencial: String(ultimo_secuencial + 1).padStart(SECUENCIAL_LENGTH, '0'),
      actualizado: !unchanged,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
