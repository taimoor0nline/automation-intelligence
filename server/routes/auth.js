const express = require('express');
const router = express.Router();
const db = require('../db');
const { createUser, authenticate, requireAuth, requireRole, forgetUserStatus } = require('../services/authService');

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
    const result = await db.query('select u.id,u.email,u.display_name as "displayName",u.role,u.is_active as "isActive",u.created_at as "createdAt",u.updated_at as "updatedAt",cb.display_name as "createdByName",ub.display_name as "updatedByName" from users u left join users cb on cb.id=u.created_by left join users ub on ub.id=u.updated_by order by u.created_at desc');
    return res.json({ ok: true, users: result.rows });
  } catch (err) {
    return res.status(500).json({ reply: err.message });
  }
});

router.post('/api/users', requireAuth, requireRole('MANAGER'), async (req, res) => {
  try {
    const user = await createUser(req.body || {});
    await db.query('update users set created_by=$2 where id=$1', [user.id, req.user.sub]);
    return res.status(201).json({ ok: true, user });
  } catch (err) {
    return res.status(400).json({ reply: err.message });
  }
});

// Activate / deactivate an account (never deleted). You cannot deactivate yourself or the last active manager.
router.patch('/api/users/:id/status', requireAuth, requireRole('MANAGER'), async (req, res) => {
  try {
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ reply: 'Choose active or inactive.' });
    if (!req.body.active && String(req.params.id) === String(req.user.sub)) return res.status(400).json({ reply: 'You cannot deactivate your own account.' });
    if (!req.body.active) {
      const target = await db.query('select role from users where id=$1', [req.params.id]);
      if (target.rows[0]?.role === 'MANAGER') {
        const others = await db.query("select count(*)::int n from users where role='MANAGER' and is_active=true and id<>$1", [req.params.id]);
        if (!others.rows[0].n) return res.status(409).json({ reply: 'At least one active manager is required.' });
      }
    }
    const result = await db.query('update users set is_active=$2,updated_at=now(),updated_by=$3 where id=$1 returning id,display_name as "displayName",is_active as "isActive"', [req.params.id, req.body.active, req.user.sub]);
    if (!result.rowCount) return res.status(404).json({ reply: 'User not found.' });
    forgetUserStatus(req.params.id);
    return res.json({ ok: true, user: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ reply: err.message });
  }
});

router.patch('/api/users/:id/role', requireAuth, requireRole('MANAGER'), async (req, res) => {
  try {
    const role = String(req.body?.role || '').toUpperCase();
    if (!['DEV','QA','MANAGER'].includes(role)) return res.status(400).json({ reply: 'Role must be DEV, QA, or MANAGER.' });
    const result = await db.query('update users set role=$1,updated_at=now(),updated_by=$3 where id=$2 returning id,email,display_name as "displayName",role,is_active as "isActive"', [role, req.params.id, req.user.sub]);
    if (!result.rowCount) return res.status(404).json({ reply: 'User not found.' });
    return res.json({ ok: true, user: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ reply: err.message });
  }
});

module.exports = router;
