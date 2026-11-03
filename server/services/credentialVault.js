'use strict';
// Encrypts test-login passwords for storage (AES-256-GCM).
// Key: TESTNEXUS_CREDENTIAL_KEY (any long random string) — falls back to JWT_SECRET if not set.
// Changing the key makes previously saved passwords unreadable; they must then be re-entered.
const crypto = require('crypto');

const PREFIX = 'v1:';

function key() {
  const secret = process.env.TESTNEXUS_CREDENTIAL_KEY || process.env.JWT_SECRET;
  if (!secret) throw Object.assign(new Error('Set TESTNEXUS_CREDENTIAL_KEY in .env to store environment test passwords.'), { statusCode: 500 });
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

function decrypt(stored) {
  if (!stored) return '';
  if (!String(stored).startsWith(PREFIX)) throw new Error('Unsupported stored credential format.');
  const raw = Buffer.from(String(stored).slice(PREFIX.length), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
