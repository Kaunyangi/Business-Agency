const { db } = require('../config/db');
const { id } = require('./helpers');

function audit(req, userId, action, meta = {}) {
  db.prepare(
    'INSERT INTO audit_log (id, user_id, action, meta_json, ip, created_at) VALUES (?,?,?,?,?,datetime(\'now\'))'
  ).run(id('aud'), userId || null, action, JSON.stringify(meta), req?.ip || 'internal');
}

module.exports = { audit };
