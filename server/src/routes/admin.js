import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createElection, updateElection, deleteElection,
  addCandidate, updateCandidate, deleteCandidate,
  openElection, closeElection, getElectionDetail,
} from '../services/electionService.js';

const r = Router();

// Every route here is administrator-only. The guard sits on the router, so a route added
// below cannot accidentally ship without it.
r.use(requireAuth, requireRole('admin'));

/** GET /api/admin/elections/:id — detail for the administration screen */
r.get('/elections/:id', (req, res, next) => {
  try { res.json(getElectionDetail(req.params.id)); } catch (e) { next(e); }
});

/** POST /api/admin/elections  { title, opensAt, closesAt } */
r.post('/elections', (req, res, next) => {
  try {
    const { title, opensAt, closesAt } = req.body || {};
    res.status(201).json(createElection(req.user, title, opensAt, closesAt));
  } catch (e) { next(e); }
});

/** PATCH /api/admin/elections/:id  { title?, opensAt?, closesAt? } */
r.patch('/elections/:id', (req, res, next) => {
  try {
    const { title, opensAt, closesAt } = req.body || {};
    res.json(updateElection(req.user, req.params.id, { title, opensAt, closesAt }));
  } catch (e) { next(e); }
});

/** DELETE /api/admin/elections/:id */
r.delete('/elections/:id', (req, res, next) => {
  try { res.json(deleteElection(req.user, req.params.id)); } catch (e) { next(e); }
});

/** POST /api/admin/elections/:id/candidates  { name, party } */
r.post('/elections/:id/candidates', (req, res, next) => {
  try {
    const { name, party } = req.body || {};
    res.status(201).json(addCandidate(req.user, req.params.id, name, party));
  } catch (e) { next(e); }
});

/** PATCH /api/admin/candidates/:id  { name?, party? } */
r.patch('/candidates/:id', (req, res, next) => {
  try {
    const { name, party } = req.body || {};
    res.json(updateCandidate(req.user, req.params.id, { name, party }));
  } catch (e) { next(e); }
});

/** DELETE /api/admin/candidates/:id */
r.delete('/candidates/:id', (req, res, next) => {
  try { res.json(deleteCandidate(req.user, req.params.id)); } catch (e) { next(e); }
});

/** POST /api/admin/elections/:id/open — draft -> open */
r.post('/elections/:id/open', (req, res, next) => {
  try { res.json(openElection(req.user, req.params.id)); } catch (e) { next(e); }
});

/** POST /api/admin/elections/:id/close — open -> closed */
r.post('/elections/:id/close', (req, res, next) => {
  try { res.json(closeElection(req.user, req.params.id)); } catch (e) { next(e); }
});

export default r;
