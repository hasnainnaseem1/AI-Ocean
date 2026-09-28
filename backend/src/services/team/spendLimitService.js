/**
 * Per-member monthly spend limits (plan phase LIMITS).
 *
 * An Owner or Admin can cap what a Developer may spend of the team's money in
 * a calendar month (UTC, the same month billing uses). A Developer at their
 * limit cannot start anything new — create a deployment, resume one, or move
 * one onto pay-as-you-go — until the month turns or the limit is raised.
 * Deployments already running are NOT stopped: the money is the team's, the
 * platform is still paid in full, and stopping someone's work mid-run is the
 * team's call to make, not an automatic one.
 *
 * Only Developers are limited. Owners and Admins control the limits; Billing
 * and Viewer cannot deploy at all.
 *
 * "Spend" is what the member's own deployments (the ones they created) were
 * charged this month, pro rata by time — see deploymentUsageService.sumCharged.
 * It counts billed usage, so it trails live usage by at most one billing run.
 */
const prisma = require('../../lib/prismaClient');
const teamNotifier = require('./teamNotifier');
const { byPublicId } = require('../../utils/helpers/publicId');

const LIMITED_ROLES = ['developer'];
const ALERT_LEVELS = [80, 100];

const monthBounds = (now = new Date()) => {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from, to, key: from.toISOString().slice(0, 7) };
};

/** What one member's deployments cost the team so far this month. */
const memberMonthSpend = async (teamId, userId, now = new Date()) => {
  const { from, to } = monthBounds(now);
  return require('../deployment/deploymentUsageService').sumCharged(
    byPublicId(teamId).id, from, to, { userId: byPublicId(userId).id },
  );
};

/** Does a limit apply to this membership at all? */
const isLimited = (membership) => !!membership
  && LIMITED_ROLES.includes(membership.role)
  && membership.spendLimitMonthly !== null && membership.spendLimitMonthly !== undefined;

/**
 * Has this member used up their limit in this account? `null` when no limit
 * applies (not a limited role, or no limit set).
 */
const limitStatus = async (teamId, membership, userId, now = new Date()) => {
  if (!isLimited(membership)) return null;
  const limit = Number(membership.spendLimitMonthly);
  const spent = await memberMonthSpend(teamId, userId, now);
  return { limit, spent, reached: spent >= limit };
};

/**
 * Owners/Admins told once per month when a Developer passes 80% and 100% of
 * their limit. Run after each billing pass, when the month's spend has just
 * moved. Personal accounts never have limits.
 */
const runAlerts = async (now = new Date()) => {
  const { key } = monthBounds(now);
  const limited = await prisma.teamMember.findMany({
    where: {
      role: { in: LIMITED_ROLES },
      spendLimitMonthly: { not: null },
      team: { kind: 'team', deletedAt: null },
    },
    select: {
      id: true, teamId: true, userId: true, spendLimitMonthly: true, limitAlertLevel: true, limitAlertMonth: true,
      user: { select: { name: true, email: true } },
      team: { select: { name: true } },
    },
  });
  if (!limited.length) return { alerted: 0 };

  const settings = await require('../billing/billingModeService').getBillingSettings();
  let alerted = 0;

  for (const m of limited) {
    try {
      const limit = Number(m.spendLimitMonthly);
      const spent = await memberMonthSpend(m.teamId, m.userId, now);
      const pct = limit > 0 ? (spent / limit) * 100 : (spent > 0 ? 100 : 0);
      const level = [...ALERT_LEVELS].reverse().find((l) => pct >= l) || 0;
      const already = m.limitAlertMonth === key ? m.limitAlertLevel : 0;
      if (level <= already) continue;

      const managers = await prisma.teamMember.findMany({
        where: { teamId: m.teamId, role: { in: ['owner', 'admin'] }, user: { status: 'active' } },
        select: { userId: true },
      });
      const currency = settings.currency || 'USD';
      for (const { userId } of managers) {
        await teamNotifier.notify({
          recipientId: userId,
          recipientType: 'customer',
          type: 'team_spend_limit',
          contentKey: level >= 100 ? 'team.spendLimitReached' : 'team.spendLimitNear',
          title: level >= 100 ? 'Spending limit reached' : 'Spending limit almost reached',
          message: level >= 100
            ? `${m.user.name} has reached their ${currency} ${limit.toFixed(2)} monthly limit in ${m.team.name}. `
              + 'They cannot start new deployments until next month or until you raise it.'
            : `${m.user.name} has used ${Math.floor(pct)}% of their ${currency} ${limit.toFixed(2)} monthly limit in ${m.team.name}.`,
          metadata: {
            memberName: m.user.name, teamName: m.team.name, currency,
            limit: limit.toFixed(2), spent: spent.toFixed(2), percent: String(Math.floor(pct)),
          },
          priority: level >= 100 ? 'high' : 'medium',
          action: {
            label: 'Team settings',
            url: `${(process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002').replace(/\/$/, '')}/team`,
          },
        });
      }
      await prisma.teamMember.update({
        where: { id: m.id }, data: { limitAlertLevel: level, limitAlertMonth: key },
      });
      alerted += 1;
    } catch (err) {
      console.error(`[SpendLimit] Alert failed for member ${m.id}:`, err.message);
    }
  }
  return { alerted };
};

module.exports = {
  LIMITED_ROLES, monthBounds, memberMonthSpend, isLimited, limitStatus, runAlerts,
};
