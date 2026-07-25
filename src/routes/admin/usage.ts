import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import UsageEvent from '../../models/UsageEvent';

// Admin-only usage/metering reporting. Mounted directly at /admin/api (not
// nested under /tenants/:id like apiKey.ts/invite.ts) because it exposes
// both a per-tenant endpoint (/tenants/:id/usage) and a cross-tenant one
// (/usage/summary) that doesn't belong under any single tenant's namespace.
const router = Router();

const dateRangeQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

interface DateMatch {
  createdAt: { $gte?: Date; $lte?: Date };
}

interface UsageByTypeAndStatus {
  _id: { document_type: string; sri_estado: string };
  count: number;
}

interface UsageByTenant {
  _id: string;
  total: number;
}

const buildDateMatch = (from?: Date, to?: Date): DateMatch | Record<string, never> => {
  if (!from && !to) return {};
  const range: { $gte?: Date; $lte?: Date } = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return { createdAt: range };
};

router.get('/tenants/:id/usage', async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: 'Invalid tenant id' });
  }

  const parsedQuery = dateRangeQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ message: 'Invalid from/to query parameters' });
  }

  try {
    // UsageEvent indexes { empresa_emisora_id, createdAt } — this $match
    // shape (equality on empresa_emisora_id + optional createdAt range) is
    // designed to use that compound index rather than a collection scan.
    const match = {
      empresa_emisora_id: new Types.ObjectId(req.params.id),
      ...buildDateMatch(parsedQuery.data.from, parsedQuery.data.to),
    };

    const results = await UsageEvent.aggregate<UsageByTypeAndStatus>([
      { $match: match },
      {
        $group: {
          _id: { document_type: '$document_type', sri_estado: '$sri_estado' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.document_type': 1, '_id.sri_estado': 1 } },
    ]);

    res.json(
      results.map((row) => ({
        document_type: row._id.document_type,
        sri_estado: row._id.sri_estado,
        count: row.count,
      })),
    );
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/usage/summary', async (req, res) => {
  const parsedQuery = dateRangeQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ message: 'Invalid from/to query parameters' });
  }

  try {
    const dateMatch = buildDateMatch(parsedQuery.data.from, parsedQuery.data.to);
    const hasDateMatch = Object.keys(dateMatch).length > 0;

    const results = await UsageEvent.aggregate<UsageByTenant>([
      ...(hasDateMatch ? [{ $match: dateMatch }] : []),
      { $group: { _id: '$empresa_emisora_id', total: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]);

    res.json(
      results.map((row) => ({
        empresa_emisora_id: String(row._id),
        total: row.total,
      })),
    );
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
