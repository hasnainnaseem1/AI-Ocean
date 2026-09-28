/**
 * CustomRole lookups.
 *
 * CustomRole was the one resource still addressed by its raw Postgres UUID
 * rather than the id every other entity uses as its
 * public `_id`. Two problems followed from that:
 *
 *  - `findUnique({ where: { id } })` with anything that isn't a UUID makes
 *    Postgres reject the value, so `GET /admin/roles/abc` returned HTTP 500
 *    instead of 404 — for every malformed id shape, including a perfectly
 *    ordinary 24-hex id from elsewhere in this API.
 *  - `POST /admin/roles` was the only create route that didn't mint a
 *    `id`, so API-created roles had a NULL where the rest of the
 *    codebase expects an id.
 *
 * `findByIdentifier` accepts either form and returns null for anything it
 * cannot resolve, so callers get a clean 404.
 */
const prisma = require('../../lib/prismaClient');
const { isPublicId } = require('../../utils/helpers/publicId');
const { byPublicId } = require('../../utils/helpers/publicId');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {string} identifier  the role's id
 * @param {object} [options]   passed through to Prisma (e.g. `include`)
 */
const findByIdentifier = async (identifier, options = {}) => {
  if (typeof identifier !== 'string' || !identifier) return null;

  if (!isPublicId(identifier)) return null;
  return prisma.customRole.findUnique({ where: byPublicId(identifier), ...options });
};

/** Create a role, minting the public id every other entity gets. */
const create = async (data) => prisma.customRole.create({
  data: { ...data },
});

module.exports = { findByIdentifier, create, UUID_RE };
