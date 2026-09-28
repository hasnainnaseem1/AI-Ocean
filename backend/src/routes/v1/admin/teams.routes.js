/**
 * Admin Team Routes
 *
 * The organizations on the platform, for the person running it: who is in
 * them, what they owe, and the two levers that decide whether they can keep
 * spending — pay-as-you-go access and a dispute hold.
 *
 * Personal accounts are deliberately absent. Every customer has one, they are
 * the customer, and the Customers pages already show them; listing them here
 * would double every row on the screen for no gain.
 *
 * Reads take `customers.view` and the levers take `billing.manage`, matching
 * the customer pages these mirror — an operator who may not touch a customer's
 * money must not reach the same money through their team.
 */
const express = require('express');
const prisma = require('../../../lib/prismaClient');
const teamService = require('../../../services/team/teamService');
const membershipService = require('../../../services/team/membershipService');
const seatFeeService = require('../../../services/team/seatFeeService');
const teamActivityService = require('../../../services/team/teamActivityService');
const teamNotifier = require('../../../services/team/teamNotifier');
const teamSettingsService = require('../../../services/team/teamSettingsService');
const joinLinkService = require('../../../services/team/joinLinkService');
const domainService = require('../../../services/team/domainService');
const creditService = require('../../../services/billing/creditService');
const debtService = require('../../../services/billing/debtService');
const fundingService = require('../../../services/billing/fundingService');
const billingModeService = require('../../../services/billing/billingModeService');
const activityLogService = require('../../../services/admin/activityLogService');
const { adminAuth } = require('../../../middleware/auth');
const { checkPermission } = require('../../../middleware/security');
const { byPublicId } = require('../../../utils/helpers/publicId');
const { paginate } = require('../../../utils/helpers/pagination');

const router = express.Router();

const num = (v) => (v === null || v === undefined ? 0 : Number(v));

const sendError = (res, error, fallback) => {
  if (error.status && error.status < 500) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message });
  }
  console.error(`${fallback}:`, error);
  return res.status(500).json({ success: false, message: fallback });
};

// @route   GET /api/v1/admin/teams
// @desc    Every organization, with the numbers an operator scans for: size,
//          balance, what is owed, and whether anything is holding it.
router.get('/', adminAuth, checkPermission('customers.view'), async (req, res) => {
  try {
    const { page, limit, skip, take } = paginate(req.query, { defaultLimit: 25, maxLimit: 100 });
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();

    const where = {
      kind: 'team',
      // Closed accounts are kept (their ledger is), and shown only on request.
      ...(status === 'closed' ? { deletedAt: { not: null } } : { deletedAt: null }),
      ...(search
        ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { createdBy: { email: { contains: search, mode: 'insensitive' } } },
            { createdBy: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
        : {}),
      ...(status === 'hold' ? { disputeHold: true } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.team.findMany({
        where,
        select: {
          id: true,
          name: true,
          paygAccess: true,
          disputeHold: true,
          deletedAt: true,
          createdAt: true,
          verifiedDomain: true,
          domainVerifiedAt: true,
          createdBy: { select: { id: true, name: true, email: true } },
          wallet: { select: { balance: true, outstandingBalance: true, currency: true } },
          _count: { select: { members: true, deployments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.team.count({ where }),
    ]);

    res.json({
      success: true,
      teams: rows.map((t) => ({
        id: t.id,
        name: t.name,
        owner: t.createdBy,
        members: t._count.members,
        deployments: t._count.deployments,
        balance: num(t.wallet?.balance),
        outstanding: num(t.wallet?.outstandingBalance),
        currency: t.wallet?.currency || 'USD',
        paygAccess: t.paygAccess || 'default',
        disputeHold: !!t.disputeHold,
        domain: t.domainVerifiedAt ? t.verifiedDomain : null,
        closedAt: t.deletedAt,
        createdAt: t.createdAt,
      })),
      pagination: {
        page, limit, total, pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    sendError(res, error, 'Could not load organizations');
  }
});

// @route   GET /api/v1/admin/teams/:id
// @desc    One organization in full: its people, its money, its doors.
router.get('/:id', adminAuth, checkPermission('customers.view'), async (req, res) => {
  try {
    const team = await teamService.findById(req.params.id);
    if (!team || team.kind !== 'team') {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }

    const [owner, members, wallet, debt, settings, deployments, seatFee, activity] = await Promise.all([
      prisma.user.findUnique({
        where: { id: team.createdById }, select: { id: true, name: true, email: true },
      }),
      // With the money figures: this is the operator's own screen, and the
      // per-member limits are part of what they are looking at.
      membershipService.list(team, { withMoney: true }),
      creditService.getOrCreateWallet(team.id),
      debtService.status(team.id),
      billingModeService.getBillingSettings(),
      prisma.deployment.groupBy({
        by: ['status'], where: { teamId: team.id }, _count: { _all: true },
      }),
      seatFeeService.preview(team.id),
      teamActivityService.list(team, { limit: 15 }),
    ]);

    res.json({
      success: true,
      team: {
        id: team.id,
        name: team.name,
        owner,
        createdAt: team.createdAt,
        closedAt: team.deletedAt,
        paygAccess: team.paygAccess || 'default',
        paygEffective: fundingService.resolvePaygAccess(team, settings),
        disputeHold: !!team.disputeHold,
        disputeReason: team.disputeReason || '',
        disputedAt: team.disputedAt,
        discoverableByDomain: !!team.discoverableByDomain,
      },
      members,
      wallet: {
        balance: num(wallet.balance),
        outstanding: num(wallet.outstandingBalance),
        lifetimeSpend: num(wallet.lifetimeSpend),
        currency: wallet.currency || settings.currency || 'USD',
        debt,
      },
      deployments: deployments.map((d) => ({ status: d.status, count: d._count._all })),
      seatFee,
      domain: await domainService.status(team),
      joinLink: await joinLinkService.current(team),
      activity: activity.activity,
    });
  } catch (error) {
    sendError(res, error, 'Could not load the organization');
  }
});

// @route   PUT /api/v1/admin/teams/:id/payg-access
// @desc    Allow or block pay-as-you-go for one organization. Taking it away
//          moves what is already running onto prepaid at once, rather than
//          letting it keep billing to debt until the next hourly pass.
router.put('/:id/payg-access', adminAuth, checkPermission('billing.manage'), async (req, res) => {
  try {
    const { access, reason } = req.body || {};
    if (!fundingService.PAYG_ACCESS_VALUES.includes(access)) {
      return res.status(400).json({
        success: false,
        message: `access must be one of: ${fundingService.PAYG_ACCESS_VALUES.join(', ')}`,
      });
    }

    const team = await teamService.findById(req.params.id);
    if (!team || team.kind !== 'team') {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }

    const settings = await billingModeService.getBillingSettings();
    const before = team.paygAccess || 'default';
    const updated = before === access ? team : await teamService.update(team, { paygAccess: access });
    const effective = fundingService.resolvePaygAccess(updated, settings);

    let enforcement = null;
    if (!effective.available) {
      enforcement = await fundingService.enforcePaygAccessNow({
        teamId: updated.id, settings, actor: req.user,
      });
    }

    await activityLogService.logActivity({
      userId: req.user.id,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'team_payg_access',
      actionType: 'billing',
      targetModel: 'Team',
      targetId: updated.id,
      targetName: updated.name,
      description: `Pay-as-you-go for ${updated.name}: ${before} → ${access}`,
      metadata: { before, after: access, reason: reason || '' },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({
      success: true, paygAccess: access, effective, enforcement,
    });
  } catch (error) {
    sendError(res, error, 'Could not change pay-as-you-go access');
  }
});

// @route   PUT /api/v1/admin/teams/:id/dispute-hold
// @desc    Put an organization under a chargeback hold, or lift one. A hold
//          stops anything new starting; it never touches the ledger.
router.put('/:id/dispute-hold', adminAuth, checkPermission('billing.manage'), async (req, res) => {
  try {
    const on = req.body?.disputeHold === true;
    const reason = String(req.body?.reason || '').slice(0, 500);

    const team = await teamService.findById(req.params.id);
    if (!team || team.kind !== 'team') {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }

    const updated = await teamService.update(team, {
      disputeHold: on,
      disputeReason: on ? reason : '',
      disputedAt: on ? new Date() : null,
    });

    await activityLogService.logActivity({
      userId: req.user.id,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'team_dispute_hold',
      actionType: 'billing',
      targetModel: 'Team',
      targetId: updated.id,
      targetName: updated.name,
      description: `${on ? 'Placed' : 'Lifted'} dispute hold on ${updated.name}`,
      metadata: { on, reason },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ success: true, disputeHold: on, disputeReason: updated.disputeReason });
  } catch (error) {
    sendError(res, error, 'Could not change the dispute hold');
  }
});

// @route   GET /api/v1/admin/teams/:id/seat-charges
// @desc    What this organization has been billed for its seats, day by day.
router.get('/:id/seat-charges', adminAuth, checkPermission('billing.view'), async (req, res) => {
  try {
    const { take } = paginate(req.query, { defaultLimit: 30, maxLimit: 180 });
    const rows = await prisma.teamSeatCharge.findMany({
      where: { teamId: byPublicId(req.params.id).id },
      orderBy: { day: 'desc' },
      take,
    });
    res.json({
      success: true,
      charges: rows.map((r) => ({
        day: r.day,
        seats: r.seats,
        freeSeats: r.freeSeats,
        monthlyFee: num(r.monthlyFee),
        amount: num(r.amount),
        toWallet: num(r.toWallet),
        toDebt: num(r.toDebt),
        currency: r.currency,
      })),
    });
  } catch (error) {
    sendError(res, error, 'Could not load seat charges');
  }
});

/*
 * ── Members, from the operator's side ──
 *
 * Support work, not a second way to run a team: somebody has lost access, or
 * an account has to be taken out of an organization on request. So it does
 * exactly what the organization's own owner could do and nothing more — the
 * same rules, the same refusals, written into the same activity log the
 * customer reads, and into the platform's audit trail as well, because an
 * operator reaching into a customer's account is a thing that must never be
 * invisible to either side.
 *
 * Ownership is deliberately absent. It moves only by an offer the new owner
 * accepts, and an operator quietly reassigning who answers for an account's
 * money would undo the point of that.
 */
router.post('/:id/members', adminAuth, checkPermission('customers.edit'), async (req, res) => {
  try {
    const team = await teamService.findById(req.params.id);
    if (!team || team.kind !== 'team' || team.deletedAt) {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = String(req.body?.role || 'developer');
    if (!membershipService.ASSIGNABLE.includes(role)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ROLE',
        message: `role must be one of: ${membershipService.ASSIGNABLE.join(', ')}`,
      });
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: {
        id: true, name: true, email: true, accountType: true, status: true, isEmailVerified: true,
      },
    });
    if (!user || user.accountType !== 'customer') {
      return res.status(404).json({
        success: false,
        code: 'CUSTOMER_NOT_FOUND',
        message: 'No customer account with that email. They have to sign up first.',
      });
    }
    if (user.status !== 'active' || !user.isEmailVerified) {
      return res.status(409).json({
        success: false,
        code: 'MEMBER_NOT_READY',
        message: 'That account is not active and verified.',
      });
    }

    const already = await prisma.teamMember.findFirst({
      where: { teamId: team.id, userId: user.id }, select: { id: true },
    });
    if (already) {
      return res.status(409).json({ success: false, code: 'ALREADY_MEMBER', message: 'They are already a member.' });
    }

    const settings = await teamSettingsService.getTeamSettings();
    const members = await prisma.teamMember.count({ where: { teamId: team.id } });
    if (members >= settings.maxMembers) {
      return res.status(409).json({ success: false, code: 'TEAM_FULL', message: 'This organization is full.' });
    }

    await prisma.teamMember.create({ data: { teamId: team.id, userId: user.id, role } });

    await teamActivityService.record(team, req.user, 'member.addedByAdmin', {
      targetType: 'user', targetId: user.id, targetName: user.name, metadata: { role }, req,
    });
    await teamNotifier.notify({
      recipientId: user.id,
      recipientType: 'customer',
      type: 'team_membership',
      contentKey: 'team.addedByAdmin',
      title: 'You were added to an organization',
      message: `You were added to ${team.name} by support.`,
      metadata: { teamName: team.name },
      priority: 'medium',
    });
    await activityLogService.logActivity({
      userId: req.user.id,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'team_member_added',
      actionType: 'update',
      targetModel: 'Team',
      targetId: team.id,
      targetName: team.name,
      description: `Added ${user.email} to ${team.name} as ${role}`,
      metadata: { email: user.email, role },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.status(201).json({
      success: true, userId: user.id, name: user.name, email: user.email, role,
    });
  } catch (error) {
    sendError(res, error, 'Could not add the member');
  }
});

router.patch('/:id/members/:userId', adminAuth, checkPermission('customers.edit'), async (req, res) => {
  try {
    const team = await teamService.findById(req.params.id);
    if (!team || team.kind !== 'team' || team.deletedAt) {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }
    const role = String(req.body?.role || '');
    if (!membershipService.ASSIGNABLE.includes(role)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ROLE',
        message: `role must be one of: ${membershipService.ASSIGNABLE.join(', ')}`,
      });
    }

    const target = await prisma.teamMember.findFirst({
      where: { teamId: team.id, userId: byPublicId(req.params.userId).id },
      select: { id: true, role: true, user: { select: { id: true, name: true, email: true } } },
    });
    if (!target) return res.status(404).json({ success: false, code: 'MEMBER_NOT_FOUND', message: 'Not a member of this organization.' });
    if (target.role === 'owner') {
      return res.status(409).json({
        success: false,
        code: 'CANNOT_CHANGE_OWNER',
        message: 'The owner’s role only changes by a handover the new owner accepts.',
      });
    }

    await prisma.teamMember.update({ where: { id: target.id }, data: { role } });
    await teamActivityService.record(team, req.user, 'member.roleChangedByAdmin', {
      targetType: 'user',
      targetId: target.user.id,
      targetName: target.user.name,
      metadata: { from: target.role, to: role },
      req,
    });
    await activityLogService.logActivity({
      userId: req.user.id,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'team_member_role',
      actionType: 'update',
      targetModel: 'Team',
      targetId: team.id,
      targetName: team.name,
      description: `Changed ${target.user.email} in ${team.name}: ${target.role} → ${role}`,
      metadata: { email: target.user.email, from: target.role, to: role },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ success: true, userId: target.user.id, role });
  } catch (error) {
    sendError(res, error, 'Could not change the role');
  }
});

router.delete('/:id/members/:userId', adminAuth, checkPermission('customers.edit'), async (req, res) => {
  try {
    const team = await teamService.findById(req.params.id);
    if (!team || team.kind !== 'team') {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }

    const target = await prisma.teamMember.findFirst({
      where: { teamId: team.id, userId: byPublicId(req.params.userId).id },
      select: { id: true, role: true, user: { select: { id: true, name: true, email: true } } },
    });
    if (!target) return res.status(404).json({ success: false, code: 'MEMBER_NOT_FOUND', message: 'Not a member of this organization.' });
    if (target.role === 'owner') {
      return res.status(409).json({
        success: false,
        code: 'CANNOT_REMOVE_OWNER',
        message: 'An organization is never left without an owner — hand it over first.',
      });
    }

    await prisma.teamMember.delete({ where: { id: target.id } });

    // Their deployments stay with the organization, which pays for them; only
    // the access goes (plan loophole #16).
    await teamActivityService.record(team, req.user, 'member.removedByAdmin', {
      targetType: 'user',
      targetId: target.user.id,
      targetName: target.user.name,
      metadata: { role: target.role },
      req,
    });
    await teamNotifier.notify({
      recipientId: target.user.id,
      recipientType: 'customer',
      type: 'team_membership',
      contentKey: 'team.removedByAdmin',
      title: 'You were removed from an organization',
      message: `You no longer have access to ${team.name}.`,
      metadata: { teamName: team.name },
      priority: 'medium',
    });
    await activityLogService.logActivity({
      userId: req.user.id,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'team_member_removed',
      actionType: 'update',
      targetModel: 'Team',
      targetId: team.id,
      targetName: team.name,
      description: `Removed ${target.user.email} from ${team.name}`,
      metadata: { email: target.user.email, role: target.role },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ success: true, userId: target.user.id });
  } catch (error) {
    sendError(res, error, 'Could not remove the member');
  }
});

module.exports = router;
