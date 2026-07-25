import { Router } from 'express';
import IdentificationType from '../models/IdentificationType';

// IdentificationType is a global, read-only catalog (SRI's identification
// type codes) — it isn't tenant data, so it stays unscoped. Mutations are
// removed from the /api/v1 surface entirely for this phase: no tenant
// should be able to add/edit/remove entries in a catalog shared by every
// other tenant. If catalog maintenance is needed later, it belongs behind
// adminAuth, not here.
const router = Router();

router.get('/', async (_req, res) => {
  try {
    const docs = await IdentificationType.find();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await IdentificationType.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
