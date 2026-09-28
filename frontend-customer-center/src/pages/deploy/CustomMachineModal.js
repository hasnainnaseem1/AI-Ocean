import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, Typography, Slider, Select, Row, Col, Alert, Space, Spin, Empty, InputNumber,
} from 'antd';
import { useTheme } from '../../context/ThemeContext';
import { useBilling } from '../../context/SiteContext';
import catalogApi from '../../api/catalogApi';
import { formatRate, formatAmount } from '../../utils/money';
import { useTranslation } from 'react-i18next';
import {
  cardStyle as surfaceStyle, getBrand, monoNumeric, SURFACE,
} from '../../theme/colors';

const { Title, Text } = Typography;

/** Re-price as the slider moves, without a request per pixel. */
const QUOTE_DEBOUNCE_MS = 250;

/**
 * Sliders need a finite track, and the admin's own ceiling
 * (`ResourceComponent.maxQuantity`) is 0 for "no limit". These are the fallback
 * ends of the track, nothing more — an admin who wants a real cap sets
 * `maxQuantity` on the component and it is used instead.
 */
const OPEN_ENDED_MAX = {
  gpu: 8,
  cpu: 128,
  memory: 1024,
  storage: 8000,
  network: 100,
};

/**
 * Keys, not labels — a module-level constant has no `t` in scope, and a label
 * resolved at import time would keep the first language the modal rendered in.
 * Translated where the slider row is built.
 */
const KIND_LABEL_KEY = {
  gpu: 'deploy:builder.accelerator',
  cpu: 'deploy:builder.processor',
  memory: 'deploy:builder.memory',
  storage: 'deploy:builder.disk',
  network: 'deploy:builder.network',
};

const KIND_ORDER = ['gpu', 'cpu', 'memory', 'storage', 'network'];

/**
 * Start the builder from the machine already on screen.
 *
 * "Customize" means "change this one", not "start from an empty box" — a
 * builder that opens on 1 vCPU and 1 GB of RAM makes the customer rebuild from
 * scratch something they were just shown, and the price it opens on bears no
 * relation to the one they were reading a second ago.
 *
 * Matching is by what the part IS, not by name: the accelerator is the one
 * whose model and VRAM match the machine's, and the disk is the one whose type
 * matches. Anything with no match falls back to the smallest amount the admin
 * allows, so an unusual machine still opens on something sane rather than
 * nothing.
 */
const seedFrom = (tier, components) => {
  const chosen = {};
  const amounts = {};
  const eq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

  const pick = (kind, match, quantity) => {
    const options = components.filter((c) => c.kind === kind);
    if (!options.length) return;
    const found = (match && options.find(match)) || options[0];
    chosen[kind] = found.id;
    const floor = Math.max(found.minQuantity || 0, found.stepQuantity || 1);
    amounts[found.id] = Math.max(floor, Math.round(Number(quantity) || 0));
  };

  pick('gpu', (c) => eq(c.specs?.model, tier?.gpuModel)
    && (!tier?.vramGb || Number(c.specs?.vramGb) === Number(tier.vramGb)), tier?.gpuCount);
  pick('cpu', null, tier?.vcpu);
  pick('memory', null, tier?.ramGb);
  pick('storage', (c) => eq(c.specs?.mediaType, tier?.storageType)
    || eq(c.name, tier?.storageType), tier?.storageGb);
  pick('network', null, tier?.networkGbps);

  return { chosen, amounts };
};

/**
 * Build your own machine.
 *
 * Everything the customer sees here is priced by the server, on every change —
 * the same function that prices the catalogue's own machines. Nothing is
 * multiplied out in the browser, so the number on this screen is the number
 * that gets billed.
 *
 * The sliders themselves are deliberately unconstrained: a customer is free to
 * build whatever they want. The one thing that is enforced is VRAM, because a
 * machine with less than the model needs cannot load it at all — the
 * deployment would be provisioned, start charging, and then fail. So that one
 * shows as a blocker and the confirm button refuses.
 */
const CustomMachineModal = ({ open, onClose, onUse, model, baseTier }) => {
  const { t } = useTranslation(['deploy', 'common']);
  const { isDark } = useTheme();
  const { currency } = useBilling();
  const BRAND = getBrand(isDark);

  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // componentId -> quantity, plus which component is chosen per kind
  const [chosen, setChosen] = useState({});   // kind -> componentId
  const [amounts, setAmounts] = useState({}); // componentId -> quantity

  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const quoteTicket = useRef(0);

  /* ── The parts on offer ─────────────────────────────────────────────── */

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);

    catalogApi.getCustomBuildOptions()
      .then((data) => {
        if (cancelled) return;
        const list = data.components || [];
        setComponents(list);

        // Open on the machine they are already looking at — see seedFrom.
        const seed = seedFrom(baseTier, list);
        setChosen(seed.chosen);
        setAmounts(seed.amounts);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.response?.data?.message || t('deploy:builder.loadFailed'));
      })
      .finally(() => !cancelled && setLoading(false));

    return () => { cancelled = true; };
    // Seeded once per open. Re-seeding when `baseTier` changes would throw away
    // a build in progress the moment the page behind updated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const byKind = useMemo(() => {
    const map = {};
    components.forEach((c) => { (map[c.kind] = map[c.kind] || []).push(c); });
    return map;
  }, [components]);

  const picks = useMemo(() => Object.values(chosen)
    .filter(Boolean)
    .map((id) => ({ componentId: id, quantity: amounts[id] || 0 }))
    .filter((p) => p.quantity > 0), [chosen, amounts]);

  /* ── Price it, every time anything moves ────────────────────────────── */

  const signature = JSON.stringify(picks);

  useEffect(() => {
    if (!open || !picks.length) { setQuote(null); return undefined; }

    const ticket = ++quoteTicket.current;
    setQuoting(true);

    const timer = setTimeout(() => {
      catalogApi.quoteCustomBuild({ picks, modelId: model?.slug || model?.id })
        .then((data) => { if (ticket === quoteTicket.current) setQuote(data); })
        .catch(() => { if (ticket === quoteTicket.current) setQuote(null); })
        .finally(() => { if (ticket === quoteTicket.current) setQuoting(false); });
    }, QUOTE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `signature` is the value that actually changes; `picks` is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, signature, model?.slug, model?.id]);

  const setAmount = useCallback((componentId, value) => {
    setAmounts((prev) => ({ ...prev, [componentId]: value }));
  }, []);

  const swapComponent = useCallback((kind, componentId) => {
    setChosen((prev) => ({ ...prev, [kind]: componentId }));
    setAmounts((prev) => {
      if (prev[componentId] !== undefined) return prev;
      const c = components.find((x) => x.id === componentId);
      return { ...prev, [componentId]: Math.max(c?.minQuantity || 0, c?.stepQuantity || 1) };
    });
  }, [components]);

  const shortfall = quote?.vramShortfall || null;
  const canUse = !!quote && !quote.empty && !shortfall && !quoting;

  const use = () => {
    if (!canUse) return;
    onUse({
      picks,
      specs: quote.specs,
      pricePerHour: quote.pricePerHour,
      pricePerDay: quote.pricePerDay,
      pricePerMonth: quote.pricePerMonth,
      stoppedPricePerHour: quote.stoppedPricePerHour,
      stoppedPricePerMonth: quote.stoppedPricePerMonth,
      currency: quote.currency,
    });
  };

  const row = (kind) => {
    const options = byKind[kind] || [];
    if (!options.length) return null;
    const id = chosen[kind];
    const c = options.find((x) => x.id === id) || options[0];
    if (!c) return null;

    const min = c.minQuantity || 0;
    const max = c.maxQuantity > 0 ? c.maxQuantity : (OPEN_ENDED_MAX[kind] || 64);
    const step = c.stepQuantity || 1;
    const value = amounts[c.id] ?? min;

    return (
      <div key={kind} style={{ marginBottom: 22 }}>
        <Row align="middle" justify="space-between" gutter={[12, 6]} style={{ marginBottom: 4 }}>
          <Col>
            <Text style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: isDark ? '#9BA1BC' : '#8A90AB',
            }}>
              {KIND_LABEL_KEY[kind] ? t(KIND_LABEL_KEY[kind]) : kind}
            </Text>
          </Col>
          <Col>
            {/*
              * A slider is the right control for "a bit more, a bit less", and
              * the wrong one for "exactly 256 GB" — that is a long drag at a
              * 1 GB step. The box is the same value, typed. Both clamp to the
              * admin's own min/max/step; neither invents a range.
              */}
            <Space size={6} align="center">
              <InputNumber
                size="small"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(v) => setAmount(c.id, Math.min(Math.max(Number(v) || min, min), max))}
                style={{ width: 92, ...monoNumeric }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>{c.unitLabel}</Text>
            </Space>
          </Col>
        </Row>

        {options.length > 1 && (
          <Select
            size="small"
            value={c.id}
            onChange={(next) => swapComponent(kind, next)}
            style={{ width: '100%', marginBottom: 8 }}
            options={options.map((o) => ({ value: o.id, label: o.name }))}
          />
        )}

        <Slider
          min={min}
          max={max}
          step={step}
          value={Math.min(value, max)}
          onChange={(v) => setAmount(c.id, v)}
          tooltip={{ formatter: (v) => `${v} ${c.unitLabel}` }}
        />

        {c.billedWhileStopped && (
          <Text type="secondary" style={{ fontSize: 11.5 }}>
            {t('deploy:builder.billedWhileStopped')}
          </Text>
        )}
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={use}
      okText={t('deploy:builder.use')}
      okButtonProps={{ disabled: !canUse }}
      width={760}
      title={t('deploy:builder.title')}
      destroyOnHidden
    >
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center' }}><Spin size="large" /></div>
      ) : loadError ? (
        <Alert type="error" showIcon message={loadError} />
      ) : !components.length ? (
        <Empty description={t('deploy:builder.noParts')} style={{ padding: 40 }} />
      ) : (
        <Row gutter={[28, 20]}>
          <Col xs={24} md={14}>
            {KIND_ORDER.map(row)}
          </Col>

          <Col xs={24} md={10}>
            <div style={{
              ...surfaceStyle(isDark),
              padding: 18,
              position: 'sticky',
              top: 0,
            }}>
              <Text type="secondary" style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>
                {t('deploy:builder.yourMachine')}
              </Text>

              <div style={{ marginTop: 10, marginBottom: 14, minHeight: 40 }}>
                {quote && !quote.empty ? (
                  <Text style={{ fontSize: 13, ...monoNumeric }}>
                    {quote.specs.gpuCount > 0 && (
                      <>{quote.specs.gpuCount}× {quote.specs.gpuModel} · {quote.specs.totalVramGb} GB VRAM<br /></>
                    )}
                    {quote.specs.vcpu} vCPU · {quote.specs.ramGb} GB RAM<br />
                    {quote.specs.storageGb} GB {quote.specs.storageType}
                    {quote.specs.networkGbps > 0 && <> · {quote.specs.networkGbps} Gbps</>}
                  </Text>
                ) : (
                  <Text type="secondary" style={{ fontSize: 13 }}>{t('deploy:builder.moveSlider')}</Text>
                )}
              </div>

              <div style={{
                paddingTop: 14,
                borderTop: `1px solid ${isDark ? SURFACE.borderDark : SURFACE.borderLight}`,
              }}>
                {/* Priced by the server on every change, so this is the rate
                    that gets billed — not an estimate. */}
                <Space align="baseline" size={6}>
                  <Title level={2} style={{
                    margin: 0, color: BRAND, fontWeight: 800,
                    letterSpacing: '-0.03em', ...monoNumeric,
                    opacity: quoting ? 0.45 : 1,
                    transition: 'opacity 120ms ease',
                  }}>
                    {currency} {formatRate(quote?.pricePerHour || 0)}
                  </Title>
                  <Text type="secondary" style={{ fontSize: 13 }}>{t('common:units.perHour')}</Text>
                </Space>

                <Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginTop: 2 }}>
                  {t('deploy:builder.perMonth', { amount: `${currency} ${formatAmount(quote?.pricePerMonth || 0)}` })}
                </Text>
                {quote?.stoppedPricePerHour > 0 && (
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    {t('deploy:builder.whilePaused', { amount: `${currency} ${formatRate(quote.stoppedPricePerHour)}` })}
                  </Text>
                )}
              </div>

              {shortfall && (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginTop: 14, borderRadius: 10 }}
                  message={t('deploy:builder.tooSmall')}
                  description={t('deploy:builder.tooSmallBody', { model: model?.name || t('deploy:builder.thisModel'), needs: shortfall.needsVramGb, has: shortfall.totalVramGb })}
                />
              )}

              {quote?.dropped?.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 14, borderRadius: 10 }}
                  message={t('deploy:builder.partsDropped')}
                />
              )}
            </div>
          </Col>
        </Row>
      )}
    </Modal>
  );
};

export default CustomMachineModal;
