/**
 * Crypto Helper
 *
 * Symmetric encryption for secrets we must be able to show back to the customer
 * (a deployment's API key), as opposed to passwords which are one-way hashed.
 *
 * The key is derived from CREDENTIAL_ENCRYPTION_KEY, falling back to JWT_SECRET
 * so existing installs keep working without a new env var. Rotating either
 * secret makes previously stored ciphertexts unreadable — decrypt() returns
 * null rather than throwing so an admin can simply re-enter the key.
 */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96-bit nonce, the GCM standard
const TAG_LENGTH = 16;

const getKey = () => {
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY or JWT_SECRET must be set to store credentials');
  }
  // Normalise any-length secret into a 32-byte key
  return crypto.createHash('sha256').update(String(secret)).digest();
};

/**
 * Encrypt a plaintext secret. Returns "iv:tag:ciphertext" in base64.
 */
const encrypt = (plainText) => {
  if (plainText === null || plainText === undefined || plainText === '') return '';

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(String(plainText), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
};

/**
 * Decrypt a value produced by encrypt(). Returns null if it can't be read
 * (tampered, or encrypted under a different secret).
 */
const decrypt = (payload) => {
  if (!payload) return '';

  try {
    const [ivB64, tagB64, dataB64] = String(payload).split(':');
    if (!ivB64 || !tagB64 || !dataB64) return null;

    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      getKey(),
      Buffer.from(ivB64, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (err) {
    console.error('[CryptoHelper] Failed to decrypt credential:', err.message);
    return null;
  }
};

/**
 * Display form of a secret: "sk-abc…wxyz". Safe to store and return in lists.
 */
const mask = (secret) => {
  if (!secret) return '';
  const value = String(secret);
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}${'•'.repeat(8)}${value.slice(-4)}`;
};

/**
 * Generate an API key for a deployment when the admin doesn't supply one.
 */
const generateApiKey = (prefix = 'aio') => {
  return `${prefix}-${crypto.randomBytes(24).toString('hex')}`;
};

module.exports = {
  encrypt,
  decrypt,
  mask,
  generateApiKey,
  TAG_LENGTH,
};
