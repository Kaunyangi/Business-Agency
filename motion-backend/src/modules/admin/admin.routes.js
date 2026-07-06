const express = require('express');
const { z } = require('zod');
const { db } = require('../../config/db');
const { id } = require('../../utils/helpers');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { hashPassword } = require('../../utils/auth-crypto');
const { audit } = require('../../utils/audit');
const revenue = require('../revenue/revenue.service');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const DEPARTMENTS = ['Sales', 'Marketing', 'Finance', 'Operations', 'General'];

router.get('/users', (req, res) => {
  const users = db.prepare("SELECT id, name, email, department, created_at FROM users WHERE role = 'admin' ORDER BY created_at").all();
  res.json({ users });
});

const createAdminSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8),
  department: z.enum(DEPARTMENTS),
});

// Platform admin (department General, or any existing admin) provisions
// department-scoped admin logins — each sees only their own dashboard tab
// in the frontend, so Finance can't casually browse Marketing's numbers.
router.post('/users', validate(createAdminSchema), async (req, res, next) => {
  try {
    const { name, email, password, department } = req.body;
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const passwordHash = await hashPassword(password);
    const userId = id('usr');
    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role, phone, department, terms_accepted_at, wallet_balance_cents, created_at)
       VALUES (?,?,?,?, 'admin', '', ?, datetime('now'), 0, datetime('now'))`
    ).run(userId, name, email, passwordHash, department);

    audit(req, req.user.id, 'admin.user_created', { userId, department });
    res.status(201).json({ user: { id: userId, name, email, department, role: 'admin' } });
  } catch (err) { next(err); }
});

/* ---------------- SALES ---------------- */
router.get('/dashboard/sales', (req, res) => {
  const gmvByLine = db.prepare(
    `SELECT order_type, COUNT(*) AS orders, SUM(total_cents) AS gmv_cents
     FROM orders WHERE status = 'paid' GROUP BY order_type ORDER BY gmv_cents DESC`
  ).all();
  const funnel = db.prepare(
    `SELECT status, COUNT(*) AS n FROM orders GROUP BY status`
  ).all();
  const topProperties = db.prepare(
    `SELECT p.name, p.location, COUNT(*) AS bookings, SUM(o.total_cents) AS revenue_cents
     FROM room_bookings rb JOIN rooms r ON r.id = rb.room_id JOIN properties p ON p.id = r.property_id
     JOIN orders o ON o.id = rb.order_id WHERE o.status = 'paid'
     GROUP BY p.id ORDER BY revenue_cents DESC LIMIT 5`
  ).all();
  const topEvents = db.prepare(
    `SELECT e.name, e.city, COUNT(*) AS tickets_sold, SUM(oi.line_total_cents) AS revenue_cents
     FROM order_items oi JOIN ticket_tiers t ON t.id = oi.ref_id AND oi.ref_type = 'ticket_tier'
     JOIN events e ON e.id = t.event_id JOIN orders o ON o.id = oi.order_id WHERE o.status = 'paid'
     GROUP BY e.id ORDER BY revenue_cents DESC LIMIT 5`
  ).all();
  const repeatBuyers = db.prepare(
    `SELECT COUNT(*) AS n FROM (SELECT user_id FROM orders WHERE status = 'paid' GROUP BY user_id HAVING COUNT(*) > 1)`
  ).get().n;
  const totalBuyers = db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM orders WHERE status = 'paid'`).get().n;
  res.json({
    gmvByLine, funnel, topProperties, topEvents,
    repeatBookingRate: totalBuyers ? Math.round((repeatBuyers / totalBuyers) * 1000) / 10 : 0,
    totalBuyers,
  });
});

/* ---------------- MARKETING ---------------- */
router.get('/dashboard/marketing', (req, res) => {
  const signupsByDay = db.prepare(
    `SELECT date(created_at) AS day, COUNT(*) AS n FROM users GROUP BY day ORDER BY day DESC LIMIT 30`
  ).all();
  const byRole = db.prepare(`SELECT role, COUNT(*) AS n FROM users GROUP BY role`).all();
  const totalUsers = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
  const buyersWithOrder = db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM orders WHERE status = 'paid'`).get().n;
  const buyersWithTopup = db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM wallet_transactions WHERE type = 'topup'`).get().n;
  res.json({
    signupsByDay, byRole, totalUsers,
    funnel: {
      registered: totalUsers,
      toppedUpWallet: buyersWithTopup,
      madeFirstBooking: buyersWithOrder,
    },
    signupToBookingRate: totalUsers ? Math.round((buyersWithOrder / totalUsers) * 1000) / 10 : 0,
  });
});

/* ---------------- FINANCE ---------------- */
router.get('/dashboard/finance', (req, res) => {
  const revenueSummary = revenue.summary();
  const grossRevenue = db.prepare(`SELECT COALESCE(SUM(total_cents),0) AS n FROM orders WHERE status = 'paid'`).get().n;
  const payoutLiability = db.prepare(
    `SELECT order_type, COALESCE(SUM(subtotal_cents),0) AS payable_cents, COALESCE(SUM(commission_cents),0) AS commission_cents
     FROM orders WHERE status = 'paid' GROUP BY order_type`
  ).all();
  const walletLiability = db.prepare(`SELECT COALESCE(SUM(wallet_balance_cents),0) AS n FROM users`).get().n;
  const byProvider = db.prepare(
    `SELECT provider, status, COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS amount_cents FROM payments GROUP BY provider, status`
  ).all();
  res.json({
    grossRevenueCents: grossRevenue,
    commissionByRule: revenueSummary.byLine,
    totalCommissionCents: revenueSummary.totalCents,
    payoutLiability,
    walletLiabilityCents: walletLiability,
    reconciliation: byProvider,
  });
});

/* ---------------- OPERATIONS ---------------- */
router.get('/dashboard/operations', (req, res) => {
  const ordersByType = db.prepare(
    `SELECT order_type, status, COUNT(*) AS n FROM orders GROUP BY order_type, status`
  ).all();
  const failedRate = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM orders WHERE status = 'failed') AS failed,
       (SELECT COUNT(*) FROM orders) AS total`
  ).get();
  const lowInventoryFlights = db.prepare(
    `SELECT f.airline, f.flight_no, f.origin, f.destination, f.flight_date,
       COUNT(*) AS total_seats, SUM(CASE WHEN fs.status = 'booked' THEN 1 ELSE 0 END) AS booked_seats
     FROM flight_seats fs JOIN flights f ON f.id = fs.flight_id
     GROUP BY f.id HAVING booked_seats * 1.0 / total_seats > 0.85
     ORDER BY booked_seats * 1.0 / total_seats DESC LIMIT 10`
  ).all();
  const propertiesNoRooms = db.prepare(
    `SELECT p.id, p.name FROM properties p WHERE NOT EXISTS (SELECT 1 FROM rooms r WHERE r.property_id = p.id)`
  ).all();
  const recentActivity = db.prepare(
    `SELECT action, meta_json, created_at FROM audit_log ORDER BY created_at DESC LIMIT 20`
  ).all();
  res.json({
    ordersByType,
    failedOrderRate: failedRate.total ? Math.round((failedRate.failed / failedRate.total) * 1000) / 10 : 0,
    lowInventoryFlights,
    propertiesNoRooms,
    recentActivity,
  });
});

module.exports = router;
