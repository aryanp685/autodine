/**
 * AutoDine backup encryption — AES-256-GCM over gzip.
 *
 * File layout (all big-endian, no padding):
 *   magic   8 bytes   'ADBK01\n'
 *   salt    16 bytes  scrypt salt
 *   iv      12 bytes  GCM nonce
 *   tag     16 bytes  GCM auth tag
 *   ct      rest      ciphertext of gzipped payload
 *
 * Key derivation: scrypt(passphrase, salt, 32, { N: 2**14, r: 8, p: 1 }).
 * Losing the passphrase loses the backup — that is the point of it.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

const MAGIC = Buffer.from('ADBK01\n', 'utf8');
const SALT = 16, IV = 12, TAG = 16;

export function encryptBuffer(plaintext, passphrase) {
  if (!passphrase || passphrase.length < 12) {
    throw new Error('Backup passphrase must be at least 12 characters; use a password manager.');
  }
  const salt = randomBytes(SALT);
  const iv = randomBytes(IV);
  const key = scryptSync(passphrase, salt, 32, { N: 2 ** 14, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(gzipSync(plaintext, { level: 9 })), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, ct]);
}

export function decryptBuffer(payload, passphrase) {
  if (!Buffer.isBuffer(payload) || payload.length < MAGIC.length + SALT + IV + TAG + 1) {
    throw new Error('Not an AutoDine backup file (too short).');
  }
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Not an AutoDine backup file (bad magic).');
  }
  let off = MAGIC.length;
  const salt = payload.subarray(off, off + SALT); off += SALT;
  const iv = payload.subarray(off, off + IV); off += IV;
  const tag = payload.subarray(off, off + TAG); off += TAG;
  const ct = payload.subarray(off);
  const key = scryptSync(passphrase, salt, 32, { N: 2 ** 14, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return gunzipSync(Buffer.concat([decipher.update(ct), decipher.final()]));
  } catch {
    // Wrong passphrase and tampering are deliberately indistinguishable.
    throw new Error('Decryption failed: wrong passphrase or corrupted/tampered file.');
  }
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
