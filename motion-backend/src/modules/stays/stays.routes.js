const express = require('express');
const { z } = require('zod');
const { db, transaction } = require('../../config/db');
const { id } = require('../../utils/helpers');
const { requireAuth } = require('../../middleware/auth');
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
});

router.post('/checkout', requireAuth, idempotent, validate(bookSchema), async (req, res, next) => {
  try {
    if (req.idempotentReplay) return res.json({ order: req.idempotentReplay, replay: true });
    const { roomId, checkin, checkout, guests, paymentMethod, payerRef } = req.body;
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
      const feeCents = Math.round(subtotalCents * 0.06); // service fee, pass-through
      const { amountCents: commissionCents, ruleKey } = revenue.computeCommission('stay', subtotalCents);
      const totalCents = subtotalCents + feeCents;

      const orderId = id('ord');
      db.prepare(
        `INSERT INTO orders (id, user_id, order_type, status, subtotal_cents, commission_cents, fees_cents, total_cents, idempotency_key, created_at)
         VALUES (?,?, 'stay', 'pending', ?, ?, ?, ?, ?, datetime('now'))`
      ).run(orderId, req.user.id, subtotalCents, commissionCents, feeCents, totalCents, req.idempotencyKey || null);

      db.prepare('INSERT INTO order_items (id, order_id, ref_type, ref_id, description, unit_price_cents, quantity, line_total_cents) VALUES (?,?,?,?,?,?,?,?)')
        .run(id('item'), orderId, 'room', room.id, `${room.name} — ${nights} night(s)`, room.price_cents, nights, subtotalCents);
      db.prepare('INSERT INTO order_items (id, order_id, ref_type, ref_id, description, unit_price_cents, quantity, line_total_cents) VALUES (?,?,?,?,?,?,?,?)')
        .run(id('item'), orderId, 'fee', null, 'Service fee', feeCents, 1, feeCents);

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
