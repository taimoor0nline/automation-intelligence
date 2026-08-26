const express = require('express');
const router = express.Router();
const db = require('../db');
const { createUser, authenticate, requireAuth, requireRole } = require('../services/authService');

router.post('/api/auth/bootstrap', async (req, res) => {
  try {
    if (!db.isConfigured()) return res.status(409).json({ reply: 'PostgreSQL is not configured.' });
    const count = await db.query('select count(*)::int as count from users');
    if ((count.rows[0]?.count || 0) > 0) return res.status(409).json({ reply: 'Bootstrap is disabled after the first user is created.' });
    const user = await createUser({ ...req.body, role: 'MANAGER' });
    return res.status(201).json({ ok: true, user });
  } catch (err) {
    return res.status(400).json({ reply: err.message });
  }
});

router.post('/api/auth/login', async (req, res) => {
  try {
    const result = await authenticate(req.body?.email, req.body?.password);
    if (!result) return res.status(401).json({ reply: 'Invalid email or password.' });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ reply: err.message });
  }
});

router.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

router.get('/api/users', requireAuth, requireRole('MANAGER'), async (_req, res) => {
  try {
    const result = await db.query('select id,email,display_name as "displayName",role,is_active as "isActive",created_at as "createdAt" from users order by created_at desc');
    return res.json({ ok: true, users: result.rows });
  } catch (err) {
    return res.status(500).json({ reply: err.message });
  }
});

router.post('/api/users', requireAuth, requireRole('MANAGER'), async (req, res) => {
  try {
    const user = await createUser(req.body || {});
    return res.status(201).json({ ok: true, user });
  } catch (err) {
    return res.status(400).json({ reply: err.message });
  }
});

router.patch('/api/users/:id/role', requireAuth, requireRole('MANAGER'), async (req, res) => {
  try {
    const role = String(req.body?.role || '').toUpperCase();
    if (!['DEV','QA','MANAGER'].includes(role)) return res.status(400).json({ reply: 'Role must be DEV, QA, or MANAGER.' });
    const result = await db.query('update users set role=$1,updated_at=now() where id=$2 returning id,email,display_name as "displayName",role,is_active as "isActive"', [role, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ reply: 'User not found.' });
    return res.json({ ok: true, user: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ reply: err.message });
  }
});

module.exports = router;
