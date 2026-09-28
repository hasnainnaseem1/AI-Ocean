#!/usr/bin/env node
/**
 * Translation-file gate.
 *
 * English is the reference: it is bundled at `src/i18n/locales/en/` and every
 * missing key anywhere falls back to it. Every other language lives under
 * `public/locales/<lng>/` and is checked against that reference.
 *
 * Two failures, and only the first one stops the build:
 *
 *   EXTRA  — a key exists in a translation but not in English. This is an
 *            error: it is dead weight at best, and usually a renamed key that
 *            was never cleaned up, which means the live UI is silently falling
 *            back to English for the new name while the old one sits there
 *            looking translated.
 *   MISSING — a key exists in English but not in a translation. Reported and
 *            counted, but not fatal, because a language being part-translated
 *            is a normal state: i18next falls back per key, so the page is
 *            correct either way. Pass --strict to fail on these too, which is
 *            what a release check should do.
 *
 * Plural keys (`thing_one`, `thing_other`, `thing_few`, …) are compared on
 * their base name, because the set of plural forms legitimately differs by
 * language: Arabic has six, Chinese has one, English has two. Demanding an
 * identical key list across languages would be demanding the wrong thing.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EN_DIR = path.join(ROOT, 'src', 'i18n', 'locales', 'en');
const PUBLIC_DIR = path.join(ROOT, 'public', 'locales');
const STRICT = process.argv.includes('--strict');

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Every leaf path in an object, as `a.b.c`, with plural suffixes stripped. */
const leafKeys = (obj, prefix = '', out = new Set()) => {
  Object.entries(obj || {}).forEach(([k, v]) => {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) leafKeys(v, full, out);
    else out.add(full.replace(PLURAL_SUFFIX, ''));
  });
  return out;
};

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`  ✖ ${path.relative(ROOT, file)} is not valid JSON — ${err.message}`);
    return null;
  }
};

if (!fs.existsSync(EN_DIR)) {
  console.error(`No English catalogue at ${path.relative(ROOT, EN_DIR)}`);
  process.exit(1);
}

const namespaces = fs.readdirSync(EN_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const reference = {};
let broken = false;

namespaces.forEach((ns) => {
  const json = readJson(path.join(EN_DIR, `${ns}.json`));
  if (json === null) { broken = true; return; }
  reference[ns] = leafKeys(json);
});

if (broken) process.exit(1);

const refTotal = Object.values(reference).reduce((n, s) => n + s.size, 0);
console.log(`English reference: ${namespaces.length} namespaces, ${refTotal} keys\n`);

const languages = fs.existsSync(PUBLIC_DIR)
  ? fs.readdirSync(PUBLIC_DIR).filter((d) => fs.statSync(path.join(PUBLIC_DIR, d)).isDirectory())
  : [];

if (!languages.length) {
  console.log('No translated languages yet — nothing to check.');
  process.exit(0);
}

let hardFailures = 0;
let softFailures = 0;

languages.forEach((lng) => {
  if (lng === 'en') {
    console.error(`✖ ${lng}: English must not live in public/locales — it is bundled from src/i18n/locales/en.`);
    hardFailures += 1;
    return;
  }

  let missing = 0;
  let extra = 0;
  const notes = [];

  namespaces.forEach((ns) => {
    const file = path.join(PUBLIC_DIR, lng, `${ns}.json`);
    if (!fs.existsSync(file)) {
      missing += reference[ns].size;
      if (reference[ns].size) notes.push(`    ${ns}: file absent (${reference[ns].size} keys fall back)`);
      return;
    }
    const json = readJson(file);
    if (json === null) { hardFailures += 1; return; }

    const keys = leafKeys(json);
    const miss = [...reference[ns]].filter((k) => !keys.has(k));
    const ext = [...keys].filter((k) => !reference[ns].has(k));

    missing += miss.length;
    extra += ext.length;
    if (miss.length) notes.push(`    ${ns}: ${miss.length} missing — ${miss.slice(0, 4).join(', ')}${miss.length > 4 ? ', …' : ''}`);
    if (ext.length) notes.push(`    ${ns}: ${ext.length} NOT IN ENGLISH — ${ext.slice(0, 4).join(', ')}${ext.length > 4 ? ', …' : ''}`);
  });

  const complete = refTotal ? Math.round(((refTotal - missing) / refTotal) * 100) : 100;
  const mark = extra > 0 ? '✖' : (missing > 0 ? '!' : '✔');
  console.log(`${mark} ${lng.padEnd(6)} ${String(complete).padStart(3)}% translated  (${missing} missing, ${extra} extra)`);
  notes.forEach((n) => console.log(n));

  if (extra > 0) hardFailures += 1;
  if (missing > 0) softFailures += 1;
});

console.log('');
if (hardFailures) {
  console.error(`Failed: ${hardFailures} language(s) have keys English does not, or unreadable files.`);
  process.exit(1);
}
if (STRICT && softFailures) {
  console.error(`Failed (--strict): ${softFailures} language(s) are incomplete.`);
  process.exit(1);
}
console.log(softFailures ? 'OK — incomplete languages fall back to English per key.' : 'OK — all languages complete.');
