const { byPublicId } = require('../../utils/helpers/publicId');
/**
 * Shared "does a row with this id exist?" lookup, used by
 * every Deployment-domain file that needs to turn a caller-supplied
 * public id (`userId`, `modelId`, `tierId`, `transactionId`, ...) into
 * the real Postgres foreign key before writing. Pulled out once both
 * deploymentService.js and deploymentUsageService.js needed the exact same
 * four lines, rather than duplicating it a second time in the same domain.
 */
const pgId = async (delegate, id) => {
  if (!id) return null;
  const row = await delegate.findUnique({ where: byPublicId(id), select: { id: true } });
  return row?.id || null;
};

module.exports = { pgId };
