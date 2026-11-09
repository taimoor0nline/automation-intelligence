const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const ROLES = new Set(['DEV','QA','MANAGER']);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

function normalizeRole(role) {
  const value = String(role || '').toUpperCase();
  if (!ROLES.has(value)) throw new Error('Role must be DEV, QA, or MANAGER.');
  return value;
}

async function createUser({ email, displayName, password, role }) {
  if (!db.isConfigured()) throw new Error('PostgreSQL is required for user management.');
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !password || !displayName) throw new Error('Email, display name, and password are required.');
  const passwordHash = await bcrypt.hash(String(password), 12);
  const result = await db.query(
    `insert into users(email, display_name, password_hash, role)
     values($1,$2,$3,$4)
     returning id,email,display_name,role,is_active,created_at`,
    [normalizedEmail, String(displayName).trim(), passwordHash, normalizeRole(role)]
  );
  return result.rows[0];
}

async function authenticate(email, password) {
  if (!db.isConfigured()) throw new Error('PostgreSQL is required for authentication.');
  const result = await db.query(
    `select id,email,display_name,password_hash,role,is_active from users where email=$1`,
    [String(email || '').trim().toLowerCase()]
  );
  const user = result.rows[0];
  if (!user || !user.is_active || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
    return null;
  }
  const token = jwt.sign(
    { sub: user.id, email: user.email, name: user.display_name, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  return { token, user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role } };
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function optionalAuth(req, _res, next) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return next();
  try { req.user = verifyToken(auth.slice(7)); } catch {}
  next();
}

// Deactivated accounts (Users page) stop working on their next request, not only at their next sign-in.
const activeCache = new Map();
function forgetUserStatus(userId) { activeCache.delete(String(userId)); }
async function stillActive(userId) {
  const key = String(userId || ''), hit = activeCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.active;
  const r = await db.query('select is_active from users where id=$1', [key]);
  const active = !r.rowCount || r.rows[0].is_active !== false;
  activeCache.set(key, { active, at: Date.now() });
  return active;
}
function requireAuth(req, res, next) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ reply: 'Authentication required.' });
  try {
    req.user = verifyToken(auth.slice(7));
  } catch {
    return res.status(401).json({ reply: 'Invalid or expired authentication token.' });
  }
  if (!db.isConfigured()) return next();
  stillActive(req.user.sub)
    .then((active) => (active ? next() : res.status(401).json({ reply: 'This account has been deactivated.' })))
    .catch(() => next()); // a status lookup problem never blocks a valid sign-in
}

function requireRole(...roles) {
  const allowed = new Set(roles.map((r) => String(r).toUpperCase()));
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ reply: 'Authentication required.' });
    if (!allowed.has(String(req.user.role || '').toUpperCase())) return res.status(403).json({ reply: 'Insufficient role permission.' });
    next();
  };
}

module.exports = { createUser, authenticate, verifyToken, optionalAuth, requireAuth, requireRole, normalizeRole, forgetUserStatus };
