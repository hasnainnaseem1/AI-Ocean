import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Space, message, Tag, Alert, Typography, Row, Col, Collapse,
  InputNumber, Input, Select, Popconfirm, Tooltip, Popover, Divider, Spin,
} from 'antd';
import {
  SaveOutlined, ArrowLeftOutlined, ExperimentOutlined, UndoOutlined,
  InfoCircleOutlined, ArrowUpOutlined, ArrowDownOutlined, BulbOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import { usePermission } from '../../hooks/usePermission';
import { recommendationPolicyApi, modelsApi } from '../../api/catalogApi';
import { PERMISSIONS } from '../../utils/permissions';
import {
  NUMERIC_GROUPS, MAP_GROUPS, COPY_GROUPS, MAP_ITEM_INFO, COPY_ITEM_INFO,
} from './recommendationPolicyContent';
import { useTheme } from '../../contexts/ThemeContext';
import { TILE, STATUS_COLORS, muted } from '../../theme/colors';

const { Text, Paragraph } = Typography;

/**
 * The editor for exactly one recommendation policy.
 *
 * Separate page from RecommendationPolicyListPage, on purpose — the same
 * split this admin center already uses for models and plans. Every field
 * belongs unambiguously to whichever policy this page was opened for; there
 * is nothing else on screen it could be mistaken for.
 *
 * Two rules shaped this screen:
 *
 *  1. A blank field means "use the built-in default", not "zero". Every input
 *     shows its default as placeholder text, so leaving something alone is a
 *     visible, safe choice rather than an accidental wipe.
 *  2. Every field — every number, every entry in a vocabulary, every sentence
 *     template — carries its own explanation behind an ⓘ. Nobody should have
 *     to guess what a setting does from its name alone.
 */

/* ── Nested get/set on dotted paths ─────────────────────────────────────── */

const getAt = (obj, path) =>
  path.split('.').reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), obj);

/** Returns a new object — never mutates, so React sees the change. */
const setAt = (obj, path, value) => {
  const keys = path.split('.');
  const out = { ...obj };
  let cursor = out;

  keys.slice(0, -1).forEach((key) => {
    cursor[key] = { ...(cursor[key] || {}) };
    cursor = cursor[key];
  });

  const last = keys[keys.length - 1];
  if (value === null || value === undefined || value === '') delete cursor[last];
  else cursor[last] = value;

  return out;
};

/* ── One explanation popover, used for every field on the page ──────────── */

const InfoBody = ({ info, fallback }) => {
  const hasFallback = fallback !== undefined && fallback !== null;
  const { isDark } = useTheme();
  const blue = TILE.blue.fg(isDark);
  const warning = STATUS_COLORS.warning[isDark ? 'dark' : 'light'];

  return (
    <div style={{ maxWidth: 340 }}>
      <Paragraph style={{ fontSize: 13, marginBottom: 10 }}>{info.what}</Paragraph>

      {info.when && (
        <Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 10 }}>{info.when}</Paragraph>
      )}

      {(info.raise || info.lower) && (
        <div style={{ marginBottom: 10 }}>
          {info.raise && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
              <ArrowUpOutlined style={{ fontSize: 11, marginTop: 4, color: blue }} />
              <Text style={{ fontSize: 12.5 }}><Text strong style={{ fontSize: 12.5 }}>Higher: </Text>{info.raise}</Text>
            </div>
          )}
          {info.lower && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <ArrowDownOutlined style={{ fontSize: 11, marginTop: 4, color: muted(isDark) }} />
              <Text style={{ fontSize: 12.5 }}><Text strong style={{ fontSize: 12.5 }}>Lower: </Text>{info.lower}</Text>
            </div>
          )}
        </div>
      )}

      {info.example && (
        <div style={{ background: 'rgba(0,0,0,0.03)', borderRadius: 6, padding: '8px 10px', marginBottom: 10 }}>
          <Space size={6} align="start">
            <BulbOutlined style={{ fontSize: 11, marginTop: 3, color: warning }} />
            <Text style={{ fontSize: 12 }}>{info.example}</Text>
          </Space>
        </div>
      )}

      {hasFallback && (
        <>
          <Divider style={{ margin: '10px 0' }} />
          <Text type="secondary" style={{ fontSize: 11.5 }}>
            Built-in default: <Text code style={{ fontSize: 11.5 }}>{String(fallback)}</Text>
            {' · leave blank to use it'}
          </Text>
        </>
      )}
    </div>
  );
};

const InfoIcon = ({ info, fallback }) => {
  const { isDark } = useTheme();
  return (
    <Popover
      placement="topLeft"
      title={<Text strong style={{ fontSize: 13 }}>{info.label}</Text>}
      content={<InfoBody info={info} fallback={fallback} />}
    >
      <InfoCircleOutlined style={{ fontSize: 12.5, color: muted(isDark), cursor: 'help' }} />
    </Popover>
  );
};

/** Falls back to something visible rather than a blank if content is ever missing. */
const infoFor = (map, key, label) => map[key] || { label, what: 'No description yet for this setting.' };

/* ── Small pieces ───────────────────────────────────────────────────────── */

const FieldRow = ({ info, draft, defaults, disabled, onChange }) => {
  const current = getAt(draft, info.path);
  const fallback = getAt(defaults, info.path);
  const overridden = current !== undefined && current !== null;

  return (
    <Col xs={24} md={12}>
      <div style={{ marginBottom: 18 }}>
        <Space size={6} style={{ marginBottom: 5 }} wrap>
          <Text strong style={{ fontSize: 13 }}>{info.label}</Text>
          <InfoIcon info={info} fallback={fallback} />
          {overridden && <Tag color="blue" style={{ marginInlineEnd: 0 }}>changed</Tag>}
        </Space>

        <InputNumber
          style={{ width: '100%' }}
          value={overridden ? current : undefined}
          placeholder={`Default: ${fallback}`}
          disabled={disabled}
          step={Math.abs(Number(fallback)) < 3 ? 0.05 : 1}
          onChange={(v) => onChange(info.path, v)}
        />
      </div>
    </Col>
  );
};

/** Free-form key/value maps — statuses, labels, fit ratings. Every key has its own ⓘ. */
const MapEditor = ({ group, draft, defaults, disabled, onChange }) => {
  const { isDark } = useTheme();
  const warning = STATUS_COLORS.warning[isDark ? 'dark' : 'light'];
  const fallback = getAt(defaults, group.path) || {};
  const current = getAt(draft, group.path) || {};
  const merged = { ...fallback, ...current };

  const update = (key, value) => {
    const next = { ...(getAt(draft, group.path) || {}) };
    if (value === null || value === undefined || value === '') delete next[key];
    else next[key] = value;
    onChange(group.path, Object.keys(next).length ? next : null);
  };

  return (
    <>
      <Paragraph style={{ fontSize: 13, marginBottom: 6 }}>{group.what}</Paragraph>
      {group.example && (
        <Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 18 }}>
          <BulbOutlined style={{ color: warning, marginRight: 6 }} />
          {group.example}
        </Paragraph>
      )}

      <Row gutter={16}>
        {Object.keys(merged).map((key) => {
          const info = infoFor(MAP_ITEM_INFO, `${group.path}.${key}`, key);
          return (
            <Col xs={24} md={12} key={key}>
              <div style={{ marginBottom: 14 }}>
                <Space size={6} style={{ marginBottom: 4 }} wrap>
                  <Text code style={{ fontSize: 12 }}>{key}</Text>
                  <InfoIcon info={info} fallback={fallback[key]} />
                  {current[key] !== undefined && <Tag color="blue" style={{ marginInlineEnd: 0 }}>changed</Tag>}
                </Space>
                {group.numeric ? (
                  <InputNumber
                    style={{ width: '100%' }}
                    step={0.1}
                    value={current[key] !== undefined ? current[key] : undefined}
                    placeholder={`Default: ${fallback[key]}`}
                    disabled={disabled}
                    onChange={(v) => update(key, v)}
                  />
                ) : (
                  <Input
                    value={current[key] !== undefined ? current[key] : undefined}
                    placeholder={fallback[key]}
                    disabled={disabled}
                    onChange={(e) => update(key, e.target.value)}
                  />
                )}
              </div>
            </Col>
          );
        })}
      </Row>
    </>
  );
};

/** Sentence templates. Every code has its own ⓘ, plus the {placeholders} it uses. */
const CopyEditor = ({ group, draft, defaults, disabled, onChange }) => {
  const fallback = getAt(defaults, group.path) || {};
  const current = getAt(draft, group.path) || {};

  const update = (code, value) => {
    const next = { ...(getAt(draft, group.path) || {}) };
    if (!value || value === fallback[code]) delete next[code];
    else next[code] = value;
    onChange(group.path, Object.keys(next).length ? next : null);
  };

  return (
    <>
      <Paragraph style={{ fontSize: 13, marginBottom: 6 }}>{group.what}</Paragraph>
      <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 18 }}>
        Words in {'{braces}'} are replaced with real values. Reword freely around them, but keep
        them spelled exactly as shown in the tags.
      </Paragraph>

      {Object.keys(fallback).map((code) => {
        const text = current[code] !== undefined ? current[code] : fallback[code];
        const placeholders = String(fallback[code]).match(/\{(\w+)\}/g) || [];
        const info = infoFor(COPY_ITEM_INFO, `${group.path}.${code}`, code);

        return (
          <div key={code} style={{ marginBottom: 18 }}>
            <Space size={6} style={{ marginBottom: 5 }} wrap>
              <Text code style={{ fontSize: 11.5 }}>{code}</Text>
              <InfoIcon info={info} fallback={fallback[code]} />
              {current[code] !== undefined && <Tag color="blue" style={{ marginInlineEnd: 0 }}>changed</Tag>}
              {placeholders.map((p) => (
                <Tooltip key={p} title="Replaced with a real value. Keep it spelled exactly like this.">
                  <Tag style={{ marginInlineEnd: 0, fontSize: 10.5 }}>{p}</Tag>
                </Tooltip>
              ))}
            </Space>
            <Input.TextArea
              value={text}
              autoSize={{ minRows: 1, maxRows: 3 }}
              disabled={disabled}
              onChange={(e) => update(code, e.target.value)}
            />
          </div>
        );
      })}
    </>
  );
};

/* ── The page ───────────────────────────────────────────────────────────── */

const RecommendationPolicyFormPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission(PERMISSIONS.MODELS_EDIT);
  const { isDark } = useTheme();
  const blue = TILE.blue.fg(isDark);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [policy, setPolicy] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [draft, setDraft] = useState({});
  const [dirty, setDirty] = useState(false);

  // Preview
  const [models, setModels] = useState([]);
  const [previewModelId, setPreviewModelId] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detail, defs] = await Promise.all([
        recommendationPolicyApi.getPolicy(id),
        recommendationPolicyApi.getDefaults(),
      ]);
      setPolicy(detail.policy);
      setDraft(detail.policy);
      setDefaults(defs.defaults);
      setDirty(false);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not load this policy');
      navigate('/recommendation-policy');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    modelsApi.getModels({ limit: 100 }).then((r) => setModels(r.models || [])).catch(() => {});
  }, []);

  const change = useCallback((path, value) => {
    setDraft((prev) => setAt(prev, path, value));
    setDirty(true);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { _id, id, createdAt, updatedAt, __v, ...payload } = draft;
      const r = await recommendationPolicyApi.updatePolicy(id, payload);
      message.success(
        policy?.isActive
          ? 'Saved — the deployment journey is using this immediately'
          : 'Saved to this policy. Press "Make live" when you want customers to get it.'
      );
      setPolicy(r.policy);
      setDraft(r.policy);
      setDirty(false);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not save the policy');
    } finally {
      setSaving(false);
    }
  };

  const activate = async () => {
    setActivating(true);
    try {
      const r = await recommendationPolicyApi.activate(id);
      message.success(r.message);
      setPolicy(r.policy);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not activate');
    } finally {
      setActivating(false);
    }
  };

  const runPreview = async () => {
    if (!previewModelId) return;
    setPreviewing(true);
    try {
      const { _id, id, createdAt, updatedAt, __v, ...overrides } = draft;
      const r = await recommendationPolicyApi.preview(id, {
        modelId: previewModelId,
        answers: [
          { questionKey: 'use_case', answer: 'chat_assistant' },
          { questionKey: 'requests_per_day', answer: '10_000_100_000' },
          { questionKey: 'context_length', answer: '32k_tokens' },
        ],
        overrides,
      });
      setPreview(r);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not run the preview');
    } finally {
      setPreviewing(false);
    }
  };

  const resetGroup = (fields) => {
    setDraft((prev) => fields.reduce((acc, f) => setAt(acc, f.path, null), prev));
    setDirty(true);
  };

  if (loading || !defaults || !policy) {
    return (
      <>
        <PageHeader title="Recommendation Policy" />
        <Card><Spin /></Card>
      </>
    );
  }

  const disabled = !canEdit;

  return (
    <>
      <Button
        type="text" icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/recommendation-policy')}
        style={{ marginBottom: 12, paddingLeft: 0 }}
      >
        All policies
      </Button>

      <PageHeader
        title={
          <Space size={10}>
            {policy.name}
            {policy.isActive && <Tag color="green" icon={<CheckCircleOutlined />}>Live</Tag>}
          </Space>
        }
        extra={
          <Space>
            {canEdit && !policy.isActive && (
              <Popconfirm
                title="Make this the live policy?"
                description="Customers will start getting suggestions from it immediately. The current live policy is kept, just switched off."
                onConfirm={activate}
              >
                <Button loading={activating}>Make live</Button>
              </Popconfirm>
            )}
            {canEdit && (
              <Button
                type="primary" icon={<SaveOutlined />}
                loading={saving} disabled={!dirty} onClick={save}
              >
                Save changes
              </Button>
            )}
          </Space>
        }
      />

      <Paragraph type="secondary" style={{ marginTop: -16, marginBottom: 20 }}>
        Key: <Text code>{policy.key}</Text>
      </Paragraph>

      {policy.isActive ? (
        <Alert
          type="success" showIcon style={{ marginBottom: 16 }}
          message="This is the live policy"
          description={
            'Customers are getting suggestions from this right now. Pressing "Save changes" applies '
            + 'your edits immediately — there is no separate publish step. If you would rather try '
            + 'something without any risk first, go back and press "Duplicate" on this policy, then edit the copy instead.'
          }
        />
      ) : (
        <Alert
          type="warning" showIcon style={{ marginBottom: 16 }}
          message="This is a draft — customers are unaffected"
          description={
            'Edit and save as many times as you like; nothing here reaches a customer until you '
            + 'press "Make live" above. When you do, the current live policy is automatically '
            + 'switched off (not deleted) so you can switch back at any time.'
          }
        />
      )}

      {/* Numbers */}
      <Collapse
        defaultActiveKey={['ranking']}
        style={{ marginBottom: 16 }}
        items={NUMERIC_GROUPS.map((group) => ({
          key: group.key,
          label: <Text strong>{group.label}</Text>,
          extra: canEdit ? (
            <Button
              size="small" type="text" icon={<UndoOutlined />}
              onClick={(e) => { e.stopPropagation(); resetGroup(group.fields); }}
            >
              Reset section
            </Button>
          ) : null,
          children: (
            <>
              <Paragraph style={{ fontSize: 13, marginBottom: group.note ? 10 : 20 }}>
                {group.intro}
              </Paragraph>
              {group.note && (
                <Alert
                  type="info" showIcon style={{ marginBottom: 20 }}
                  message={<Text style={{ fontSize: 12.5 }}>{group.note}</Text>}
                />
              )}
              <Row gutter={16}>
                {group.fields.map((info) => (
                  <FieldRow
                    key={info.path} info={info}
                    draft={draft} defaults={defaults}
                    disabled={disabled} onChange={change}
                  />
                ))}
              </Row>
            </>
          ),
        }))}
      />

      {/* Vocabularies */}
      <Collapse
        style={{ marginBottom: 16 }}
        items={MAP_GROUPS.map((group) => ({
          key: group.path,
          label: <Text strong>{group.label}</Text>,
          children: (
            <MapEditor group={group} draft={draft} defaults={defaults} disabled={disabled} onChange={change} />
          ),
        }))}
      />

      {/* Copy */}
      <Collapse
        style={{ marginBottom: 16 }}
        items={COPY_GROUPS.map((group) => ({
          key: group.path,
          label: <Text strong>{group.label}</Text>,
          children: (
            <CopyEditor group={group} draft={draft} defaults={defaults} disabled={disabled} onChange={change} />
          ),
        }))}
      />

      {/* Try it before shipping it */}
      <Card title={<Space><ExperimentOutlined />Preview</Space>} style={{ marginBottom: 24 }}>
        <Paragraph style={{ fontSize: 13 }}>
          Scores a real model under your unsaved changes and shows it beside what customers get
          right now. Nothing is saved, and customers see nothing.
        </Paragraph>

        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            style={{ minWidth: 260 }}
            placeholder="Pick a model to test with"
            value={previewModelId}
            onChange={setPreviewModelId}
            options={models.map((m) => ({ value: m.id, label: m.name }))}
            showSearch
            optionFilterProp="label"
          />
          <Button type="primary" ghost disabled={!previewModelId} loading={previewing} onClick={runPreview}>
            Run preview
          </Button>
        </Space>

        {preview && (
          <Row gutter={16}>
            {[
              ['What customers get now', preview.live, false],
              ['With your changes', preview.preview, true],
            ].map(([label, data, isPreview]) => (
              <Col xs={24} md={12} key={label}>
                <Card
                  size="small" title={label}
                  style={isPreview && data.tier !== preview.live.tier ? { borderColor: blue } : undefined}
                >
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Text>Hardware: <Text strong>{data.tier || '—'}</Text></Text>
                    <Text>
                      Fit:{' '}
                      <Tag color={data.verdict === 'good' ? 'green' : data.verdict === 'caution' ? 'orange' : 'red'}>
                        {data.verdict}
                      </Tag>
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12, marginTop: 6 }}>
                      What the customer would read:
                    </Text>
                    {(data.reasons || []).slice(0, 5).map((r, i) => (
                      <Text key={i} style={{ fontSize: 12 }}>• {r}</Text>
                    ))}
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Card>
    </>
  );
};

export default RecommendationPolicyFormPage;
