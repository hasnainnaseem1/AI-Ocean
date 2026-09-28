#!/usr/bin/env node
/**
 * Guards the part of the design system the two apps still share.
 *
 * `src/theme/colors.js` used to be a whole-file mirror of the customer
 * center's copy. It no longer is: the admin console deliberately owns its own
 * surfaces (neutral grey / near-black, versus the customer center's lavender
 * ground), its own text ramp, its own elevation and its own density. Those
 * are supposed to differ, and diffing them would only produce noise.
 *
 * What must NOT drift is the brand identity — same product, same accent. So
 * this compares the specific exports below, by value, rather than a contiguous
 * slice of the file. That also makes it robust to the two files ordering their
 * declarations differently, which they now do.
 *
 *   npm run verify:tokens
 */
const fs = require('fs');
const path = require('path');

/** Brand identity — these are the exports that must stay identical. */
const SHARED = ['BRAND', 'BRAND_DARK', 'ACCENT', 'ACCENT_DARK', 'GRADIENT', 'TILE'];

const MINE = path.join(__dirname, '..', 'src', 'theme', 'colors.js');
const THEIRS = path.join(__dirname, '..', '..', 'frontend-customer-center', 'src', 'theme', 'colors.js');

const read = (p) => {
  if (!fs.existsSync(p)) {
    console.error(`verify:tokens — file not found: ${p}`);
    process.exit(2);
  }
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
};

/**
 * Pulls one `export const NAME = <value>;` out of a source file.
 *
 * Values here are either a single-quoted string or a brace-delimited object, so
 * the terminator is a `;` at the start-of-line-or-after-a-brace — good enough
 * for this frozen, hand-written data file, and it fails loudly (returns null)
 * rather than silently half-matching if that ever stops being true.
 */
const extract = (src, name) => {
  const start = src.indexOf(`export const ${name} =`);
  if (start === -1) return null;
  const eq = src.indexOf('=', start) + 1;
  const rest = src.slice(eq);
  const end = rest.indexOf('\n};') !== -1 && rest.indexOf('\n};') < rest.indexOf(';\n')
    ? rest.indexOf('\n};') + 3
    : rest.indexOf(';') + 1;
  if (end <= 0) return null;
  // Normalise whitespace and strip trailing line comments so a reflow or a
  // reworded comment is not reported as a colour change.
  return rest
    .slice(0, end)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const mineSrc = read(MINE);
const theirsSrc = read(THEIRS);

const problems = [];
for (const name of SHARED) {
  const a = extract(mineSrc, name);
  const b = extract(theirsSrc, name);
  if (a === null || b === null) {
    problems.push(`  ${name}: not found in ${a === null ? 'admin' : 'customer center'} copy`);
  } else if (a !== b) {
    problems.push(`  ${name} has drifted:\n      admin    : ${a}\n      customer : ${b}`);
  }
}

if (problems.length === 0) {
  console.log(`verify:tokens — OK, brand tokens in sync (${SHARED.join(', ')}).`);
  process.exit(0);
}

console.error('verify:tokens — BRAND TOKENS HAVE DRIFTED.\n');
console.error(problems.join('\n'));
console.error('\n  These are the exports both apps must agree on. Surfaces, text ramp,');
console.error('  elevation and density are intentionally admin-only and are not compared.');
process.exit(1);
