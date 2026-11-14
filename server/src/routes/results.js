import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getResults } from '../services/resultService.js';
import * as audit from '../services/auditService.js';

const r = Router();

/** GET /api/results/:electionId */
r.get('/:electionId', requireAuth, (req, res, next) => {
  try { res.json(getResults(req.user, req.params.electionId)); } catch (e) { next(e); }
});

export default r;

/** GET /api/audit — auditors and administrators only (UC10). */
export const auditRouter = Router();
auditRouter.get('/', requireAuth, requireRole('auditor', 'admin'), (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    audit.record(req.user.voter_id, 'audit.viewed', `limit ${limit}`);
    res.json({ entries: audit.list(limit) });
  } catch (e) { next(e); }
});
