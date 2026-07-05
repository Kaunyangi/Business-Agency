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
  const { origin, destination, date } = req.query;
  const clauses = [];
  const params = [];
  if (origin) { clauses.push('origin LIKE ?'); params.push(`%${origin}%`); }
  if (destination) { clauses.push('destination LIKE ?'); params.push(`%${destination}%`); }
  if (date) { clauses.push('flight_date = ?'); params.push(date); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const flights = db.prepare(`SELECT * FROM flights ${where} ORDER BY flight_date, departs_at`).all(...params);
  res.json({ flights });
});

router.get('/destinations', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT origin FROM flights UNION SELECT DISTINCT destination FROM flights ORDER BY 1').all();
  res.json({ destinations: rows.map((r) => r.origin) });
});

router.get('/:id/seats', (req, res) => {
  const flight = db.prepare('SELECT * FROM flights WHERE id = ?').get(req.params.id);
  if (!flight) return res.status(404).json({ error: 'Flight not found' });
  const seats = db.prepare('SELECT id, row_no, letter, cabin_class, status FROM flight_seats WHERE flight_id = ? ORDER BY row_no, letter').all(flight.id);
  res.json({ flight, seats });
});

const bookSchema = z.object({
  flightId: z.string(),
  seatIds: z.array(z.string()).min(1).max(9),
  returnFlightId: z.string().optional(),
  returnSeatIds: z.array(z.string()).max(9).optional(),
  paymentMethod: z.enum(['mpesa', 'card', 'wallet']),
  payerRef: z.string().min(1),
  buyerName: z.string().min(2).max(100),
  buyerPhone: z.string().min(7).max(20),
  buyerEmail: z.string().email(),
  buyerIdNumber: z.string().max(40).optional(),
}).refine((v) => !v.returnFlightId || (v.returnSeatIds && v.returnSeatIds.length > 0), {
  message: 'returnSeatIds is required when returnFlightId is set',
  path: ['returnSeatIds'],
});

function bookLeg(flightId, seatIds) {
  const flight = db.prepare('SELECT * FROM flights WHERE id = ?').get(flightId);
  if (!flight) throw Object.assign(new Error('Flight not found'), { status: 404 });

  let legSubtotalCents = 0;
  const lineItems = [];
  for (const seatId of seatIds) {
    const seat = db.prepare('SELECT * FROM flight_seats WHERE id = ? AND flight_id = ?').get(seatId, flightId);
    if (!seat) throw Object.assign(new Error(`Seat ${seatId} not found`), { status: 404 });
    if (seat.status !== 'available') throw Object.assign(new Error(`Seat ${seat.row_no}${seat.letter} is no longer available`), { status: 409 });

    db.prepare('UPDATE flight_seats SET status = ? WHERE id = ?').run('booked', seat.id);
    const fare = seat.cabin_class === 'business' ? flight.business_fare_cents : flight.economy_fare_cents;
    legSubtotalCents += fare;
    lineItems.push({ ref_type: 'flight_seat', ref_id: seat.id, description: `${flight.airline} ${flight.flight_no} · ${flight.flight_date} ${flight.departs_at} — Seat ${seat.row_no}${seat.letter} (${seat.cabin_class})`, unit_price_cents: fare, quantity: 1, line_total_cents: fare });
  }
  return { flight, lineItems, legSubtotalCents, seatIds };
}

router.post('/checkout', requireAuth, idempotent, validate(bookSchema), async (req, res, next) => {
  try {
    if (req.idempotentReplay) return res.json({ order: req.idempotentReplay, replay: true });
    const { flightId, seatIds, returnFlightId, returnSeatIds, paymentMethod, payerRef, buyerName, buyerPhone, buyerEmail, buyerIdNumber } = req.body;

    const built = transaction(() => {
      const outbound = bookLeg(flightId, seatIds);
      const legs = [outbound];
      if (returnFlightId) legs.push(bookLeg(returnFlightId, returnSeatIds));

      const lineItems = legs.flatMap((l) => l.lineItems);
      const subtotalCents = legs.reduce((s, l) => s + l.legSubtotalCents, 0);
      const totalSeats = legs.reduce((s, l) => s + l.seatIds.length, 0);

      const taxesCents = totalSeats * 120000; // KES 1,200 pass-through tax per passenger, not platform revenue
      const { amountCents: commissionCents, ruleKey } = revenue.computeCommission('flight', subtotalCents);
      const totalCents = subtotalCents + taxesCents;

      const orderId = id('ord');
      db.prepare(
        `INSERT INTO orders (id, user_id, order_type, status, subtotal_cents, commission_cents, fees_cents, total_cents, idempotency_key, buyer_name, buyer_phone, buyer_email, buyer_id_number, created_at)
         VALUES (?,?, 'flight', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(orderId, req.user.id, subtotalCents, commissionCents, taxesCents, totalCents, req.idempotencyKey || null, buyerName, buyerPhone, buyerEmail, buyerIdNumber || null);

      const insertItem = db.prepare('INSERT INTO order_items (id, order_id, ref_type, ref_id, description, unit_price_cents, quantity, line_total_cents) VALUES (?,?,?,?,?,?,?,?)');
      lineItems.forEach((li) => insertItem.run(id('item'), orderId, li.ref_type, li.ref_id, li.description, li.unit_price_cents, li.quantity, li.line_total_cents));
      insertItem.run(id('item'), orderId, 'tax', null, 'Airport taxes & fees', taxesCents, 1, taxesCents);

      const allSeatIds = legs.flatMap((l) => l.seatIds);
      return { orderId, totalCents, ruleKey, commissionCents, outbound, legs, allSeatIds };
    });

    const legDescription = built.legs.length > 1
      ? `${built.outbound.flight.airline} ${built.outbound.flight.flight_no} round-trip`
      : `${built.outbound.flight.airline} ${built.outbound.flight.flight_no}`;
    const paymentResult = await charge({ method: paymentMethod, amountCents: built.totalCents, payerRef, description: `Motion flight — ${legDescription}` });

    if (paymentResult.status !== 'success') {
      transaction(() => {
        built.allSeatIds.forEach((sid) => db.prepare('UPDATE flight_seats SET status = ? WHERE id = ?').run('available', sid));
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

    audit(req, req.user.id, 'flight.book', { orderId: built.orderId, totalCents: built.totalCents });
    res.status(201).json({ order, items: orderItems, payment, receiptId: receipt.id });
  } catch (err) { next(err); }
});

module.exports = router;
