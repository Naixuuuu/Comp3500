import { Router } from 'express';
import { login, verifyOtp, logout } from '../services/authService.js';
import { requireAuth } from '../middleware/auth.js';

const r = Router();

/** POST /api/auth/login  { voterId, password } -> { challengeId, devOtp } */
r.post('/login', (req, res, next) => {
  try {
    const { voterId, password } = req.body || {};
    res.json(login(voterId, password));
  } catch (e) { next(e); }
});

/** POST /api/auth/verify  { challengeId, code } -> { token, user } */
r.post('/verify', (req, res, next) => {
  try {
    const { challengeId, code } = req.body || {};
    res.json(verifyOtp(challengeId, code));
  } catch (e) { next(e); }
});

/** POST /api/auth/logout */
r.post('/logout', requireAuth, (req, res, next) => {
  try {
    res.json(logout(req.token));
  } catch (e) { next(e); }
});

/** GET /api/auth/me */
r.get('/me', requireAuth, (req, res) => {
  res.json({ user: { voterId: req.user.voter_id, name: req.user.name, role: req.user.role } });
});

export default r;
