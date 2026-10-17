/**
 * CSV, escaped properly, in one place.
 *
 * ── Why this exists ──
 *
 * The exports already in the admin routes build their rows by hand, roughly
 * as `` `${a},"${b}",${c}` ``. That works until a field contains a quote, a
 * comma or a newline — and the fields being exported here are account names,
 * support subjects and churn reason sentences, every one of which can contain
 * all three. The failure is quiet and nasty: the file opens, the columns shift
 * from one row onward, and whoever reads it believes it.
 *
 * RFC 4180 in full: a field is quoted if it contains a quote, a comma, a
 * newline or leading/trailing space, and a quote inside is doubled.
 *
 * ── Two things that are not just cosmetic ──
 *
 *  • **The BOM.** Excel on Windows reads a BOM-less UTF-8 file as the system
 *    codepage, so every non-ASCII account name arrives mangled. Three bytes
 *    fixes it and nothing else reads them as content.
 *  • **The formula guard.** A field starting `=`, `+`, `-` or `@` is executed
 *    by Excel and Sheets when the file is opened. A customer who names their
 *    organization `=HYPERLINK(...)` has written a payload into a spreadsheet
 *    an operator will open. Prefixing a tab neutralises it and is invisible in
 *    the cell.
 */

const RISKY_FIRST_CHARS = ['=', '+', '-', '@', '\t', '\r'];

const escapeField = (value) => {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);

  // Neutralise spreadsheet formula injection before quoting, so the guard is
  // inside the quotes rather than confusing the parser.
  if (text.length && RISKY_FIRST_CHARS.includes(text[0])) text = `\t${text}`;

  if (/["\n\r,]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

/**
 * `toCsv(rows, columns)` → a CSV string with a header row.
 *
 * `columns` is `[{ key, label, value? }]`. `value(row)` lets a column be
 * derived without the caller flattening its data first.
 */
const toCsv = (rows, columns) => {
  const header = columns.map((c) => escapeField(c.label ?? c.key)).join(',');
  const body = (rows || []).map((row) => columns
    .map((c) => escapeField(c.value ? c.value(row) : row[c.key]))
    .join(',')).join('\r\n');
  return body ? `${header}\r\n${body}` : header;
};

/**
 * A value safe to put in a `Content-Disposition` filename.
 *
 * Several exports build their filename out of a customer's or an admin's own
 * name, which is text somebody else chose. A double quote in it closes the
 * quoted filename early and the browser saves a truncated name; a slash or a
 * control character is worse. Node already refuses CR and LF in a header
 * value, so this is about the file arriving correctly named rather than about
 * header injection — but it is one call either way.
 *
 * Deliberately a whitelist: the set of characters that are safe in a filename
 * on every platform is much smaller than the set that is dangerous, and a
 * blacklist is the version that misses one.
 */
const safeFilename = (name, fallback = 'export.csv') => {
  const cleaned = String(name || '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 150);
  return cleaned || fallback;
};

/**
 * Send a CSV as a download, with the BOM Excel needs to read UTF-8.
 *
 * The filename only reaches the browser's JavaScript because `app.js` lists
 * `Content-Disposition` in the CORS `exposedHeaders` — it is not one of the
 * headers a cross-origin fetch may read by default. That is set once there
 * rather than here, because every other download on the platform (user and
 * customer exports, activity logs, invoice PDFs) needs it too and six copies
 * is five chances to forget.
 */
const sendCsv = (res, filename, csv) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}"`);
  res.send(`﻿${csv}`);
};

module.exports = {
  escapeField, toCsv, sendCsv, safeFilename,
};
