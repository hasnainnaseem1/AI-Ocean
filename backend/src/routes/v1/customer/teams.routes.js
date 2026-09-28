/**
 * Customer Team Routes
 *
 * The accounts a customer belongs to, and what they may do in the one the
 * request is acting on (`X-Team-Id`, resolved by teamContext). The customer
 * center uses this for its account switcher and to hide what a role cannot do
 * — the server still refuses those actions itself (services/team/permissions).
 *
 * `/current/...` always means the account named by the request's
 * `X-Team-Id`, so no route takes a team id in its path that could disagree
 * with the one the permission check was made against.
 */
const express = require('express');
const teamService = require('../../../services/team/teamService');
const teamLifecycleService = require('../../../services/team/teamLifecycleService');
const membershipService = require('../../../services/team/membershipService');
const invitationService = require('../../../services/team/invitationService');
const teamActivityService = require('../../../services/team/teamActivityService');
const ownershipService = require('../../../services/team/ownershipService');
const domainService = require('../../../services/team/domainService');
const domainJoinService = require('../../../services/team/domainJoinService');
const joinLinkService = require('../../../services/team/joinLinkService');
const joinRequestService = require('../../../services/team/joinRequestService');
const companyHintService = require('../../../services/team/companyHintService');
const { actionsFor, canSeeMoney } = require('../../../services/team/permissions');
const { requirePermission } = require('../../../middleware/auth');

const router = express.Router();

/** A refusal the services raised on purpose, or a server fault. */
const sendError = (res, error, fallback) => {
  if (error.status && error.status < 500) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message });
  }
  console.error(`${fallback}:`, error);
  return res.status(500).json({ success: false, message: fallback });
};

// @route   GET /api/v1/customer/teams
// @desc    Every account the customer belongs to, personal first, with their role
router.get('/', async (req, res) => {
  try {
    res.json({ success: true, teams: await teamService.listForUser(req.user.id) });
  } catch (error) {
    sendError(res, error, 'Could not load your accounts');
  }
});

// @route   POST /api/v1/customer/teams
// @desc    Create a team owned by the caller
router.post('/', async (req, res) => {
  try {
    const team = await teamLifecycleService.createTeam(req.user, { name: req.body?.name });
    res.status(201).json({ success: true, team: { id: team.id, name: team.name, kind: team.kind }, role: 'owner' });
  } catch (error) {
    sendError(res, error, 'Could not create the team');
  }
});

// @route   GET /api/v1/customer/teams/current
// @desc    The account this request acts on, the caller's role in it, and the
//          actions that role allows
router.get('/current', (req, res) => {
  const { team, membership } = req;
  res.json({
    success: true,
    team: {
      id: team.id, name: team.name, kind: team.kind, discoverableByDomain: team.discoverableByDomain,
    },
    role: membership.role,
    actions: actionsFor(membership.role),
    canSeeMoney: canSeeMoney(membership),
  });
});

// ── Members ──
router.get('/current/members', requirePermission('team.view'), async (req, res) => {
  try {
    res.json({
      success: true,
      members: await membershipService.list(req.team, { withMoney: canSeeMoney(req.membership) }),
    });
  } catch (error) {
    sendError(res, error, 'Could not load members');
  }
});

router.patch('/current/members/:userId', requirePermission('team.members'), async (req, res) => {
  try {
    const result = await membershipService.changeRole(
      req.team, req.membership, req.user.id, req.params.userId, req.body?.role,
      { actorUser: req.user, req },
    );
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error, 'Could not change the role');
  }
});

// @route   PATCH /api/v1/customer/teams/current/members/:userId/limit
// @desc    Set or clear (null) a Developer's monthly spend limit
router.patch('/current/members/:userId/limit', requirePermission('team.limits'), async (req, res) => {
  try {
    const result = await membershipService.setSpendLimit(
      req.team, req.membership, req.user.id, req.params.userId, req.body?.limit ?? null,
      { actorUser: req.user, req },
    );
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error, 'Could not change the limit');
  }
});

router.delete('/current/members/:userId', requirePermission('team.members'), async (req, res) => {
  try {
    res.json({
      success: true,
      ...(await membershipService.remove(
        req.team, req.membership, req.user.id, req.params.userId, { actorUser: req.user, req },
      )),
    });
  } catch (error) {
    sendError(res, error, 'Could not remove the member');
  }
});

router.post('/current/leave', async (req, res) => {
  try {
    res.json({ success: true, ...(await membershipService.leave(req.team, req.membership, { actorUser: req.user, req })) });
  } catch (error) {
    sendError(res, error, 'Could not leave the team');
  }
});

// ── Invitations ──
router.get('/current/invitations', requirePermission('team.members'), async (req, res) => {
  try {
    res.json({ success: true, invitations: await invitationService.listPending(req.team) });
  } catch (error) {
    sendError(res, error, 'Could not load invitations');
  }
});

router.post('/current/invitations', requirePermission('team.members'), async (req, res) => {
  try {
    const result = await invitationService.create(req.team, req.membership, req.user, {
      email: req.body?.email, role: req.body?.role,
    });
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    sendError(res, error, 'Could not send the invitation');
  }
});

router.delete('/current/invitations/:id', requirePermission('team.members'), async (req, res) => {
  try {
    res.json({
      success: true,
      ...(await invitationService.revoke(req.team, req.params.id, { actorUser: req.user, req })),
    });
  } catch (error) {
    sendError(res, error, 'Could not revoke the invitation');
  }
});

// ── History ──
// @route   GET /api/v1/customer/teams/current/activity
// @desc    What has happened in this team, newest first. Paged by `before`
//          (the createdAt of the last row seen), not by page number, because
//          entries arrive while someone is reading.
router.get('/current/activity', requirePermission('team.activity'), async (req, res) => {
  try {
    res.json({
      success: true,
      ...(await teamActivityService.list(req.team, {
        limit: req.query.limit, before: req.query.before,
      })),
    });
  } catch (error) {
    sendError(res, error, 'Could not load the activity log');
  }
});

// ── Ownership ──
// A handover is two-sided: only the owner may offer or cancel one, but the
// member it was offered to answers it — and that member is not an owner, so
// accept/decline cannot sit behind the ownership permission.
router.get('/current/ownership', requirePermission('team.view'), async (req, res) => {
  try {
    res.json({ success: true, pending: await ownershipService.pending(req.team) });
  } catch (error) {
    sendError(res, error, 'Could not load the handover');
  }
});

router.post('/current/ownership', requirePermission('team.ownership'), async (req, res) => {
  try {
    const offer = await ownershipService.offer(req.team, req.user, req.body?.userId, { req });
    res.status(201).json({ success: true, pending: offer });
  } catch (error) {
    sendError(res, error, 'Could not offer ownership');
  }
});

router.delete('/current/ownership', requirePermission('team.ownership'), async (req, res) => {
  try {
    res.json({ success: true, ...(await ownershipService.cancel(req.team, req.user, { req })) });
  } catch (error) {
    sendError(res, error, 'Could not cancel the handover');
  }
});

/*
 * The other side of a handover. These are about the caller, not about the
 * account the request happens to be acting on, so they take the offer's own id
 * and carry no permission check: the service only ever answers an offer made
 * to the person asking. The member answering is not an owner, so they could
 * not pass `team.ownership` anyway.
 */
router.get('/ownership/mine', async (req, res) => {
  try {
    res.json({ success: true, offers: await ownershipService.pendingForUser(req.user.id) });
  } catch (error) {
    sendError(res, error, 'Could not load your handovers');
  }
});

router.post('/ownership/:id/accept', async (req, res) => {
  try {
    res.json({ success: true, ...(await ownershipService.accept(req.params.id, req.user, { req })) });
  } catch (error) {
    sendError(res, error, 'Could not accept the handover');
  }
});

router.post('/ownership/:id/decline', async (req, res) => {
  try {
    res.json({ success: true, ...(await ownershipService.decline(req.params.id, req.user, { req })) });
  } catch (error) {
    sendError(res, error, 'Could not decline the handover');
  }
});

// ── Company domain ──
// Claiming a domain decides who is let into an account that spends money, so
// it sits behind the same permission as the rest of the team's settings, and
// the proof is a DNS record rather than an address at the domain.
router.get('/current/domain', requirePermission('team.settings'), async (req, res) => {
  try {
    res.json({ success: true, domain: await domainService.status(req.team) });
  } catch (error) {
    sendError(res, error, 'Could not load the domain');
  }
});

router.put('/current/domain', requirePermission('team.settings'), async (req, res) => {
  try {
    res.json({ success: true, domain: await domainService.claim(req.team, req.user, req.body?.domain, { req }) });
  } catch (error) {
    sendError(res, error, 'Could not save the domain');
  }
});

router.post('/current/domain/verify', requirePermission('team.settings'), async (req, res) => {
  try {
    res.json({ success: true, domain: await domainService.verify(req.team, req.user, { req }) });
  } catch (error) {
    sendError(res, error, 'Could not verify the domain');
  }
});

router.patch('/current/domain/join-rule', requirePermission('team.settings'), async (req, res) => {
  try {
    const domain = await domainService.setJoinRule(
      req.team, req.user, { mode: req.body?.mode, role: req.body?.role }, { req },
    );
    res.json({ success: true, domain });
  } catch (error) {
    sendError(res, error, 'Could not change the join rule');
  }
});

router.delete('/current/domain', requirePermission('team.settings'), async (req, res) => {
  try {
    res.json({ success: true, ...(await domainService.remove(req.team, req.user, { req })) });
  } catch (error) {
    sendError(res, error, 'Could not remove the domain');
  }
});

// ── Join requests ──
// Answering them is managing members, so it takes the members permission; the
// asking, below, is about the caller and takes none.
router.get('/current/join-requests', requirePermission('team.members'), async (req, res) => {
  try {
    res.json({ success: true, requests: await joinRequestService.listPending(req.team) });
  } catch (error) {
    sendError(res, error, 'Could not load join requests');
  }
});

router.post('/current/join-requests/:id/approve', requirePermission('team.members'), async (req, res) => {
  try {
    res.json({ success: true, ...(await joinRequestService.approve(req.team, req.user, req.params.id, { req })) });
  } catch (error) {
    sendError(res, error, 'Could not approve the request');
  }
});

router.post('/current/join-requests/:id/decline', requirePermission('team.members'), async (req, res) => {
  try {
    res.json({ success: true, ...(await joinRequestService.decline(req.team, req.user, req.params.id, { req })) });
  } catch (error) {
    sendError(res, error, 'Could not decline the request');
  }
});

// ── The join link ──
// One link per team, handed round the company's own chat. It admits nobody by
// itself: whoever opens it asks, and an owner or admin answers, which is what
// makes a forwarded or forgotten link harmless.
router.get('/current/join-link', requirePermission('team.members'), async (req, res) => {
  try {
    res.json({ success: true, ...(await joinLinkService.current(req.team)) });
  } catch (error) {
    sendError(res, error, 'Could not load the join link');
  }
});

// The raw link is in this reply and nowhere else — only its hash is stored.
router.post('/current/join-link', requirePermission('team.members'), async (req, res) => {
  try {
    const link = await joinLinkService.issue(req.team, req.user, {
      role: req.body?.role, expiryDays: req.body?.expiryDays, maxUses: req.body?.maxUses,
    }, { req });
    res.status(201).json({ success: true, link });
  } catch (error) {
    sendError(res, error, 'Could not create the join link');
  }
});

router.delete('/current/join-link', requirePermission('team.members'), async (req, res) => {
  try {
    res.json({ success: true, ...(await joinLinkService.revoke(req.team, req.user, { req })) });
  } catch (error) {
    sendError(res, error, 'Could not revoke the join link');
  }
});

// Whether colleagues at the owner's own email domain may be shown this
// organization when they sign up. Off until an owner says otherwise — nothing
// about a team is ever disclosed on a guess about the domain.
router.patch('/current/discoverability', requirePermission('team.settings'), async (req, res) => {
  try {
    const on = req.body?.discoverableByDomain === true;
    const updated = await teamService.update(req.team, { discoverableByDomain: on });
    await teamActivityService.record(req.team, req.user, 'team.discoverabilityChanged', {
      targetType: 'team', targetId: req.team.id, metadata: { on }, req,
    });
    res.json({ success: true, discoverableByDomain: updated.discoverableByDomain });
  } catch (error) {
    sendError(res, error, 'Could not change discoverability');
  }
});

/*
 * Using a link, and the requests the caller has made. About the caller rather
 * than the account the request happens to be acting on, so no permission check
 * — the services answer only for the person asking.
 */
router.post('/join/:token', async (req, res) => {
  try {
    res.json({ success: true, ...(await joinLinkService.use(req.params.token, req.user, { req })) });
  } catch (error) {
    sendError(res, error, 'Could not use that link');
  }
});

router.get('/join-requests/mine', async (req, res) => {
  try {
    res.json({ success: true, requests: await joinRequestService.mine(req.user) });
  } catch (error) {
    sendError(res, error, 'Could not load your requests');
  }
});

// ── "Somebody at your company is already here" ──
// Only ever about the caller's own verified address, so nobody can test which
// companies are customers here.
router.get('/company-hint', async (req, res) => {
  try {
    res.json({ success: true, organizations: await companyHintService.forUser(req.user) });
  } catch (error) {
    sendError(res, error, 'Could not check for organizations');
  }
});

router.post('/company-hint/:teamId/request', async (req, res) => {
  try {
    res.json({ success: true, ...(await companyHintService.requestJoin(req.user, req.params.teamId)) });
  } catch (error) {
    sendError(res, error, 'Could not ask to join');
  }
});

/*
 * What the caller could join because of their own email address. Not about the
 * account the request is acting on, so no permission check — and `discover`
 * itself only ever answers for teams that have verified the domain the
 * caller's own address is at.
 */
router.get('/discover', async (req, res) => {
  try {
    res.json({ success: true, ...(await domainJoinService.discover(req.user)) });
  } catch (error) {
    sendError(res, error, 'Could not check for organizations');
  }
});

router.post('/discover/:teamId/request', async (req, res) => {
  try {
    res.json({ success: true, ...(await domainJoinService.request(req.user, req.params.teamId)) });
  } catch (error) {
    sendError(res, error, 'Could not ask to join');
  }
});

// ── Closing the account ──
// @route   DELETE /api/v1/customer/teams/current
// @desc    Close the team. Refused while anything is still deployed or any
//          balance is owed; credit left in the wallet is named in the refusal
//          and given up only when the caller asks again with `forfeitBalance`.
router.delete('/current', requirePermission('team.delete'), async (req, res) => {
  try {
    const result = await teamLifecycleService.deleteTeam(req.team, req.user, {
      forfeitBalance: req.body?.forfeitBalance === true || req.query.forfeitBalance === 'true',
      req,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    if (error.status && error.status < 500) {
      return res.status(error.status).json({
        success: false, code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}),
      });
    }
    sendError(res, error, 'Could not close the team');
  }
});

module.exports = router;
module.exports.sendError = sendError;
