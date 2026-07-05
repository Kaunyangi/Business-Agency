const express = require('express');
const { z } = require('zod');
const { db, transaction } = require('../../config/db');
const { id } = require('../../utils/helpers');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { idempotent } = require('../../middleware/idempotency');
const { charge } = require('../payments/providers');
const revenue = require('../revenue/revenue.service');
const documents = require('../documents/documents.service');
const { audit } = require('../../utils/audit');

const router = express.Router();

router.get('/', (req, res) => {
  const properties = db.prepare('SELECT * FROM properties').all();
  const withRooms = properties.map((p) => ({
    ...p,
    rooms: db.prepare('SELECT * FROM rooms WHERE property_id = ?').all(p.id).map((r) => ({ ...r, tags: JSON.parse(r.tags || '[]') })),
  }));
  res.json({ properties: withRooms });
});

const roomSchema = z.object({
  name: z.string().min(1).max(60),
  price_cents: z.number().int().nonnegative(),
  capacity: z.number().int().positive(),
  tags: z.array(z.string().max(30)).max(8).default([]),
});

const propertySchema = z.object({
  name: z.string().min(2).max(120),
  location: z.string().min(2).max(120),
  country: z.string().min(2).max(80),
  type: z.string().max(40).default('Villa'),
  rooms: z.array(roomSchema).min(1, 'At least one room is required'),
});

// Host-only — list a new property with its room inventory in one call.
router.post('/', requireAuth, requireRole('host', 'admin'), validate(propertySchema), (req, res, next) => {
  try {
    const body = req.body;
    const propId = id('prop');

    transaction(() => {
      db.prepare('INSERT INTO properties (id, name, location, country, type, owner_id) VALUES (?,?,?,?,?,?)')
        .run(propId, body.name, body.location, body.country, body.type, req.user.id);

      const insertRoom = db.prepare('INSERT INTO rooms (id, property_id, name, price_cents, capacity, tags) VALUES (?,?,?,?,?,?)');
      body.rooms.forEach((r) => insertRoom.run(id('room'), propId, r.name, r.price_cents, r.capacity, JSON.stringify(r.tags)));
    });

    audit(req, req.user.id, 'property.list', { propId, rooms: body.rooms.length });
    const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(propId);
    property.rooms = db.prepare('SELECT * FROM rooms WHERE property_id = ?').all(propId).map((r) => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
    res.status(201).json({ property });
  } catch (err) { next(err); }
});

// Host dashboard — their own listed properties + booking activity.
router.get('/mine/dashboard', requireAuth, requireRole('host', 'admin'), (req, res) => {
  const properties = db.prepare('SELECT * FROM properties WHERE owner_id = ? ORDER BY id DESC').all(req.user.id);
  const withStats = properties.map((p) => {
    const rooms = db.prepare('SELECT * FROM rooms WHERE property_id = ?').all(p.id).map((r) => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
    const bookingsCount = db.prepare(
      `SELECT COUNT(*) AS n FROM room_bookings rb JOIN rooms r ON r.id = rb.room_id WHERE r.property_id = ? AND rb.status = 'confirmed'`
    ).get(p.id).n;
    return { ...p, rooms, bookingsCount };
  });
  res.json({ properties: withStats });
});

function nightsBetween(checkin, checkout) {
  const a = new Date(checkin), b = new Date(checkout);
  return Math.round((b - a) / 86400000);
}

function roomIsBooked(roomId, checkin, checkout) {
  // Overlap check: existing.checkin < new.checkout AND existing.checkout > new.checkin
  const overlap = db
    .prepare(
      `SELECT COUNT(*) AS n FROM room_bookings
       WHERE room_id = ? AND status = 'confirmed' AND checkin < ? AND checkout > ?`
    )
    .get(roomId, checkout, checkin);
  return overlap.n > 0;
}

const bookSchema = z.object({
  roomId: z.string(),
  checkin: z.string(),
  checkout: z.string(),
  guests: z.number().int().positive(),
  paymentMethod: z.enum(['mpesa', 'card', 'wallet']),
  payerRef: z.string().min(1),
  buyerName: z.string().min(2).max(100),
  buyerPhone: z.string().min(7).max(20),
  buyerEmail: z.string().email(),
  buyerIdNumber: z.string().max(40).optional(),
});

router.post('/checkout', requireAuth, idempotent, validate(bookSchema), async (req, res, next) => {
  try {
    if (req.idempotentReplay) return res.json({ order: req.idempotentReplay, replay: true });
    const { roomId, checkin, checkout, guests, paymentMethod, payerRef, buyerName, buyerPhone, buyerEmail, buyerIdNumber } = req.body;
    const nights = nightsBetween(checkin, checkout);
    if (nights <= 0) return res.status(400).json({ error: 'Check-out must be after check-in' });

    const built = transaction(() => {
      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
      if (!room) throw Object.assign(new Error('Room not found'), { status: 404 });
      if (guests > room.capacity) throw Object.assign(new Error(`This room sleeps ${room.capacity}`), { status: 400 });
      // The date-range overlap check IS the "inventory lock" for accommodation —
      // done inside the same write transaction as the booking insert so two
      // concurrent bookings for the same dates can't both succeed.
      if (roomIsBooked(roomId, checkin, checkout)) {
        throw Object.assign(new Error('Room is no longer available for those dates'), { status: 409 });
      }

      const subtotalCents = room.price_cents * nights;
      // Unlike ticket/flight commission (deducted from the payee's payout, invisible
      // to the buyer), the stay commission is a buyer-facing Motion service fee —
      // summed straight into the total the guest pays.
      const { amountCents: commissionCents, ruleKey } = revenue.computeCommission('stay', subtotalCents);
      const totalCents = subtotalCents + commissionCents;

      const orderId = id('ord');
      db.prepare(
        `INSERT INTO orders (id, user_id, order_type, status, subtotal_cents, commission_cents, fees_cents, total_cents, idempotency_key, buyer_name, buyer_phone, buyer_email, buyer_id_number, created_at)
         VALUES (?,?, 'stay', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(orderId, req.user.id, subtotalCents, commissionCents, commissionCents, totalCents, req.idempotencyKey || null, buyerName, buyerPhone, buyerEmail, buyerIdNumber || null);

      db.prepare('INSERT INTO order_items (id, order_id, ref_type, ref_id, description, unit_price_cents, quantity, line_total_cents) VALUES (?,?,?,?,?,?,?,?)')
        .run(id('item'), orderId, 'room', room.id, `${room.name} — ${nights} night(s)`, room.price_cents, nights, subtotalCents);
      db.prepare('INSERT INTO order_items (id, order_id, ref_type, ref_id, description, unit_price_cents, quantity, line_total_cents) VALUES (?,?,?,?,?,?,?,?)')
        .run(id('item'), orderId, 'fee', null, 'Motion service fee (8%)', commissionCents, 1, commissionCents);

      // Provisionally reserve the booking now; on payment failure we delete it.
      db.prepare('INSERT INTO room_bookings (id, room_id, order_id, checkin, checkout, guests, status) VALUES (?,?,?,?,?,?, \'confirmed\')')
        .run(id('bkg'), roomId, orderId, checkin, checkout, guests);

      return { orderId, totalCents, ruleKey, commissionCents, room };
    });

    const paymentResult = await charge({ method: paymentMethod, amountCents: built.totalCents, payerRef, description: `Motion stay — ${built.room.name}` });

    if (paymentResult.status !== 'success') {
      transaction(() => {
        db.prepare('DELETE FROM room_bookings WHERE order_id = ?').run(built.orderId);
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('failed', built.orderId);
      });
      return res.status(402).json({ error: 'Payment failed', detail: paymentResult.raw });
    }

    transaction(() => {
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('paid', built.orderId);
      db.prepare('INSERT INTO payments (id, order_id, provider, provider_ref, status, amount_cents, created_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))').run(id('pay'), built.orderId, paymentMethod, paymentResult.providerRef, 'success', built.totalCents);
      revenue.recordLedgerEntry(built.orderId, built.ruleKey, built.commissionCents);
    });

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(built.orderId);
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(built.orderId);
    const payment = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(built.orderId);
    const buyer = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const receipt = documents.generateReceipt(order, orderItems, payment, buyer);

    audit(req, req.user.id, 'stay.book', { orderId: built.orderId, totalCents: built.totalCents });
    res.status(201).json({ order, items: orderItems, payment, receiptId: receipt.id });
  } catch (err) { next(err); }
});

module.exports = router;
