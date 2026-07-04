const express = require('express');
const router = express.Router();

router.use('/auth', require('../modules/auth/auth.routes'));
router.use('/wallet', require('../modules/wallet/wallet.routes'));
router.use('/events', require('../modules/events/events.routes'));
router.use('/tickets', require('../modules/tickets/tickets.routes'));
router.use('/flights', require('../modules/flights/flights.routes'));
router.use('/stays', require('../modules/stays/stays.routes'));
router.use('/revenue', require('../modules/revenue/revenue.routes'));
router.use('/documents', require('../modules/documents/documents.routes'));

module.exports = router;
