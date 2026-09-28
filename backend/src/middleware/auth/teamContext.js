/**
 * Team context — which account (Team) a customer request acts on, and what
 * the caller may do in it.
 *
 * Runs after `auth`. Every customer route that touches money or deployments
 * reads `req.team` (the account) and `req.membership` (the caller's role in
 * it) instead of `req.user.id`: a customer may belong to several accounts, and
 * money always moves in exactly one of them.
 *
 * The account comes from the `X-Team-Id` header; with no header it is the
 * caller's personal account, so an individual customer — and any client that
 * predates teams — works exactly as before.
 *
 * Membership is read from the database on every request, never cached and
 * never trusted from the token: a member who is removed, or whose role is
 * lowered, loses that access on their very next request.
 *
 * An account the caller does not belong to is refused with one answer whether
 * or not it exists, so the header cannot be used to discover team ids.
 */
const teamService = require('../../services/team/teamService');
const { can } = require('../../services/team/permissions');
const { isPublicId } = require('../../utils/helpers/publicId');

const DENIED = {
  success: false,
  code: 'TEAM_ACCESS_DENIED',
  message: 'You do not have access to this account.',
};

const teamContext = async (req, res, next) => {
  try {
    const requested = req.get('X-Team-Id');

    let resolved;
    if (requested) {
      if (!isPublicId(requested)) return res.status(403).json(DENIED);
      resolved = await teamService.findMembership(requested, req.user.id);
      if (!resolved) return res.status(403).json(DENIED);
    } else {
      // A customer created by a path that forgot their personal account gets
      // it on first use rather than an error.
      const personal = await teamService.findPersonal(req.user.id)
        || await teamService.createPersonal(req.user);
      resolved = await teamService.findMembership(personal.id, req.user.id);
      if (!resolved) return res.status(403).json(DENIED);
    }

    req.team = resolved.team;
    req.membership = resolved.membership;
    return next();
  } catch (err) {
    console.error('[teamContext] Could not resolve the account:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load your account' });
  }
};

/**
 * Refuse the request unless the caller's role allows `action` in the current
 * account. Use after `teamContext`.
 */
const requirePermission = (action) => (req, res, next) => {
  if (can(req.membership, action)) return next();
  return res.status(403).json({
    success: false,
    code: 'TEAM_PERMISSION_DENIED',
    message: 'Your role in this account does not allow this.',
  });
};

module.exports = teamContext;
module.exports.teamContext = teamContext;
module.exports.requirePermission = requirePermission;
