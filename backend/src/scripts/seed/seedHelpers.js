/**
 * Shared plumbing for the seed scripts.
 *
 * Every seed follows the same shape: connect, walk a list of rows keyed by a
 * natural key, create the missing ones and refresh the rest — but never
 * overwrite anything a human has since edited in the Admin Center, unless
 * `--force` is passed. `updatedById` is only ever set by the admin PUT routes,
 * so it is an exact "a person has touched this" marker.
 *
 * Each script used to hand-roll this for itself.
 * Keeping it in one place means porting the next one is a two-line change.
 */
const prisma = require('../../lib/prismaClient');

/** Fail fast on a bad DATABASE_URL rather than midway through a seed. */
const connect = async () => {
  await prisma.$queryRaw`SELECT 1`;
  console.log('Connected to Postgres');
};

const disconnect = async () => prisma.$disconnect();

/** True when the caller passed --force on the command line. */
const isForced = () => process.argv.includes('--force');

/**
 * Create-or-refresh a set of rows keyed by a natural unique column.
 *
 * @param {string}   model      Prisma delegate name, e.g. 'useCaseTag'
 * @param {string}   keyField   the unique column, e.g. 'key' or 'slug'
 * @param {object[]} rows       the seed data
 * @param {object}   [opts]
 * @param {boolean}  [opts.force]        overwrite even human-edited rows
 * @param {boolean}  [opts.respectEdits] honour `updatedById` (default true)
 * @param {Function} [opts.label]        row -> a line of log text
 * @param {object}   [opts.via]          route writes through a domain service
 *                                       instead of raw Prisma — needed wherever
 *                                       the service derives fields the seed
 *                                       data doesn't carry (QuestionTemplate's
 *                                       `affectsSizing`, BlogPost's `readTime`).
 *                                       Shape: { create(data), update(existing, data) }
 */
const upsertAll = async (model, keyField, rows, opts = {}) => {
  const {
    force = isForced(), respectEdits = true, label = (r) => r[keyField], via = null,
  } = opts;
  const delegate = prisma[model];
  if (!delegate) throw new Error(`Unknown Prisma model "${model}"`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const data of rows) {
    const where = { [keyField]: data[keyField] };
    const existing = await delegate.findUnique({ where });

    if (existing) {
      if (respectEdits && existing.updatedById && !force) {
        skipped += 1;
        console.log(`  skipped  ${label(data)} — edited in Admin Center (re-run with --force to overwrite)`);
        continue;
      }
      if (via) await via.update(existing, data);
      else await delegate.update({ where, data });
      updated += 1;
      console.log(`  updated  ${label(data)}`);
    } else {
      if (via) await via.create(data);
      else await delegate.create({ data: { ...data } });
      created += 1;
      console.log(`  created  ${label(data)}`);
    }
  }

  return { created, updated, skipped };
};

/** Uniform tail for a seed script: log, disconnect, exit with the right code. */
const finish = async (name, counts) => {
  if (counts) {
    console.log(`\n${name}: ${counts.created} created, ${counts.updated} updated, ${counts.skipped} skipped`);
  }
  await disconnect();
};

const fail = async (name, err) => {
  console.error(`${name} failed:`, err.message);
  await disconnect();
  process.exit(1);
};

module.exports = {
  prisma, connect, disconnect, isForced, upsertAll, finish, fail,
};
