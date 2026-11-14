import { userForToken } from '../services/authService.js';
import { unauthorized, forbidden } from '../errors.js';

/** Attach req.user from the bearer token, or reject. */
export function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = userForToken(token);
  if (!user) return next(unauthorized('not_authenticated', 'Sign in first'));
  req.user = user;
  req.token = token;
  next();
}

/** Allow only the listed roles. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized('not_authenticated', 'Sign in first'));
    if (!roles.includes(req.user.role)) {
      return next(forbidden('forbidden_role', `Requires role: ${roles.join(' or ')}`));
    }
    next();
  };
}
