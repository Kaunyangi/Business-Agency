const { db } = require('./db');
const { id } = require('../utils/helpers');
const { hashPassword } = require('../utils/auth-crypto');
const revenue = require('../modules/revenue/revenue.service');

// ~30 real African locations spanning the continent — used to generate a
// large, geographically varied stays catalogue rather than hand-typing each
// property individually.
const LOCATIONS = [
  { city: 'Diani Beach', country: 'Kenya' }, { city: 'Watamu', country: 'Kenya' },
  { city: 'Lamu Old Town', country: 'Kenya' }, { city: 'Nairobi', country: 'Kenya' },
  { city: 'Naivasha', country: 'Kenya' }, { city: 'Zanzibar', country: 'Tanzania' },
  { city: 'Arusha', country: 'Tanzania' }, { city: 'Dar es Salaam', country: 'Tanzania' },
  { city: 'Kampala', country: 'Uganda' }, { city: 'Entebbe', country: 'Uganda' },
  { city: 'Kigali', country: 'Rwanda' }, { city: 'Cape Town', country: 'South Africa' },
  { city: 'Durban', country: 'South Africa' }, { city: 'Johannesburg', country: 'South Africa' },
  { city: 'Stellenbosch', country: 'South Africa' }, { city: 'Marrakech', country: 'Morocco' },
  { city: 'Essaouira', country: 'Morocco' }, { city: 'Tangier', country: 'Morocco' },
  { city: 'Accra', country: 'Ghana' }, { city: 'Cape Coast', country: 'Ghana' },
  { city: 'Lagos', country: 'Nigeria' }, { city: 'Abuja', country: 'Nigeria' },
  { city: 'Dakar', country: 'Senegal' }, { city: 'Victoria Falls', country: 'Zimbabwe' },
  { city: 'Windhoek', country: 'Namibia' }, { city: 'Swakopmund', country: 'Namibia' },
  { city: 'Hurghada', country: 'Egypt' }, { city: 'Sharm El Sheikh', country: 'Egypt' },
  { city: 'Cairo', country: 'Egypt' }, { city: 'Addis Ababa', country: 'Ethiopia' },
  { city: 'Mahé', country: 'Seychelles' }, { city: 'Port Louis', country: 'Mauritius' },
  { city: 'Praia', country: 'Cape Verde' }, { city: 'Abidjan', country: "Cote d'Ivoire" },
];

const DESCRIPTORS = [
  'Sands', 'Bay', 'Palm', 'Sunset', 'Ocean', 'Royal', 'Emerald', 'Golden', 'Blue Horizon',
  'Coral', 'Baobab', 'Savanna', 'Dune', 'Reef', 'Acacia', 'Mirage', 'Indigo', 'Amber',
  'Tembo', 'Kasa', 'Zuri', 'Nomad', 'Marula', 'Jacaranda', 'Waterfront', 'Highland',
];

// Each property type carries its own price band, capacity range, and tag pool
// so a "Boutique Resort" reads differently from an "Airbnb" apartment.
const TYPE_PROFILES = {
  Villa: { rooms: ['Garden Room', 'Ocean Suite', 'Master Villa'], priceRange: [550000, 1900000], tagPool: ['Private pool', 'Garden view', 'Sea view', 'Breakfast', 'AC', 'Chef on request'] },
  Resort: { rooms: ['Standard Room', 'Deluxe Room', 'Executive Suite'], priceRange: [700000, 2400000], tagPool: ['All-inclusive', 'Spa access', 'Beachfront', 'AC', 'Pool bar', 'Kids club'] },
  'Boutique Resort': { rooms: ['Signature Room', 'Terrace Suite', 'Owner\'s Suite'], priceRange: [900000, 3200000], tagPool: ['Design-led', 'Rooftop bar', 'Private plunge pool', 'Breakfast', 'AC', 'Concierge'] },
  Airbnb: { rooms: ['Studio', 'One-Bed Apartment', 'Loft'], priceRange: [350000, 1300000], tagPool: ['Self check-in', 'Wifi', 'Kitchen', 'Workspace', 'AC', 'Parking'] },
  Lodge: { rooms: ['Safari Tent', 'Family Cottage', 'River Suite'], priceRange: [600000, 2100000], tagPool: ['Game drives', 'Fireplace', 'Full board', 'Wifi', 'Guided walks'] },
  Guesthouse: { rooms: ['Standard Room', 'En-suite Room', 'Family Room'], priceRange: [300000, 900000], tagPool: ['Breakfast', 'Wifi', 'Fan', 'Shared lounge', 'Courtyard'] },
};
const TYPES = Object.keys(TYPE_PROFILES);

function generateProperties() {
  const properties = [];
  LOCATIONS.forEach((loc, locIdx) => {
    // Every location gets one property of each type so the catalogue reads
    // as genuinely mixed inventory (villas next to Airbnbs next to lodges),
    // not the same type repeated with a different city stapled on.
    TYPES.forEach((type, typeIdx) => {
      const descriptor = DESCRIPTORS[(locIdx * TYPES.length + typeIdx) % DESCRIPTORS.length];
      const profile = TYPE_PROFILES[type];
      const name = `${loc.city} ${descriptor} ${type}`;
      const [lo, hi] = profile.priceRange;
      const step = (hi - lo) / (profile.rooms.length - 1);
      const rooms = profile.rooms.map((roomName, i) => {
        const price = Math.round((lo + step * i) / 10000) * 10000; // round to nearest KES 100
        const cap = 2 + Math.min(i, 3);
        const tags = [profile.tagPool[i % profile.tagPool.length], profile.tagPool[(i + 2) % profile.tagPool.length], profile.tagPool[(i + 4) % profile.tagPool.length]];
        return { name: roomName, price, cap, tags: [...new Set(tags)] };
      });
      properties.push({ name, location: loc.city, country: loc.country, type, rooms });
    });
  });
  return properties;
}

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
    generateProperties().forEach((p) => {
      const propId = id('prop');
      db.prepare('INSERT INTO properties (id, name, location, country, type) VALUES (?,?,?,?,?)')
        .run(propId, p.name, p.location, p.country, p.type);
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
