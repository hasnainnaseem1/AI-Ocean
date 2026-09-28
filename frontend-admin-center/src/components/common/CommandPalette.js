import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Modal, Input, Empty, Spin, Typography } from 'antd';
import { SearchOutlined, ArrowRightOutlined, TeamOutlined, ExperimentOutlined, ClusterOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { usePermission } from '../../hooks/usePermission';
import { useFeatures } from '../../contexts/FeatureContext';
import { useTheme } from '../../contexts/ThemeContext';
import { visibleDestinations } from '../../config/navigation';
import { PERMISSIONS } from '../../utils/permissions';
import { hairline, muted, brandSoft, getBrand, microLabelStyle } from '../../theme/colors';
import customersApi from '../../api/customersApi';
import { modelsApi, tiersApi } from '../../api/catalogApi';

const { Text } = Typography;

const DEBOUNCE_MS = 220;
const MIN_LIVE_QUERY = 2;
const LIVE_LIMIT = 5;

/**
 * Ctrl/Cmd+K — jump to any page, or to a specific customer, model or tier,
 * without opening the sidebar. Mounted once in AppLayout.
 *
 * Two result sources, merged into one flat, keyboard-navigable list:
 *   1. Every nav destination this admin can see (config/navigation.js),
 *      matched against its label, section and keywords — instant, no network.
 *   2. Live records — customers, models, tiers — fetched only once the query
 *      is at least MIN_LIVE_QUERY characters, debounced so every keystroke
 *      doesn't fire three requests.
 *
 * With an empty query it shows the full destination list, since 26 items is
 * short enough to browse — that also makes the palette double as "what can
 * this app even do", which the accordion sidebar it replaced made harder to
 * see at a glance.
 */
const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [liveResults, setLiveResults] = useState([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const { features } = useFeatures();
  const { isDark } = useTheme();

  const destinations = useMemo(
    () => visibleDestinations(hasPermission, features),
    [hasPermission, features]
  );

  // ── global Ctrl/Cmd+K + Escape ──
  useEffect(() => {
    const onKeyDown = (e) => {
      const isK = e.key === 'k' || e.key === 'K';
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setLiveResults([]);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // ── live search, debounced ──
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < MIN_LIVE_QUERY) {
      setLiveResults([]);
      setLiveLoading(false);
      return undefined;
    }
    setLiveLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const [customersRes, modelsRes, tiersRes] = await Promise.allSettled([
          hasPermission(PERMISSIONS.CUSTOMERS_VIEW)
            ? customersApi.getCustomers({ search: q, limit: LIVE_LIMIT })
            : Promise.resolve(null),
          hasPermission(PERMISSIONS.MODELS_VIEW)
            ? modelsApi.getModels({ search: q, limit: LIVE_LIMIT })
            : Promise.resolve(null),
          hasPermission(PERMISSIONS.MODELS_VIEW)
            ? tiersApi.getTiers({ search: q, limit: LIVE_LIMIT })
            : Promise.resolve(null),
        ]);

        const results = [];
        const customers = customersRes.status === 'fulfilled' ? customersRes.value?.customers : null;
        (customers || []).slice(0, LIVE_LIMIT).forEach((c) =>
          results.push({
            kind: 'live', section: 'Customers', icon: <TeamOutlined />,
            label: c.name || c.email, subtitle: c.email,
            path: `/customers/${c.id}`,
          })
        );
        const models = modelsRes.status === 'fulfilled' ? modelsRes.value?.models : null;
        (models || []).slice(0, LIVE_LIMIT).forEach((m) =>
          results.push({
            kind: 'live', section: 'Models', icon: <ExperimentOutlined />,
            label: m.name, subtitle: m.provider || m.family,
            path: `/models/${m.id}/edit`,
          })
        );
        // GET /admin/tiers has no `search` param — it always returns the
        // whole (short) list, so the match happens here instead of on the
        // server. Fine for tiers specifically: the platform has a handful of
        // machine types, not pages of them.
        const tiers = tiersRes.status === 'fulfilled' ? tiersRes.value?.tiers : null;
        (tiers || [])
          .filter((t) => (t.name || '').toLowerCase().includes(q.toLowerCase()))
          .slice(0, LIVE_LIMIT)
          .forEach((t) =>
            results.push({
              kind: 'live', section: 'Tiers', icon: <ClusterOutlined />,
              label: t.name, subtitle: t.gpuType || t.description,
              path: '/tiers',
            })
          );
        setLiveResults(results);
      } catch {
        setLiveResults([]);
      } finally {
        setLiveLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [query, hasPermission]);

  const matchedDestinations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return destinations;
    return destinations.filter((d) => {
      const haystack = [d.label, d.section, ...(d.keywords || [])].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [destinations, query]);

  const results = useMemo(
    () => [
      ...matchedDestinations.map((d) => ({ kind: 'nav', ...d })),
      ...liveResults,
    ],
    [matchedDestinations, liveResults]
  );

  const goTo = useCallback((item) => {
    if (!item) return;
    navigate(item.key || item.path);
    setOpen(false);
  }, [navigate]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      goTo(results[activeIndex]);
    }
  };

  // Group for display without losing the flat index used for arrow-key nav.
  const grouped = useMemo(() => {
    const bySection = new Map();
    results.forEach((item, index) => {
      const section = item.section || 'Pages';
      if (!bySection.has(section)) bySection.set(section, []);
      bySection.get(section).push({ ...item, index });
    });
    return [...bySection.entries()];
  }, [results]);

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      closable={false}
      width={560}
      style={{ top: 96 }}
      styles={{
        body: { padding: 0 },
        mask: { backdropFilter: 'blur(2px)' },
      }}
    >
      {/* Modal's own body padding is zeroed above (`styles.body`), so this
          wrapper owns the rounded-corner clip — it matches the Modal's own
          radius since both come from the same `borderRadiusLG` token. */}
      <div style={{ borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: 14, borderBottom: `1px solid ${hairline(isDark)}` }}>
        <Input
          ref={inputRef}
          size="large"
          variant="borderless"
          prefix={<SearchOutlined style={{ color: muted(isDark) }} />}
          placeholder="Search pages, customers, models, tiers…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
          onKeyDown={onKeyDown}
        />
      </div>

      <div style={{ maxHeight: 420, overflowY: 'auto', padding: '8px 0' }}>
        {liveLoading && query.trim().length >= MIN_LIVE_QUERY && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
            <Spin size="small" />
          </div>
        )}

        {results.length === 0 && !liveLoading ? (
          <Empty
            description="Nothing matches that."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ padding: '24px 0' }}
          />
        ) : (
          grouped.map(([section, items]) => (
            <div key={section} style={{ marginBottom: 4 }}>
              <div style={{ ...microLabelStyle(isDark), padding: '8px 18px 4px' }}>{section}</div>
              {items.map((item) => {
                const isActive = item.index === activeIndex;
                return (
                  <div
                    key={`${section}-${item.key || item.path}-${item.label}`}
                    role="button"
                    tabIndex={-1}
                    onMouseEnter={() => setActiveIndex(item.index)}
                    onClick={() => goTo(item)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 18px', cursor: 'pointer',
                      background: isActive ? brandSoft(isDark) : 'transparent',
                    }}
                  >
                    <span style={{ color: isActive ? getBrand(isDark) : muted(isDark), fontSize: 15, width: 18 }}>
                      {item.icon}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: isActive ? getBrand(isDark) : undefined }}>
                        {item.label}
                      </div>
                      {item.subtitle && (
                        <Text style={{ fontSize: 12, color: muted(isDark) }} ellipsis>
                          {item.subtitle}
                        </Text>
                      )}
                    </div>
                    {isActive && <ArrowRightOutlined style={{ color: getBrand(isDark), fontSize: 12 }} />}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div
        style={{
          borderTop: `1px solid ${hairline(isDark)}`,
          padding: '8px 18px',
          display: 'flex', gap: 14, fontSize: 11.5, color: muted(isDark),
        }}
      >
        <span>↑↓ navigate</span>
        <span>↵ open</span>
        <span>esc close</span>
      </div>
      </div>
    </Modal>
  );
};

export default CommandPalette;

/** Opens the palette programmatically — used by the header's search pill. */
export const openCommandPalette = () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
};
