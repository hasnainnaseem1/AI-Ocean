/**
 * A team's own history: who invited whom, who changed a role or a spend limit,
 * who joined, left or was removed, and who handed the team over.
 *
 * ── One way in ──
 *
 * Every entry is written through `record(...)` and nowhere else, which is what
 * makes the history worth reading: there is no second path that could record
 * something in a different shape or skip it by accident. It is the same choke
 * point the platform's own audit trail uses (admin/activityLogService), and for
 * the same reason.
 *
 * Like that one, `record` never throws to its caller. It describes something
 * that has already happened; failing to describe it must not undo it.
 *
 * ── Why the sentence is not stored ──
 *
 * The row stores a stable `action` key plus the values that vary. The customer
 * center turns that into a sentence in the reader's own language (i18n
 * namespace `teams`), so a team whose members read in different languages each
 * see the same history in their own — and switching language re-renders the
 * whole history with nothing rewritten. Notifications store a `contentKey` for
 * exactly this reason.
 *
 * ── Why the actor is copied, not joined ──
 *
 * `actorName` and `actorEmail` are written onto the row. The person who did it
 * may later be removed from the team or leave the platform, and "someone
 * changed the owner" is not a history. The `actorUserId` link is kept where it
 * can be (it goes null only if the account is erased) so the UI can still show
 * an avatar.
 *
 * This is the team's record, not the platform's — it is never the place for
 * anything an operator does from the Admin Center.
 */
const prisma = require('../../lib/prismaClient');
const { byPublicId } = require('../../utils/helpers/publicId');

/**
 * Every action a team's history can hold. Kept as a list so a typo in a call
 * site fails loudly here instead of writing an entry the customer center has
 * no sentence for — the frontend renders `teams:activity.<action>`, and a key
 * it does not know would render as raw text on a customer's screen.
 */
const ACTIONS = [
  'team.created',
  'member.invited',
  'member.inviteRevoked',
  'member.joined',
  'member.inviteDeclined',
  'member.roleChanged',
  'member.removed',
  'member.left',
  'member.limitSet',
  'member.limitCleared',
  'ownership.offered',
  'ownership.cancelled',
  'ownership.accepted',
  'ownership.declined',
  'joinLink.issued',
  'joinLink.revoked',
  'member.joinedByLink',
  'team.discoverabilityChanged',
  'domain.claimed',
  'domain.verified',
  'domain.joinRuleChanged',
  'domain.removed',
  'member.joinedByDomain',
  'member.joinRequested',
  'member.joinApproved',
  'member.joinDeclined',
  'team.deleted',
  // Support reaching into an organization on the customer's behalf. Recorded
  // in the team's own history too, not only the platform's audit trail: the
  // customer is entitled to see that somebody from the platform did this.
  'member.addedByAdmin',
  'member.roleChangedByAdmin',
  'member.removedByAdmin',
];

/**
 * Write one entry. `actor` is the user who did it (a Prisma user row, or any
 * object with id/name/email); `target` names who or what it was done to.
 *
 * `req` is optional and only used for the IP — passing the whole request keeps
 * call sites from each deciding how to dig one out.
 */
const record = async (team, actor, action, {
  targetType = null, targetId = null, targetName = null, metadata = {}, req = null,
} = {}) => {
  try {
    if (!team || team.kind !== 'team') return null;   // a personal account has no history
    if (!ACTIONS.includes(action)) {
      console.error(`[TeamActivity] Unknown action "${action}" — not recorded.`);
      return null;
    }

    return await prisma.teamActivity.create({
      data: {
        teamId: byPublicId(team.id).id,
        actorUserId: actor?.id ? byPublicId(actor.id).id : null,
        actorName: actor?.name || actor?.email || 'Someone',
        actorEmail: actor?.email || '',
        action,
        targetType,
        targetId: targetId ? String(targetId) : null,
        targetName: targetName || null,
        metadata: metadata || {},
        ipAddress: req ? (req.ip || req.headers?.['x-forwarded-for'] || null) : null,
      },
      select: { id: true },
    });
  } catch (error) {
    console.error('[TeamActivity] Could not record activity:', error.message);
    return null;
  }
};

/**
 * The team's history, newest first, one page at a time.
 *
 * Paged by `before` (the created-at of the last row seen) rather than by page
 * number: entries arrive while someone is reading, and an offset would quietly
 * show the same row twice.
 */
const PAGE = 25;
const MAX_PAGE = 100;

const list = async (team, { limit = PAGE, before = null } = {}) => {
  const take = Math.min(Math.max(Number(limit) || PAGE, 1), MAX_PAGE);
  const rows = await prisma.teamActivity.findMany({
    where: {
      teamId: byPublicId(team.id).id,
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: take + 1,   // one extra, only to answer "is there more"
    select: {
      id: true,
      action: true,
      actorUserId: true,
      actorName: true,
      actorEmail: true,
      targetType: true,
      targetId: true,
      targetName: true,
      metadata: true,
      createdAt: true,
      actor: { select: { avatar: true } },
    },
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return {
    activity: page.map((r) => ({
      id: r.id,
      action: r.action,
      actor: {
        userId: r.actorUserId,
        name: r.actorName,
        email: r.actorEmail,
        avatar: r.actor?.avatar || null,
      },
      targetType: r.targetType,
      targetId: r.targetId,
      targetName: r.targetName,
      metadata: r.metadata || {},
      createdAt: r.createdAt,
    })),
    // The cursor to ask for the next page with, or null at the end.
    nextBefore: hasMore ? page[page.length - 1].createdAt : null,
  };
};

module.exports = { ACTIONS, record, list };
