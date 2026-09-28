/**
 * Strip NUL bytes from incoming JSON.
 *
 * PostgreSQL cannot store U+0000 in a `text` column, so a single NUL anywhere
 * in a request body made Prisma throw and the endpoint return HTTP 500 — on
 * signup, on creating a department, on a blog post title, on anything.
 * Every other hostile input this app was tested with (SQL-injection strings,
 * `<script>` tags, emoji, RTL text, 100k-character strings, `__proto__`) is
 * stored and returned as literal text quite happily; NUL is the one byte that
 * simply cannot be persisted.
 *
 * Dropping it is the right call rather than rejecting the request: a NUL in a
 * name or a title is never meaningful content, it is either a mistake or a
 * probe, and the rest of the value is still perfectly usable.
 */

// Built rather than written as a literal so the byte can't be mangled by an
// editor or a copy/paste on its way into this file.
const NUL_CHAR = String.fromCharCode(0);
const NUL_RE = new RegExp(NUL_CHAR, 'g');

const clean = (value, depth = 0) => {
  // Guard against a pathologically nested body
  if (depth > 12) return value;

  if (typeof value === 'string') {
    return value.indexOf(NUL_CHAR) === -1 ? value : value.replace(NUL_RE, '');
  }
  if (Array.isArray(value)) {
    return value.map((v) => clean(v, depth + 1));
  }
  if (value && typeof value === 'object') {
    // Never walk a prototype — and don't rebuild non-plain objects (Date, Buffer)
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = clean(v, depth + 1);
    return out;
  }
  return value;
};

const sanitizeInput = (req, _res, next) => {
  if (req.body && typeof req.body === 'object') req.body = clean(req.body);
  if (req.query && typeof req.query === 'object') {
    // req.query is a getter on newer Express, so assign field by field
    for (const [k, v] of Object.entries(req.query)) {
      const cleaned = clean(v);
      if (cleaned !== v) req.query[k] = cleaned;
    }
  }
  next();
};

module.exports = { sanitizeInput, clean };
