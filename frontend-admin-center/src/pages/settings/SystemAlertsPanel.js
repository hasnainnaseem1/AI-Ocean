import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Select, Switch, Typography, Space, Tag, Alert, message, Button, Input,
} from 'antd';
import { SyncOutlined, WarningOutlined } from '@ant-design/icons';
import settingsApi from '../../api/settingsApi';
import { usePermission } from '../../hooks/usePermission';
import { PERMISSIONS } from '../../utils/permissions';

const { Text, Paragraph } = Typography;

/**
 * Who hears about each system alert — a setting, not a line of code.
 *
 * ── Why this screen exists ──
 *
 * Every system alert on this platform used to email "all admins", because
 * that was written into the code that raised it. Changing it meant changing
 * a file and deploying. On a platform where everything else is managed from
 * here, the most operational decision of all — who gets woken up — was the
 * one thing that was not.
 *
 * The cases this is for are ordinary: a billing team that should hear about
 * unbilled usage but not about networking, an on-call role that should get
 * the urgent ones at 3am and nothing else. Both are roles that already exist
 * under Team & Access.
 *
 * ── What "Reaches" is for ──
 *
 * The one mistake this screen can produce is choosing a group nobody is in —
 * a role created for a team that later disbanded, say. That is invisible
 * until the night nobody gets the alert. So every row shows how many people
 * the current choice would actually reach, and a zero is called out.
 *
 * (The backend will not let that fail silently either: an audience matching
 * nobody falls back to every admin and logs it. "Nobody" is only possible by
 * choosing it deliberately.)
 */

const SEVERITY = {
  urgent: { color: 'error', label: 'Urgent' },
  high: { color: 'warning', label: 'High' },
  medium: { color: 'default', label: 'Normal' },
};

const SystemAlertsPanel = () => {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission(PERMISSIONS.SETTINGS_EDIT);

  const [alerts, setAlerts] = useState([]);
  const [audiences, setAudiences] = useState([]);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await settingsApi.getAlerts();
      setAlerts(data.alerts || []);
      setAudiences(data.audiences || []);
      setEmailEnabled(data.emailEnabled !== false);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not load alert settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (key, patch) => {
    setSaving(key);
    try {
      await settingsApi.updateNotification({ alerts: { [key]: patch } });
      // Reloaded rather than patched locally: "Reaches" is computed on the
      // server and a stale number here is exactly the thing this screen is
      // meant to prevent.
      await load();
      message.success('Saved');
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not save');
      await load();
    } finally {
      setSaving(null);
    }
  };

  const columns = [
    {
      title: 'Alert',
      dataIndex: 'name',
      render: (name, row) => (
        <Space direction="vertical" size={2}>
          <Space size={8}>
            <Text strong>{name}</Text>
            {SEVERITY[row.severity] && (
              <Tag color={SEVERITY[row.severity].color}>{SEVERITY[row.severity].label}</Tag>
            )}
          </Space>
          <Text type="secondary" style={{ fontSize: 12.5 }}>{row.description}</Text>
        </Space>
      ),
    },
    {
      title: 'Who is told',
      dataIndex: 'audience',
      width: 300,
      render: (audience, row) => (
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          <Select
            style={{ width: '100%' }}
            value={audience}
            disabled={!canEdit || saving === row.key}
            loading={saving === row.key}
            onChange={(value) => save(row.key, { audience: value })}
            /*
             * Searchable, and tall enough to show the whole list.
             *
             * With a dozen roles the built-in options fall below the fold of
             * a short dropdown, so "Specific email addresses" — the one at
             * the bottom — looked like it did not exist. A list somebody has
             * to scroll blind is a list they will believe is complete when it
             * is not.
             */
            showSearch
            optionFilterProp="label"
            listHeight={320}
            options={audiences.map((a) => ({
              value: a.value,
              label: a.members === undefined
                ? a.label
                : `${a.label} (${a.members} ${a.members === 1 ? 'person' : 'people'})`,
            }))}
          />

          {/*
            * Typed-in addresses, for people with no account here — a shared
            * ops mailbox, an on-call pager, an external NOC. Saved on blur
            * rather than on every keystroke, so a half-typed address is never
            * sent to the server.
            */}
          {audience === 'custom' && (
            <Input.TextArea
              rows={2}
              defaultValue={row.emails || ''}
              placeholder="ops@yourcompany.com, oncall@yourcompany.com"
              disabled={!canEdit || saving === row.key}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next !== (row.emails || '').trim()) save(row.key, { emails: next });
              }}
            />
          )}
        </Space>
      ),
    },
    {
      title: 'Reaches',
      dataIndex: 'reaches',
      width: 110,
      align: 'center',
      render: (reaches, row) => {
        if (row.audience === 'off') return <Text type="secondary">Nobody</Text>;
        if (row.audience === 'custom') {
          /*
           * Nothing typed in yet. `reaches` is the admin fallback — correct,
           * and exactly what would happen — but showing it as a number under
           * "addresses" reads as if addresses are already saved. Say what is
           * actually true instead.
           */
          if (!row.emails) {
            return (
              <Text type="warning" style={{ fontSize: 12 }}>
                Add an address
              </Text>
            );
          }

          // Addresses, not accounts — so "4 people" would be misleading.
          return (
            <Space direction="vertical" size={0}>
              <Text strong>{reaches}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {reaches === 1 ? 'address' : 'addresses'}
              </Text>
            </Space>
          );
        }
        if (!reaches) {
          return (
            <Tag color="error" icon={<WarningOutlined />}>
              Nobody
            </Tag>
          );
        }
        return (
          <Space direction="vertical" size={0}>
            <Text strong>{reaches}</Text>
            {row.fellBack && (
              <Text type="warning" style={{ fontSize: 11 }}>fell back to admins</Text>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Email too',
      dataIndex: 'email',
      width: 100,
      align: 'center',
      render: (email, row) => (
        <Switch
          size="small"
          checked={email}
          /*
           * The platform-wide email switch wins, and a control that cannot
           * take effect must not look editable.
           *
           * Locked on for typed-in addresses: those people have no account
           * here, so email is the ONLY way they can be told. Turning it off
           * would leave the alert configured and reaching nobody.
           */
          disabled={!canEdit || !emailEnabled || row.audience === 'off'
            || row.audience === 'custom' || saving === row.key}
          onChange={(value) => save(row.key, { email: value })}
        />
      ),
    },
  ];

  return (
    <Card
      size="small"
      title="System alerts"
      style={{ marginTop: 16 }}
      extra={(
        <Button size="small" icon={<SyncOutlined />} onClick={load} loading={loading}>
          Refresh
        </Button>
      )}
    >
      <Paragraph type="secondary" style={{ fontSize: 13 }}>
        Each alert can go to all admins, to super admins only, or to any role you have created
        under Team &amp; Access. An alert set to a group that turns out to be empty still reaches
        the admins, so one can never go unnoticed by accident.
      </Paragraph>

      {!emailEnabled && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Email notifications are switched off platform-wide"
          description="These alerts will appear in the notification bell but will not be emailed. Turn email on above to change that."
        />
      )}

      <Table
        rowKey="key"
        size="small"
        loading={loading}
        dataSource={alerts}
        columns={columns}
        pagination={false}
      />
    </Card>
  );
};

export default SystemAlertsPanel;
