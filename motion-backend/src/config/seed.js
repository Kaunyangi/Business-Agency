const { db, transaction } = require('./db');
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

function buildSeats(table, fkColumn, tripId, rows, cols, businessRows, letters) {
  const insert = db.prepare(`INSERT INTO ${table} (id, ${fkColumn}, row_no, letter, cabin_class, status) VALUES (?,?,?,?,?,?)`);
  let seatIndex = 0;
  for (let r = 1; r <= rows; r++) {
    const isBiz = r <= businessRows;
    for (let c = 0; c < cols; c++) {
      seatIndex++;
      // deterministic "already booked" pattern so the demo always looks realistic
      const status = seatIndex % 4 === 0 ? 'booked' : 'available';
      insert.run(id('seat'), tripId, r, letters[c], isBiz ? 'business' : 'economy', status);
    }
  }
}

function buildBusSeats(tripId, rows, cols, letters) {
  const insert = db.prepare('INSERT INTO bus_seats (id, trip_id, row_no, letter, status) VALUES (?,?,?,?,?)');
  let seatIndex = 0;
  for (let r = 1; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      seatIndex++;
      const status = seatIndex % 5 === 0 ? 'booked' : 'available';
      insert.run(id('seat'), tripId, r, letters[c], status);
    }
  }
}

// 14 consecutive dates so search-by-date reflects a real rolling schedule
// rather than three fixed rows on a single day.
const SCHEDULE_DATES = Array.from({ length: 14 }, (_, i) => {
  const d = new Date('2026-09-01T00:00:00');
  d.setDate(d.getDate() + i);
  return d.toISOString().slice(0, 10);
});

const FLIGHT_ROUTES = [
  { airline: 'Safarilink', prefix: 'FL', a: 'Nairobi Wilson', b: 'Ukunda (Diani)', dur: 65, econ: 650000, biz: null, layout: [12, 4, 0, ['A', 'B', 'C', 'D']], times: ['07:20', '15:40'] },
  { airline: 'Jambojet', prefix: 'JM', a: 'Nairobi JKIA', b: 'Mombasa Moi', dur: 70, econ: 520000, biz: null, layout: [15, 6, 0, ['A', 'B', 'C', 'D', 'E', 'F']], times: ['08:10', '17:00'] },
  { airline: 'Kenya Airways', prefix: 'KQ', a: 'Nairobi JKIA', b: 'Mombasa Moi', dur: 65, econ: 780000, biz: 1850000, layout: [15, 6, 3, ['A', 'B', 'C', 'D', 'E', 'F']], times: ['09:00'] },
  { airline: 'Jambojet', prefix: 'JM', a: 'Nairobi JKIA', b: 'Kisumu', dur: 55, econ: 540000, biz: null, layout: [15, 6, 0, ['A', 'B', 'C', 'D', 'E', 'F']], times: ['06:40'] },
  { airline: 'Kenya Airways', prefix: 'KQ', a: 'Nairobi JKIA', b: 'Eldoret', dur: 50, econ: 610000, biz: null, layout: [12, 4, 0, ['A', 'B', 'C', 'D']], times: ['12:15'] },
  { airline: 'Safarilink', prefix: 'FL', a: 'Nairobi Wilson', b: 'Malindi', dur: 80, econ: 1520000, biz: null, layout: [10, 4, 0, ['A', 'B', 'C', 'D']], times: ['08:30'] },
  { airline: 'Safarilink', prefix: 'FL', a: 'Nairobi Wilson', b: 'Lamu (Manda)', dur: 85, econ: 1690000, biz: null, layout: [8, 3, 0, ['A', 'B', 'C']], times: ['10:00'] },
  { airline: 'Skyward Express', prefix: 'SEK', a: 'Nairobi Wilson', b: 'Nanyuki', dur: 45, econ: 480000, biz: null, layout: [9, 4, 0, ['A', 'B', 'C', 'D']], times: ['09:15'] },
  { airline: 'Skyward Express', prefix: 'SEK', a: 'Nairobi Wilson', b: 'Isiolo', dur: 55, econ: 560000, biz: null, layout: [9, 4, 0, ['A', 'B', 'C', 'D']], times: ['11:00'] },
  { airline: 'Skyward Express', prefix: 'SEK', a: 'Nairobi Wilson', b: 'Marsabit', dur: 95, econ: 980000, biz: null, layout: [9, 4, 0, ['A', 'B', 'C', 'D']], times: ['07:45'] },
  { airline: 'Kenya Airways', prefix: 'KQ', a: 'Nairobi JKIA', b: 'Arusha', dur: 60, econ: 890000, biz: null, layout: [12, 4, 0, ['A', 'B', 'C', 'D']], times: ['13:30'] },
  { airline: 'Kenya Airways', prefix: 'KQ', a: 'Nairobi JKIA', b: 'Dar es Salaam', dur: 105, econ: 1450000, biz: 2900000, layout: [15, 6, 3, ['A', 'B', 'C', 'D', 'E', 'F']], times: ['14:20'] },
  { airline: 'Kenya Airways', prefix: 'KQ', a: 'Nairobi JKIA', b: 'Addis Ababa', dur: 130, econ: 1980000, biz: 4200000, layout: [15, 6, 3, ['A', 'B', 'C', 'D', 'E', 'F']], times: ['06:15'] },
];

const BUS_ROUTES = [
  { operator: 'Tahmeed', prefix: 'TH', a: 'Nairobi', b: 'Mombasa', dur: 540, fare: 180000, times: ['21:00'] },
  { operator: 'Mash Poa', prefix: 'MP', a: 'Nairobi', b: 'Mombasa', dur: 510, fare: 160000, times: ['09:30'] },
  { operator: 'Dreamline', prefix: 'DL', a: 'Nairobi', b: 'Kisumu', dur: 390, fare: 140000, times: ['08:00'] },
  { operator: 'Buscar', prefix: 'BC', a: 'Nairobi', b: 'Eldoret', dur: 300, fare: 120000, times: ['07:00'] },
  { operator: 'Mash Poa', prefix: 'MP', a: 'Nairobi', b: 'Nakuru', dur: 150, fare: 70000, times: ['10:00', '16:00'] },
  { operator: 'Tahmeed', prefix: 'TH', a: 'Nairobi', b: 'Naivasha', dur: 90, fare: 50000, times: ['08:30', '14:30'] },
  { operator: 'Dreamline', prefix: 'DL', a: 'Nairobi', b: 'Busia', dur: 420, fare: 130000, times: ['20:00'] },
  { operator: 'Buscar', prefix: 'BC', a: 'Nairobi', b: 'Kampala', dur: 750, fare: 320000, times: ['19:00'] },
  { operator: 'Tahmeed', prefix: 'TH', a: 'Nairobi', b: 'Arusha', dur: 420, fare: 280000, times: ['06:30'] },
  { operator: 'Mash Poa', prefix: 'MP', a: 'Nairobi', b: 'Dar es Salaam', dur: 1080, fare: 450000, times: ['17:00'] },
];

const SGR_ROUTES = [
  { train: 'Madaraka Express', a: 'Nairobi Terminus', b: 'Mombasa Terminus', dur: 302, econ: 150000, first: 450000, times: ['08:00', '14:35'] },
  { train: 'Inter-County Express', a: 'Nairobi Terminus', b: 'Naivasha Terminus', dur: 90, econ: 60000, first: null, times: ['06:15', '18:30'] },
];

async function seed() {
  revenue.seedRules();

  const flightCount = db.prepare('SELECT COUNT(*) AS n FROM flights').get().n;
  if (flightCount === 0) transaction(() => {
    let flightNoSeq = 100;
    FLIGHT_ROUTES.forEach((route) => {
      const [rows, cols, businessRows, letters] = route.layout;
      SCHEDULE_DATES.forEach((flightDate) => {
        route.times.forEach((departsAt) => {
          flightNoSeq += 1;
          // Outbound
          const fOut = id('flt');
          db.prepare(`INSERT INTO flights (id, airline, flight_no, origin, destination, flight_date, departs_at, duration_minutes, economy_fare_cents, business_fare_cents)
            VALUES (?,?,?,?,?,?,?,?,?,?)`).run(fOut, route.airline, `${route.prefix} ${flightNoSeq}`, route.a, route.b, flightDate, departsAt, route.dur, route.econ, route.biz);
          buildSeats('flight_seats', 'flight_id', fOut, rows, cols, businessRows, letters);

          // Return leg — same date, later same-day slot, reversed origin/destination
          flightNoSeq += 1;
          const returnTime = String(Math.min(23, parseInt(departsAt.split(':')[0], 10) + 6)).padStart(2, '0') + ':' + departsAt.split(':')[1];
          const fRet = id('flt');
          db.prepare(`INSERT INTO flights (id, airline, flight_no, origin, destination, flight_date, departs_at, duration_minutes, economy_fare_cents, business_fare_cents)
            VALUES (?,?,?,?,?,?,?,?,?,?)`).run(fRet, route.airline, `${route.prefix} ${flightNoSeq}`, route.b, route.a, flightDate, returnTime, route.dur, route.econ, route.biz);
          buildSeats('flight_seats', 'flight_id', fRet, rows, cols, businessRows, letters);
        });
      });
    });
  });

  const busCount = db.prepare('SELECT COUNT(*) AS n FROM bus_trips').get().n;
  if (busCount === 0) transaction(() => {
    let coachSeq = 100;
    BUS_ROUTES.forEach((route) => {
      SCHEDULE_DATES.forEach((tripDate) => {
        route.times.forEach((departsAt) => {
          coachSeq += 1;
          const tOut = id('bus');
          db.prepare(`INSERT INTO bus_trips (id, operator, coach_no, origin, destination, trip_date, departs_at, duration_minutes, fare_cents)
            VALUES (?,?,?,?,?,?,?,?,?)`).run(tOut, route.operator, `${route.prefix}-${coachSeq}`, route.a, route.b, tripDate, departsAt, route.dur, route.fare);
          buildBusSeats(tOut, 11, 4, ['A', 'B', 'C', 'D']);

          coachSeq += 1;
          const tRet = id('bus');
          db.prepare(`INSERT INTO bus_trips (id, operator, coach_no, origin, destination, trip_date, departs_at, duration_minutes, fare_cents)
            VALUES (?,?,?,?,?,?,?,?,?)`).run(tRet, route.operator, `${route.prefix}-${coachSeq}`, route.b, route.a, tripDate, departsAt, route.dur, route.fare);
          buildBusSeats(tRet, 11, 4, ['A', 'B', 'C', 'D']);
        });
      });
    });
  });

  const sgrCount = db.prepare('SELECT COUNT(*) AS n FROM sgr_trips').get().n;
  if (sgrCount === 0) transaction(() => {
    let trainSeq = 0;
    SGR_ROUTES.forEach((route) => {
      SCHEDULE_DATES.forEach((tripDate) => {
        route.times.forEach((departsAt) => {
          trainSeq += 1;
          const businessRows = route.first ? 3 : 0;
          const tOut = id('sgr');
          db.prepare(`INSERT INTO sgr_trips (id, operator, train_no, origin, destination, trip_date, departs_at, duration_minutes, economy_fare_cents, first_class_fare_cents)
            VALUES (?,'Kenya Railways',?,?,?,?,?,?,?,?)`).run(tOut, `ME ${trainSeq}`, route.a, route.b, tripDate, departsAt, route.dur, route.econ, route.first);
          buildSeats('sgr_seats', 'trip_id', tOut, 15, 6, businessRows, ['A', 'B', 'C', 'D', 'E', 'F']);

          trainSeq += 1;
          const tRet = id('sgr');
          db.prepare(`INSERT INTO sgr_trips (id, operator, train_no, origin, destination, trip_date, departs_at, duration_minutes, economy_fare_cents, first_class_fare_cents)
            VALUES (?,'Kenya Railways',?,?,?,?,?,?,?,?)`).run(tRet, `ME ${trainSeq}`, route.b, route.a, tripDate, departsAt, route.dur, route.econ, route.first);
          buildSeats('sgr_seats', 'trip_id', tRet, 15, 6, businessRows, ['A', 'B', 'C', 'D', 'E', 'F']);
        });
      });
    });
  });

  const propCount = db.prepare('SELECT COUNT(*) AS n FROM properties').get().n;
  if (propCount === 0) transaction(() => {
    generateProperties().forEach((p) => {
      const propId = id('prop');
      db.prepare('INSERT INTO properties (id, name, location, country, type) VALUES (?,?,?,?,?)')
        .run(propId, p.name, p.location, p.country, p.type);
      p.rooms.forEach((r) => {
        db.prepare('INSERT INTO rooms (id, property_id, name, price_cents, capacity, tags) VALUES (?,?,?,?,?,?)')
          .run(id('room'), propId, r.name, r.price, r.cap, JSON.stringify(r.tags));
      });
    });
  });

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
