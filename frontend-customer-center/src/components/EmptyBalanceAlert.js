import React from 'react';
import { Alert, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { formatAmount } from '../utils/money';

/**
 * ── What an empty balance actually means for THIS customer ──
 *
 * Both the dashboard and the billing page used to tell anyone whose balance hit
 * zero that "running deployments have been paused". For a pay-as-you-go account
 * that is simply untrue: nothing is paused, the machines are still running, and
 * their usage is going onto an outstanding balance the banner never mentioned.
 * On the dashboard it contradicted the stat card directly beneath it, which
 * read "0 paused".
 *
 * So the message is chosen from what is really there. One component rather than
 * one copy per page, because the rule it encodes is about how this platform
 * bills, and two copies of that drift the moment the billing rules move again.
 *
 * ── Where each fact comes from, and why ──
 *
 * Whether pay-as-you-go is still running comes from `wallet.burnRateByMethod`,
 * which the server computes across the whole account. The deployment list does
 * NOT decide it: the dashboard fetches only the first handful for its "recent
 * deployments" panel, so a customer with more than that could have the banner
 * read from a partial list and state the opposite of the truth — which is the
 * exact class of bug this component exists to fix.
 *
 * The list is still used for the prepaid half, because "stopped for credit"
 * needs `autoSuspendedForCredit`, which only exists per deployment. Nothing is
 * counted from it, only detected, so a partial list can understate the
 * situation but can never assert a wrong number.
 *
 * Renders nothing when there is nothing to say.
 */
const EmptyBalanceAlert = ({
  wallet, deployments = [], currency, onAddCredit, onAddCard,
  creditsEnabled = true, style, danger = false,
}) => {
  const { t } = useTranslation('common');
  if (!creditsEnabled || !wallet) return null;

  const outstanding = wallet.outstandingBalance ?? 0;
  const money = (n) => `${currency} ${formatAmount(n)}`;

  /*
   * The card gate is checked before the balance on every resume, so a wallet
   * that is empty AND missing a verified card needs the card added first —
   * topping up alone would silently fail to bring anything back.
   */
  const needsCard = !!wallet.cardGate?.required && !wallet.cardGate?.verified;

  const action = (
    <Button
      size="small"
      type="primary"
      danger={danger}
      onClick={() => (needsCard ? onAddCard?.() : onAddCredit?.())}
    >
      {needsCard ? t('emptyBalance.addCard') : t('emptyBalance.addCredit')}
    </Button>
  );

  /*
   * ── Over the pay-as-you-go limit ──
   *
   * Checked first, because it changes what every other sentence here would
   * say. Past the limit, pay-as-you-go is NOT covering anything any more: the
   * deployments were paused (debtEnforcement). Saying "pay-as-you-go is
   * covering your usage" at that point told the customer the opposite of
   * what had happened to their machines.
   *
   * Paused is not free: each paused machine keeps its disk, and that storage
   * is still charged and still goes onto the balance — so the banner says so,
   * with the rate, rather than letting the owed figure creep up unexplained.
   *
   * The verdict and the limits come from the server (debtService), so this
   * banner and the enforcement job can never disagree about who is blocked.
   */
  if (wallet.debtBlocked) {
    const tooOld = wallet.debtBlockedReason === 'DEBT_TOO_OLD';
    const limit = wallet.debtCreditLimit ?? 0;
    const storagePerDay = wallet.burnRatePerDay ?? 0;
    return (
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 20, borderRadius: 12, ...style }}
        message={tooOld ? t('emptyBalance.tooOldTitle') : t('emptyBalance.limitTitle')}
        description={(
          <span>
            {tooOld
              ? t('emptyBalance.tooOldBody', {
                count: wallet.debtDays ?? 0, max: wallet.debtMaxDays ?? 0, amount: money(outstanding),
              })
              : t('emptyBalance.limitBody', {
                owed: money(outstanding), limit: money(limit),
                over: money(Math.max(0, outstanding - limit)),
              })}
            {storagePerDay > 0 && <> {t('emptyBalance.pausedDiskCharged', { amount: money(storagePerDay) })}</>}
            {' '}
            <b>{tooOld ? t('emptyBalance.tooOldResume') : t('emptyBalance.limitResume')}</b>
            {needsCard && <> {t('emptyBalance.cardRequired')}</>}
          </span>
        )}
        action={action}
      />
    );
  }

  if ((wallet.balance ?? 0) > 0) return null;

  // Account-wide and authoritative — see the note above.
  const paygRunning = (wallet.burnRateByMethod?.payg ?? 0) > 0;

  // Prepaid stops when the wallet runs dry; pay-as-you-go does not. Telling a
  // customer the wrong one is worse than saying nothing.
  const prepaidStopped = deployments.some(
    (d) => d.billingMethod !== 'payg'
      && d.autoSuspendedForCredit
      && ['paused', 'stopped'].includes(d.status)
  );
  const prepaidRunning = deployments.some(
    (d) => d.billingMethod !== 'payg' && d.status === 'running'
  );

  // An empty wallet with nothing running and nothing owed is not news.
  if (!prepaidStopped && !prepaidRunning && !paygRunning && outstanding <= 0) return null;

  const message = prepaidStopped
    ? t('emptyBalance.stoppedTitle')
    : paygRunning
      ? t('emptyBalance.paygTitle')
      : t('emptyBalance.emptyTitle');

  return (
    <Alert
      type={outstanding > 0 || prepaidStopped ? 'error' : 'warning'}
      showIcon
      style={{ marginBottom: 20, borderRadius: 12, ...style }}
      message={message}
      description={(
        <span>
          {prepaidStopped && <>{t('emptyBalance.stoppedBody')}{' '}</>}
          {!prepaidStopped && prepaidRunning && <>{t('emptyBalance.willStopBody')}{' '}</>}
          {paygRunning && <>{t('emptyBalance.paygBody')}{' '}</>}
          {outstanding > 0 && (
            <b>{t('emptyBalance.owed', { amount: money(outstanding) })}</b>
          )}
          {needsCard && <> {t('emptyBalance.cardRequired')}</>}
        </span>
      )}
      action={action}
    />
  );
};

export default EmptyBalanceAlert;
