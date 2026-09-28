import React, { useEffect, useRef, useState } from 'react';
import { Typography, Input, InputNumber, Button } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { useTheme } from '../../context/ThemeContext';
import { getBrand, brandSoft, monoNumeric, SURFACE } from '../../theme/colors';
import { formatRate } from '../../utils/money';
import { formatNumber } from '../../utils/format';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

/**
 * Shared pieces of the deploy journey.
 *
 * The design brief was "no forms" — so answers are picked from large, obviously
 * clickable cards rather than dropdowns and radio buttons, the way choosing a
 * droplet size works. Everything here is sized for that: generous hit areas,
 * one clear selected state, and a keyboard hint on each option so the whole
 * flow can be driven without a mouse.
 */

/* ── Machine specs ──────────────────────────────────────────────────────── */

/**
 * The one place a tier's specification is put into words.
 *
 * Not every machine has an accelerator — a CPU- or memory-optimised tier has
 * none — so each part is only mentioned when the machine actually has it.
 * Shared rather than repeated per screen so the recommendation, the review and
 * the sizing chip can never describe the same machine differently.
 *
 * @param {object} tier
 * @param {'short'|'full'} detail  short = headline numbers only
 */
export const tierSpecLine = (tier, detail = 'full') => {
  if (!tier) return '';
  const parts = [];

  if (tier.gpuCount > 0) {
    const vram = tier.totalVramGb ?? (tier.vramGb || 0) * tier.gpuCount;
    parts.push(
      detail === 'short'
        ? `${vram} GB VRAM · ${tier.gpuCount} GPU${tier.gpuCount === 1 ? '' : 's'}`
        : `${tier.gpuCount}× ${tier.gpuModel || 'accelerator'} · ${vram} GB VRAM`
    );
  }

  if (tier.vcpu) parts.push(`${tier.vcpu} vCPU`);
  if (tier.ramGb) parts.push(`${tier.ramGb} GB RAM`);

  // Storage is what the customer keeps paying for after they stop, so it earns
  // its place on the full line even though it is rarely what they are choosing on.
  if (detail === 'full' && tier.storageGb) {
    parts.push(`${tier.storageGb} GB ${tier.storageType || 'storage'}`);
  }

  return parts.join(' · ');
};

/* ── Progress rail ──────────────────────────────────────────────────────── */

/**
 * A thin segmented bar rather than antd's <Steps>. Fourteen numbered steps
 * with titles would dominate the screen and make the flow feel long; this
 * says "you are moving" without competing with the question.
 */
export const ProgressRail = ({ current, total, label }) => {
  const { isDark } = useTheme();
  const BRAND = getBrand(isDark);
  const track = isDark ? SURFACE.borderDark : SURFACE.borderLight;

  return (
    <div style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: i <= current ? BRAND : track,
              opacity: i <= current ? 1 : 0.6,
              transition: 'background 320ms ease, opacity 320ms ease',
            }}
          />
        ))}
      </div>
      {/* Only when the caller has nowhere else to put it — the step eyebrow
          above each question already says this, and printing it twice reads
          as a mistake. */}
      {label && (
        <Text type="secondary" style={{ fontSize: 12, letterSpacing: '0.04em' }}>
          {label}
        </Text>
      )}
    </div>
  );
};

/* ── Live sizing chip ───────────────────────────────────────────────────── */

/**
 * The running total of what the answers so far imply. This is the part that
 * makes the journey feel alive: the customer watches the recommendation build
 * itself instead of waiting for a verdict at the end.
 *
 * Only shown once the engine actually has an opinion — an empty chip reading
 * "0 GB" before anyone has answered would be noise pretending to be signal.
 */
export const LiveSizingChip = ({ recommendation, currency, loading }) => {
  const { t } = useTranslation(['deploy', 'common']);
  const { isDark } = useTheme();
  const BRAND = getBrand(isDark);
  const [bump, setBump] = useState(false);
  const previous = useRef(null);

  const tier = recommendation?.recommendation?.primary;
  const signature = tier ? `${tier.tierId}-${tier.pricePerHour}` : null;

  useEffect(() => {
    const changed = signature && previous.current && signature !== previous.current;
    // Record the new signature either way. Updating it only on the non-bump
    // path would freeze `previous` at the first value forever, so every later
    // change would keep re-triggering against a stale comparison.
    previous.current = signature;

    if (!changed) return undefined;

    setBump(true);
    const timer = setTimeout(() => setBump(false), 450);
    return () => clearTimeout(timer);
  }, [signature]);

  if (!tier || recommendation?.confidence === 'none') return null;

  return (
    <div
      className={bump ? 'sizing-bump' : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 12,
        padding: '10px 16px', borderRadius: 999,
        background: brandSoft(isDark),
        border: `1px solid ${isDark ? SURFACE.borderDark : SURFACE.borderLight}`,
        opacity: loading ? 0.6 : 1,
        transition: 'opacity 160ms ease',
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: BRAND }}>
        {t('deploy:journey.sizingSoFar')}
      </Text>
      <Text strong style={{ fontSize: 13, ...monoNumeric }}>
        {tierSpecLine(tier, 'short')}
      </Text>
      <Text strong style={{ fontSize: 13, color: BRAND, ...monoNumeric }}>
        ~{currency} {formatRate(tier.pricePerHour)}{t('common:units.perHour')}
      </Text>
    </div>
  );
};

/* ── Option card ────────────────────────────────────────────────────────── */

/**
 * One selectable answer. `index` drives the number badge, which doubles as the
 * keyboard shortcut — pressing 3 picks the third option.
 */
export const OptionCard = ({ label, description, selected, index, onClick, multi }) => {
  const { isDark } = useTheme();
  const BRAND = getBrand(isDark);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="journey-option"
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '16px 18px',
        borderRadius: 14,
        cursor: 'pointer',
        border: `1.5px solid ${selected ? BRAND : (isDark ? SURFACE.borderDark : SURFACE.borderLight)}`,
        background: selected
          ? brandSoft(isDark)
          : (isDark ? SURFACE.cardBgDark : SURFACE.cardBgLight),
        transition: 'border-color 140ms ease, background 140ms ease, transform 140ms ease',
        animationDelay: `${Math.min(index, 8) * 35}ms`,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      {/* Number badge doubles as the keyboard hint */}
      <div style={{
        width: 26, height: 26, flexShrink: 0,
        borderRadius: multi ? 7 : '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700,
        background: selected ? BRAND : (isDark ? 'rgba(255,255,255,0.06)' : '#F1F4FB'),
        color: selected ? '#fff' : (isDark ? '#9BA1BC' : '#8A90AB'),
        transition: 'background 140ms ease, color 140ms ease',
      }}>
        {selected ? <CheckOutlined style={{ fontSize: 12 }} /> : (index < 9 ? index + 1 : '')}
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <Text strong style={{ fontSize: 15, display: 'block' }}>{label}</Text>
        {description && (
          <Text type="secondary" style={{ fontSize: 12.5 }}>{description}</Text>
        )}
      </div>
    </div>
  );
};

/* ── Free-form inputs ───────────────────────────────────────────────────── */

/**
 * Text and number answers, set at display size so they read as part of the
 * conversation rather than as a form field dropped into it.
 */
export const BigInput = ({ value, onChange, placeholder, onEnter, autoFocus }) => {
  const { t } = useTranslation(['deploy', 'common']);
  const { isDark } = useTheme();

  return (
    <Input
      variant="borderless"
      autoFocus={autoFocus}
      value={value || ''}
      placeholder={placeholder || t('deploy:question.typeAnswer')}
      onChange={(e) => onChange(e.target.value)}
      onPressEnter={onEnter}
      style={{
        fontSize: 22,
        padding: '10px 0',
        borderBottom: `2px solid ${isDark ? SURFACE.borderDark : SURFACE.borderLight}`,
        borderRadius: 0,
      }}
    />
  );
};

export const BigTextArea = ({ value, onChange, placeholder, autoFocus }) => {
  const { t } = useTranslation(['deploy', 'common']);
  const { isDark } = useTheme();

  return (
    <>
      <Input.TextArea
        variant="borderless"
        autoFocus={autoFocus}
        rows={4}
        value={value || ''}
        placeholder={placeholder || t('deploy:question.typeAnswer')}
        onChange={(e) => onChange(e.target.value)}
        style={{
          fontSize: 17,
          padding: '10px 0',
          borderBottom: `2px solid ${isDark ? SURFACE.borderDark : SURFACE.borderLight}`,
          borderRadius: 0,
          resize: 'none',
        }}
      />
      {/* Enter belongs to the textarea here, so say how to move on. */}
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
        {t('deploy:journey.pressCtrlEnter')}
      </Text>
    </>
  );
};

export const BigNumber = ({ value, onChange, placeholder, onEnter, autoFocus }) => {
  const { isDark } = useTheme();

  return (
    <InputNumber
      variant="borderless"
      autoFocus={autoFocus}
      value={value ?? null}
      placeholder={placeholder || '0'}
      onChange={onChange}
      onPressEnter={onEnter}
      style={{
        fontSize: 22,
        width: '100%',
        padding: '10px 0',
        borderBottom: `2px solid ${isDark ? SURFACE.borderDark : SURFACE.borderLight}`,
        borderRadius: 0,
        ...monoNumeric,
      }}
    />
  );
};

/* ── Thinking indicator ─────────────────────────────────────────────────── */

/** Shown while /recommend is genuinely in flight — never as decoration. */
export const ThinkingDots = ({ label }) => {
  const { t } = useTranslation(['deploy', 'common']);
  const { isDark } = useTheme();
  const BRAND = getBrand(isDark);

  return (
    <div style={{ textAlign: 'center', padding: '60px 0' }}>
      <div className="journey-thinking" style={{ color: BRAND, marginBottom: 16 }}>
        <span />
        <span />
        <span />
      </div>
      <Text type="secondary">{label || t('deploy:journey.workingOut')}</Text>
    </div>
  );
};

/* ── Shared constraint blocker ──────────────────────────────────────────── */

/**
 * Find a hard constraint that blocks *every* option we can offer.
 *
 * When a single high-severity issue code appears on all of them, swapping
 * models cannot help — the wall is something the customer told us (usually a
 * budget), not a property of any one model. Saying so beats letting them click
 * through four cards that each hit the same limit.
 *
 * Used by both the model-match screen and the recommendation screen, so the
 * two never disagree about whether a requirement is satisfiable. Pass
 * `currentIssues` when there is already a chosen model that must also be
 * blocked; omit it to judge purely from the candidates.
 */
export const findSharedBlocker = (matches, currentIssues = null) => {
  if (!matches || !matches.length) return null;

  const source = (currentIssues && currentIssues.length)
    ? currentIssues
    : (matches[0].issues || []);

  const highCodes = source.filter((issue) => issue.severity === 'high').map((issue) => issue.code);
  if (!highCodes.length) return null;

  const code = highCodes.find((c) => matches.every(
    (m) => (m.issues || []).some((issue) => issue.code === c)
  ));

  return code ? source.find((issue) => issue.code === code) : null;
};

/**
 * States the wall plainly and offers the one thing that actually clears it:
 * going back to the answer that set it.
 *
 * The wording is NOT written here. It arrives on the `/recommend` response as
 * `blockerTemplates`, straight from the admin-editable recommendation policy,
 * so this sentence has exactly one home and cannot drift from the per-issue
 * text the backend produced beside it.
 */
export const BlockerNotice = ({ blocker, matches, currency, templates, onEditAnswer }) => {
  const { t } = useTranslation(['deploy', 'common']);
  const { isDark } = useTheme();

  const copy = templates || {};
  const text = copy[blocker.code] || copy.DEFAULT || '';
  if (!text) return null;

  const closest = (matches || []).reduce((min, m) => (
    m.estimatedMonthlyCost != null
    && (!min || m.estimatedMonthlyCost < min.estimatedMonthlyCost) ? m : min
  ), null);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, flexWrap: 'wrap',
      padding: '12px 14px', borderRadius: 10, marginBottom: 16,
      background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    }}>
      <Text style={{ fontSize: 13, flex: 1, minWidth: 240 }}>
        {text}
        {closest && blocker.code === 'BUDGET_IMPOSSIBLE' && (
          <>
            {' '}{t('deploy:journey.closestIs')} <Text strong style={{ fontSize: 13 }}>{closest.model.name}</Text>
            {' '}{t('deploy:journey.atAboutPerMonth', { amount: `${currency} ${formatNumber(Math.round(closest.estimatedMonthlyCost))}` })}
          </>
        )}
      </Text>
      {blocker.questionKey && onEditAnswer && (
        <Button
          size="small"
          onClick={() => onEditAnswer(blocker.questionKey)}
          style={{ flexShrink: 0, borderRadius: 8 }}
        >
          {t('deploy:question.changeYourAnswer')}
        </Button>
      )}
    </div>
  );
};

/* ── Step heading ───────────────────────────────────────────────────────── */

export const StepHeading = ({ eyebrow, title, subtitle }) => (
  <div style={{ marginBottom: 28 }}>
    {eyebrow && (
      <Text
        style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.09em',
          textTransform: 'uppercase', opacity: 0.55, display: 'block', marginBottom: 10,
        }}
      >
        {eyebrow}
      </Text>
    )}
    <Typography.Title level={2} style={{ margin: 0, fontSize: 30, letterSpacing: '-0.02em' }}>
      {title}
    </Typography.Title>
    {subtitle && (
      <Text type="secondary" style={{ fontSize: 15, display: 'block', marginTop: 8 }}>
        {subtitle}
      </Text>
    )}
  </div>
);
