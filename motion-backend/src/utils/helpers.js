const { randomUUID } = require('crypto');

const id = (prefix) => `${prefix}_${randomUUID()}`;

const toCents = (kes) => Math.round(Number(kes) * 100);
const toKES = (cents) => Math.round(Number(cents)) / 100;
const fmtKES = (cents) => `KES ${toKES(cents).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

module.exports = { id, toCents, toKES, fmtKES };
