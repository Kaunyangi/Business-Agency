const { db } = require('./db');
const { id } = require('../utils/helpers');
const { hashPassword } = require('../utils/auth-crypto');
const revenue = require('../modules/revenue/revenue.service');

function buildSeats(flightId, rows, cols, businessRows, letters) {
  const insert = db.prepare('INSERT INTO flight_seats (id, flight_id, row_no, letter, cabin_class, status) VALUES (?,?,?,?,?,?)');
  let seatIndex = 0;
  for (let r = 1; r <= rows; r++) {
    const isBiz = r <= businessRows;
    for (let c = 0; c < cols; c++) {
      seatIndex++;
      // deterministic "already booked" pattern so the demo always looks realistic
      const status = seatIndex % 4 === 0 ? 'booked' : 'available';
      insert.run(id('seat'), flightId, r, letters[c], isBiz ? 'business' : 'economy', status);
    }
  }
}

async function seed() {
  revenue.seedRules();

  const flightCount = db.prepare('SELECT COUNT(*) AS n FROM flights').get().n;
  if (flightCount === 0) {
    const f1 = id('flt');
    db.prepare(`INSERT INTO flights (id, airline, flight_no, origin, destination, flight_date, departs_at, duration_minutes, economy_fare_cents, business_fare_cents)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(f1, 'Safarilink', 'FL 1204', 'Nairobi Wilson', 'Ukunda (Diani)', '2026-09-12', '07:20', 65, 650000, null);
    buildSeats(f1, 12, 4, 0, ['A', 'B', 'C', 'D']);

    const f2 = id('flt');
    db.prepare(`INSERT INTO flights (id, airline, flight_no, origin, destination, flight_date, departs_at, duration_minutes, economy_fare_cents, business_fare_cents)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(f2, 'Jambojet', 'JM 220', 'Nairobi JKIA', 'Mombasa Moi', '2026-09-12', '08:10', 70, 520000, null);
    buildSeats(f2, 15, 6, 0, ['A', 'B', 'C', 'D', 'E', 'F']);

    const f3 = id('flt');
    db.prepare(`INSERT INTO flights (id, airline, flight_no, origin, destination, flight_date, departs_at, duration_minutes, economy_fare_cents, business_fare_cents)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(f3, 'Kenya Airways', 'KQ 610', 'Nairobi JKIA', 'Mombasa Moi', '2026-09-12', '09:00', 65, 780000, 1850000);
    buildSeats(f3, 15, 6, 3, ['A', 'B', 'C', 'D', 'E', 'F']);
  }

  const propCount = db.prepare('SELECT COUNT(*) AS n FROM properties').get().n;
  if (propCount === 0) {
    const properties = [
      { name: 'Diani Sands Villa', location: 'Diani Beach', rooms: [
        { name: 'Garden Standard', price: 650000, cap: 2, tags: ['Fan', 'Garden view', 'Breakfast'] },
        { name: 'Ocean Deluxe', price: 1120000, cap: 3, tags: ['AC', 'Sea view', 'Breakfast'] },
        { name: 'Beachfront Suite', price: 1890000, cap: 4, tags: ['AC', 'Private deck', 'Butler'] },
      ]},
      { name: 'Lamu Beach House', location: 'Lamu Old Town', rooms: [
        { name: 'Swahili Room', price: 540000, cap: 2, tags: ['Fan', 'Courtyard'] },
        { name: 'Rooftop Room', price: 980000, cap: 2, tags: ['AC', 'Rooftop access'] },
        { name: 'Family Wing', price: 1560000, cap: 5, tags: ['AC', '2 bedrooms', 'Kitchen'] },
      ]},
      { name: 'Nairobi Loft', location: 'Westlands', rooms: [
        { name: 'City Studio', price: 720000, cap: 2, tags: ['AC', 'Workspace', 'Wifi'] },
        { name: 'Executive Loft', price: 1250000, cap: 2, tags: ['AC', 'Skyline view', 'Wifi'] },
        { name: 'Penthouse', price: 2400000, cap: 4, tags: ['AC', 'Rooftop', 'Parking'] },
      ]},
    ];
    properties.forEach((p) => {
      const propId = id('prop');
      db.prepare('INSERT INTO properties (id, name, location) VALUES (?,?,?)').run(propId, p.name, p.location);
      p.rooms.forEach((r) => {
        db.prepare('INSERT INTO rooms (id, property_id, name, price_cents, capacity, tags) VALUES (?,?,?,?,?,?)')
          .run(id('room'), propId, r.name, r.price, r.cap, JSON.stringify(r.tags));
      });
    });
  }

  const adminEmail = 'admin@motion.africa';
  const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!adminExists) {
    const passwordHash = await hashPassword('ChangeMe123!');
    db.prepare(`INSERT INTO users (id, name, email, password_hash, role, wallet_balance_cents, created_at) VALUES (?,?,?,?,?,0,datetime('now'))`)
      .run(id('usr'), 'Motion Admin', adminEmail, passwordHash, 'admin');
    console.log(`Seeded admin account: ${adminEmail} / ChangeMe123!  (change this immediately in any real deployment)`);
  }
}

module.exports = { seed };
