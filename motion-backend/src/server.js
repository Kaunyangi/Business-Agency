require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { seed } = require('./config/seed');
const routes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 4000;

// ---- Security middleware stack ----
app.use(helmet()); // sensible security headers (HSTS, no-sniff, frameguard, etc.)
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true,
}));
app.use(express.json({ limit: '8mb' })); // capped — poster uploads are base64 but bounded

// Global rate limit — generous for browsing, tighter on auth/payment routes below.
app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

const strictLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts, slow down.' } });
app.use('/api/auth', strictLimiter);
app.use('/api/tickets/checkout', strictLimiter);
app.use('/api/flights/checkout', strictLimiter);
app.use('/api/stays/checkout', strictLimiter);
app.use('/api/wallet/topup', strictLimiter);

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'motion-backend', time: new Date().toISOString() }));

app.use('/api', routes);

// Single integrated app: the frontend is served by the same server that
// exposes the API, same origin, no CORS handshake needed in normal use.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

seed()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Motion backend listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to seed database:', err);
    process.exit(1);
  });

module.exports = app;
