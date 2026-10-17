import React, { useEffect, useState, useCallback } from 'react';
import {
  Row, Col, Card, Space, Typography, Button, Tag, Alert, Input, Modal, Tabs, message, Popconfirm,
} from 'antd';
import {
  SettingOutlined, CheckCircleOutlined, CopyOutlined, DeleteOutlined,
  SaveOutlined, PlusOutlined, UndoOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import TabHeader from '../../components/analytics/TabHeader';
import MetricLegend from '../../components/charts/MetricLegend';
import { TableRowsSkeleton } from '../../components/Skeletons';
import analyticsPolicyApi from '../../api/analyticsPolicyApi';
import { usePermission } from '../../hooks/usePermission';
import { PERMISSIONS } from '../../utils/permissions';
import { useTheme } from '../../contexts/ThemeContext';
import { muted, hairline, monoNumeric } from '../../theme/colors';

const { Text, Paragraph } = Typography;

/** What each section decides, in the operator's terms rather than the code's. */
const SECTION_BLURB = {
  windows: 'What a reporting period means: which presets exist, which calendar they are measured on, and the longest range anyone may ask for.',
  capacity: 'When a machine type counts as low or critical on stock, and how long capacity history is kept.',
  engagement: 'How many days of silence make an account active, cooling, dormant or gone — and what counts as "doing something".',
  customers: 'The activation funnel stages, how big an organization has to be to land in each size band, and the smallest sample a percentage is allowed to rest on.',
  churn: 'What each churn signal is worth, when it fires, the risk bands, and the exact sentence shown for every reason.',
  retention: 'What "retained" means, how many cohort months to show, and how long a gap counts as having come back.',
  receivables: 'The aging buckets debt is chased on, and the share of the total that counts as concentrated in one account.',
  support: 'SLA targets per priority, the backlog age bands, and how long a ticket may go unanswered.',
  traffic: 'Session idle time, what counts as a bounce, which paths collapse together, the bot list, and the collector rate limit.',
  dashboard: 'Which checks run in the attention queue, in what order, and what counts as bad enough to show.',
};

/**
 * The analytics policy editor.
 *
 * ── Why raw JSON per section, and not a generated form ──
 *
 * These sections are not flat key/value settings. `churn.reasonTemplates` is a
 * map of sentences, `dashboard.attention` is an ordered list of checks with
 * per-check options, `traffic.pathPatternRules` is a list of regex/pattern
 * pairs. A form builder that handled all of that would be a schema language,
 * and it would be wrong the first time somebody added a knob.
 *
 * So each section is edited as JSON, with the SHIPPED DEFAULT shown beside it.
 * That is the part that makes it usable: an operator overriding one threshold
 * can see exactly what they are overriding and what the rest falls back to,
 * rather than having to copy the whole subtree to be safe.
 *
 * ── Blank means inherit ──
 *
 * An empty section is not an empty object — it is "use the default". That is
 * what makes "change one thing" safe, and why the editor says so rather than
 * leaving somebody to find out.
 */
const AnalyticsPolicyPage = ({ embedded = false }) => {
  const { isDark } = useTheme();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission(PERMISSIONS.SETTINGS_EDIT);

  const [loading, setLoading] = useState(true);
  const [policies, setPolicies] = useState([]);
  const [usingDefaults, setUsingDefaults] = useState(true);
  const [defaults, setDefaults] = useState({});
  const [sections, setSections] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState('');

  const load = useCallback(async (keepId) => {
    setLoading(true);
    try {
      const [d, l] = await Promise.all([
        analyticsPolicyApi.getDefaults(),
        analyticsPolicyApi.list(),
      ]);
      setDefaults(d.defaults || {});
      setSections(d.sections || []);
      setPolicies(l.policies || []);
      setUsingDefaults(!!l.usingDefaults);
      const pick = (l.policies || []).find((p) => p.id === keepId)
        || (l.policies || []).find((p) => p.isActive)
        || (l.policies || [])[0];
      setSelectedId(pick?.id || null);
      setDraft(pick ? { ...pick } : {});
      setErrors({});
    } catch {
      message.error('Could not load the analytics policies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const select = (policy) => {
    setSelectedId(policy.id);
    setDraft({ ...policy });
    setErrors({});
  };

  const setSection = (section, text) => {
    setDraft((d) => ({ ...d, [section]: text }));
    if (!String(text).trim()) {
      setErrors((e) => ({ ...e, [section]: null }));
      return;
    }
    try {
      JSON.parse(text);
      setErrors((e) => ({ ...e, [section]: null }));
    } catch (err) {
      setErrors((e) => ({ ...e, [section]: err.message }));
    }
  };

  /** Turn the editor's text back into the payload the API expects. */
  const buildPayload = () => {
    const payload = { name: draft.name, description: draft.description };
    for (const section of sections) {
      const value = draft[section];
      if (value === undefined) continue;
      if (typeof value !== 'string') { payload[section] = value; continue; }
      // Blank means "inherit the default", which is null on the wire.
      payload[section] = String(value).trim() ? JSON.parse(value) : null;
    }
    return payload;
  };

  const save = async () => {
    if (Object.values(errors).some(Boolean)) {
      message.error('Fix the JSON errors first');
      return;
    }
    setSaving(true);
    try {
      await analyticsPolicyApi.update(selectedId, buildPayload());
      message.success('Saved — every cached figure was recomputed');
      await load(selectedId);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    const key = newKey.trim();
    if (!key) return;
    try {
      const { policy } = await analyticsPolicyApi.create({ key, name: key });
      message.success(`Created "${policy.key}"`);
      setCreating(false);
      setNewKey('');
      await load(policy.id);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not create the policy');
    }
  };

  const activate = async (id) => {
    try {
      await analyticsPolicyApi.activate(id);
      message.success('This policy is now live');
      await load(id);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not activate');
    }
  };

  const duplicate = async (id) => {
    try {
      const { policy } = await analyticsPolicyApi.duplicate(id, { key: `copy-${Date.now().toString(36)}` });
      message.success(`Copied to "${policy.key}"`);
      await load(policy.id);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not duplicate');
    }
  };

  const remove = async (id) => {
    try {
      await analyticsPolicyApi.remove(id);
      message.success('Policy deleted');
      await load(null);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not delete');
    }
  };

  const pretty = (value) => (value === undefined || value === null
    ? '' : JSON.stringify(value, null, 2));

  const selected = policies.find((p) => p.id === selectedId);

  const SUBTITLE = 'What the numbers mean — every threshold, band, weight and sentence the analytics pages are built on';
  const toolbar = (
    <>
      <Button size="small" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
        New policy
      </Button>
      {selected && !selected.isActive && (
        <Button size="small" icon={<CheckCircleOutlined />} onClick={() => activate(selected.id)}>
          Make live
        </Button>
      )}
      <Button size="small" type="primary" icon={<SaveOutlined />} loading={saving} disabled={!selected} onClick={save}>
        Save
      </Button>
    </>
  );

  return (
    <div>
      {embedded ? <TabHeader subtitle={SUBTITLE} extra={canEdit ? toolbar : null} /> : (
        <PageHeader
          title="Analytics policy"
          subtitle={SUBTITLE}
          breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Settings', path: '/settings' }, { label: 'Analytics policy' }]}
          extra={canEdit ? <Space>{toolbar}</Space> : null}
        />
      )}

      {/* No policy at all is a working state, not a broken one. Said plainly,
          because an empty list otherwise reads as "this feature is not set up". */}
      {usingDefaults && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14, borderRadius: 10 }}
          message="Running on the shipped defaults"
          description="No policy is live, so every analytics page is using the values this platform ships with. That is a perfectly good state — create one only when you want to change something."
        />
      )}

      <Row gutter={[14, 14]}>
        <Col xs={24} lg={6}>
          <Card size="small" title={<Text strong style={{ fontSize: 14 }}>Policies</Text>}>
            {loading ? <TableRowsSkeleton rows={3} /> : (
              <>
                {policies.map((p) => (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => select(p)}
                    onKeyDown={(e) => { if (e.key === 'Enter') select(p); }}
                    style={{
                      padding: '8px 9px',
                      marginBottom: 6,
                      borderRadius: 8,
                      cursor: 'pointer',
                      border: `1px solid ${p.id === selectedId ? muted(isDark) : hairline(isDark)}`,
                    }}
                  >
                    <Space size={6} align="baseline" style={{ justifyContent: 'space-between', width: '100%' }}>
                      <Text strong style={{ fontSize: 12.5 }}>{p.name}</Text>
                      {p.isActive && <Tag color="green" style={{ fontSize: 10, marginInlineEnd: 0 }}>Live</Tag>}
                    </Space>
                    <div><Text style={{ ...monoNumeric, fontSize: 11, color: muted(isDark) }}>{p.key}</Text></div>
                  </div>
                ))}
                {!policies.length && (
                  <Text type="secondary" style={{ fontSize: 12.5 }}>None yet — the defaults are in use</Text>
                )}

                {canEdit && selected && (
                  <Space style={{ marginTop: 10 }} size={6} wrap>
                    <Button size="small" icon={<CopyOutlined />} onClick={() => duplicate(selected.id)}>
                      Duplicate
                    </Button>
                    {/* Deleting the live policy is refused server-side: it
                        would silently revert every threshold on the platform. */}
                    <Popconfirm
                      title="Delete this policy?"
                      description={selected.isActive
                        ? 'This one is live — activate another first.'
                        : 'This cannot be undone.'}
                      onConfirm={() => remove(selected.id)}
                      disabled={selected.isActive}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} disabled={selected.isActive}>
                        Delete
                      </Button>
                    </Popconfirm>
                  </Space>
                )}
                <MetricLegend definition="Many policies, one live. Duplicate before retuning so the settings that work are not overwritten by an experiment." />
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={18}>
          {!selected ? (
            <Card size="small">
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                {loading ? 'Loading…' : 'Create a policy to override any of the shipped values.'}
              </Text>
            </Card>
          ) : (
            <Card
              size="small"
              title={(
                <Space size={7}>
                  <SettingOutlined />
                  <Text strong style={{ fontSize: 14 }}>{selected.name}</Text>
                  {selected.isActive && <Tag color="green" style={{ fontSize: 10 }}>Live</Tag>}
                </Space>
              )}
            >
              <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 12 }}>
                <Input
                  size="small"
                  addonBefore="Name"
                  value={draft.name || ''}
                  disabled={!canEdit}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
                <Input
                  size="small"
                  addonBefore="Description"
                  value={draft.description || ''}
                  disabled={!canEdit}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                />
              </Space>

              <Tabs
                size="small"
                items={sections.map((section) => {
                  const text = typeof draft[section] === 'string'
                    ? draft[section] : pretty(draft[section]);
                  const inherited = !String(text).trim();
                  return {
                    key: section,
                    label: (
                      <Space size={5}>
                        {section}
                        {errors[section] && <Tag color="red" style={{ fontSize: 9, marginInlineEnd: 0 }}>!</Tag>}
                        {inherited && <Tag style={{ fontSize: 9, marginInlineEnd: 0 }}>default</Tag>}
                      </Space>
                    ),
                    children: (
                      <Row gutter={[12, 12]}>
                        <Col xs={24} lg={13}>
                          <Paragraph style={{ fontSize: 12, marginBottom: 8 }}>
                            {SECTION_BLURB[section] || 'Overrides for this section.'}
                          </Paragraph>
                          <Input.TextArea
                            rows={16}
                            value={text}
                            disabled={!canEdit}
                            placeholder="Leave empty to use the shipped default"
                            onChange={(e) => setSection(section, e.target.value)}
                            style={{ ...monoNumeric, fontSize: 11.5 }}
                            status={errors[section] ? 'error' : undefined}
                          />
                          {errors[section] && (
                            <Text type="danger" style={{ fontSize: 11 }}>{errors[section]}</Text>
                          )}
                          <div style={{ marginTop: 6 }}>
                            <Button
                              size="small"
                              icon={<UndoOutlined />}
                              disabled={!canEdit || inherited}
                              onClick={() => setSection(section, '')}
                            >
                              Back to default
                            </Button>
                          </div>
                          <MetricLegend
                            definition={inherited
                              ? 'Empty, so this whole section uses the shipped default.'
                              : 'Overriding. Anything you leave out of this object still falls back to the default.'}
                          />
                        </Col>
                        <Col xs={24} lg={11}>
                          {/* The shipped default, side by side. Without it,
                              overriding one threshold means copying the whole
                              subtree in case something else is lost. */}
                          <Text style={{ fontSize: 11.5, color: muted(isDark) }}>
                            What this platform ships with
                          </Text>
                          <pre style={{
                            ...monoNumeric,
                            fontSize: 11,
                            margin: '6px 0 0',
                            padding: 10,
                            borderRadius: 8,
                            maxHeight: 360,
                            overflow: 'auto',
                            border: `1px solid ${hairline(isDark)}`,
                          }}
                          >
                            {pretty(defaults[section])}
                          </pre>
                        </Col>
                      </Row>
                    ),
                  };
                })}
              />
            </Card>
          )}
        </Col>
      </Row>

      <Modal
        open={creating}
        title="New analytics policy"
        okText="Create"
        onOk={create}
        onCancel={() => { setCreating(false); setNewKey(''); }}
      >
        <Paragraph style={{ fontSize: 12.5 }}>
          A key identifies this policy. It starts with every section empty, which means
          it behaves exactly like the shipped defaults until you change something.
        </Paragraph>
        <Input
          placeholder="e.g. stricter-churn"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onPressEnter={create}
        />
      </Modal>
    </div>
  );
};

export default AnalyticsPolicyPage;
