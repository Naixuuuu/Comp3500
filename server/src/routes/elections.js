import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  listElections, getBallot, castBallot, checkReceipt, markVotedOnPaper,
} from '../services/votingService.js';

const r = Router();

/** GET /api/elections */
r.get('/', requireAuth, (req, res, next) => {
  try { res.json({ elections: listElections() }); } catch (e) { next(e); }
});

/** GET /api/elections/:id/ballot — UC4, gated by the UC3 eligibility check */
r.get('/:id/ballot', requireAuth, (req, res, next) => {
  try { res.json(getBallot(req.user.voter_id, req.params.id)); } catch (e) { next(e); }
});

/** POST /api/elections/:id/vote  { candidateId } — UC5 */
r.post('/:id/vote', requireAuth, (req, res, next) => {
  try {
    const { candidateId } = req.body || {};
    res.status(201).json(castBallot(req.user, req.params.id, candidateId));
  } catch (e) { next(e); }
});

/** POST /api/elections/:id/mark-voted  { voterId } — UC8, presiding officer only */
r.post('/:id/mark-voted', requireAuth, requireRole('officer', 'admin'), (req, res, next) => {
  try {
    const { voterId } = req.body || {};
    res.json(markVotedOnPaper(req.user, voterId, req.params.id));
  } catch (e) { next(e); }
});

export default r;

/**
 * Receipt lookup lives at /api/receipt/:code and needs no session, so a voter may still
 * check a receipt after their session has expired.
 */
export const receiptRouter = Router();
receiptRouter.get('/:code', (req, res, next) => {
  try { res.json(checkReceipt(req.params.code)); } catch (e) { next(e); }
});
