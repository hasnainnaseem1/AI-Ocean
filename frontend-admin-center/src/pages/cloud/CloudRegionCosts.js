import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Typography, Space, Button, InputNumber, Tag, Alert, Tooltip, message, Popover,
} from 'antd';
import {
  SyncOutlined, WarningOutlined, CheckCircleOutlined, EditOutlined,
} from '@ant-design/icons';
import settingsApi from '../../api/settingsApi';
import { usePermission } from '../../hooks/usePermission';
import { PERMISSIONS } from '../../utils/permissions';

const { Text, Paragraph } = Typography;

/**
 * What each region costs to keep open, before a single customer machine runs.
 *
 * ── The cost nothing used to account for ──
 *
 * A NAT gateway on AWS is billed per availability zone whether a customer
 * machine uses it or not — about $0.045 an hour each, so roughly $65 a month
 * standing for a two-zone region. Google bills its NAT per VM instead, so the
 * same region there costs almost nothing until it is used.
 *
 * Until this screen existed, neither figure reached a price. A tier sold in a
 * fresh AWS region was priced on the machine alone and served at a loss that
 * nothing could show.
 *
 * ── Why the ladder is shown and not just the number ──
 *
 * Spreading the standing cost over an assumed machine count is picking a point
 * on a steep curve: one machine carries fifty times what fifty do. A single
 * figure hides how much the choice matters, so each row can show the whole
 * curve.
 *
 * `Assumed` is the operator's judgement and the hourly refresh never touches
 * it. Everything else on the row is measured.
 */

const CLOUD_LABEL = { gcp: 'Google Cloud', aws: 'AWS' };

const money = (n, places = 4) => `$${Number(n || 0).toFixed(places)}`;

const CloudRegionCosts = () => {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission(PERMISSIONS.SETTINGS_EDIT);

  const [rows, setRows] = useState([]);
  const [losing, setLosing] = useState([]);
  const [uncosted, setUncosted] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await settingsApi.getRegionCosts();
      setRows(data.regions || []);
      setLosing(data.losing || []);
      setUncosted(data.uncosted || []);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not load region costs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const data = await settingsApi.refreshRegionCosts();
      if (data.failed > 0) {
        /*
         * Said as a warning, not an error. A failed read keeps whatever figure
         * is stored rather than zeroing it, so nothing is broken — but "0 read"
         * reported as success would read as "these regions are free".
         */
        message.warning(
          `Read ${data.read} of ${data.checked}. The rest kept the figure they already had.`
        );
      } else {
        message.success(`Read all ${data.checked} regions.`);
      }
      await load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not refresh');
    } finally {
      setRefreshing(false);
    }
  };

  const save = async (row, patch) => {
    const key = `${row.cloud}/${row.region}`;
    setBusyKey(key);
    try {
      await settingsApi.updateRegionCost({ cloud: row.cloud, region: row.region, ...patch });
      await load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not save');
    } finally {
      setBusyKey(null);
    }
  };

  const columns = [
    {
      title: 'Region',
      dataIndex: 'region',
      render: (region, row) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{region}</Text>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {CLOUD_LABEL[row.cloud] || row.cloud}
              {row.providerRegion ? ` · ${row.providerRegion}` : ''}
            </Text>
          </div>
        </div>
      ),
    },
    {
      title: (
        <Tooltip title="What this region costs per hour with nothing running in it. On AWS this is the NAT gateways, one per availability zone.">
          <span>Standing cost</span>
        </Tooltip>
      ),
      dataIndex: 'fixedCostPerHour',
      width: 150,
      render: (fixed, row) => {
        if (!fixed && !row.perMachineCostPerHour) {
          return <Tag color="orange">not costed</Tag>;
        }
        return (
          <div>
            <Text style={{ fontSize: 13 }}>{money(fixed, 4)}/hr</Text>
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {row.perMachineCostPerHour
                  ? `+ ${money(row.perMachineCostPerHour, 4)}/hr per machine`
                  : 'flat — the gateways do not care how many run'}
              </Text>
            </div>
          </div>
        );
      },
    },
    {
      title: (
        <Tooltip title="How many machines you expect to spread the standing cost across. Your judgement — the hourly refresh never changes it.">
          <span>Spread over</span>
        </Tooltip>
      ),
      dataIndex: 'assumedMachines',
      width: 190,
      render: (assumed, row) => (
        <Space size={6}>
          <InputNumber
            min={1}
            max={10000}
            value={assumed}
            disabled={!canEdit || busyKey === `${row.cloud}/${row.region}`}
            onChange={(v) => { if (v && v !== assumed) save(row, { assumedMachines: v }); }}
            style={{ width: 86 }}
            size="small"
          />
          <Popover
            trigger="click"
            title="What each machine carries"
            content={(
              <div style={{ fontFamily: 'monospace', fontSize: 12.5 }}>
                {(row.ladder || []).map((l) => (
                  <div key={l.machines} style={{ display: 'flex', gap: 14, justifyContent: 'space-between' }}>
                    <span>{String(l.machines).padStart(3, ' ')} machines</span>
                    <span>{money(l.sharePerHour, 4)}/hr</span>
                  </div>
                ))}
              </div>
            )}
          >
            <Button size="small" type="text" icon={<EditOutlined />}>curve</Button>
          </Popover>
        </Space>
      ),
    },
    {
      title: (
        <Tooltip title="What this adds to every tier's cost in this region.">
          <span>Each machine carries</span>
        </Tooltip>
      ),
      dataIndex: 'sharePerHour',
      width: 130,
      render: (share) => <Text strong style={{ fontSize: 13 }}>{money(share, 4)}/hr</Text>,
    },
    {
      title: 'Running now',
      dataIndex: 'liveMachines',
      width: 110,
      render: (live, row) => (
        <Text style={{ fontSize: 13 }}>
          {live}
          <Text type="secondary" style={{ fontSize: 12 }}> / {row.assumedMachines}</Text>
        </Text>
      ),
    },
    {
      title: 'Paying for itself?',
      key: 'recovery',
      width: 230,
      render: (_, row) => {
        if (!row.fixedCostPerHour && !row.perMachineCostPerHour) {
          return <Text type="secondary" style={{ fontSize: 12.5 }}>No cost recorded yet</Text>;
        }
        if (row.recovery?.ok) {
          return (
            <Space size={6}>
              <CheckCircleOutlined style={{ color: '#1A9655' }} />
              <Text style={{ fontSize: 12.5 }}>Yes</Text>
            </Space>
          );
        }
        return (
          <Space size={6} align="start">
            <WarningOutlined style={{ color: '#C97E14', marginTop: 3 }} />
            <div>
              <Text style={{ fontSize: 12.5 }}>
                Short {money(row.recovery?.shortfallPerHour, 4)}/hr
              </Text>
              <div>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {row.recovery?.machinesShort} more machine
                  {row.recovery?.machinesShort === 1 ? '' : 's'} to break even
                </Text>
              </div>
            </div>
          </Space>
        );
      },
    },
    {
      title: 'Figure from',
      dataIndex: 'costSource',
      width: 120,
      render: (source, row) => {
        /*
         * A source with no figure behind it is worse than no label: "typed by
         * hand" next to a blank cost reads as though somebody decided this
         * region is free, when in fact nothing has been recorded at all.
         */
        if (!row.fixedCostPerHour && !row.perMachineCostPerHour) {
          return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
        }
        if (source === 'recorded') return <Tag>typed by hand</Tag>;
        if (source === 'unknown') return <Tag color="orange">unknown</Tag>;
        return <Tag color="green">live</Tag>;
      },
    },
  ];

  return (
    <Card
      style={{ borderRadius: 12 }}
      title="What each region costs to keep open"
      extra={canEdit && (
        <Button icon={<SyncOutlined />} onClick={refresh} loading={refreshing} size="small">
          Read prices now
        </Button>
      )}
    >
      <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 14, maxWidth: 820 }}>
        A region is not free to have open. On AWS a NAT gateway is billed per availability zone
        whether a customer machine uses it or not — roughly <Text strong>$65 a month</Text> standing
        for a two-zone region. Google bills its NAT per VM instead, so the same region there costs
        almost nothing until it is used. Whatever a machine carries here is added to every tier&apos;s
        cost in that region.
      </Paragraph>

      {uncosted.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12, borderRadius: 10 }}
          message={`${uncosted.length} region${uncosted.length === 1 ? ' has' : 's have'} no cost recorded`}
          description={(
            <>
              {uncosted.join(', ')}. Until a figure is read or typed in, nothing of the region&apos;s
              own cost reaches a tier&apos;s price there. Press <Text strong>Read prices now</Text>,
              or type the standing cost in by hand if the cloud is not connected yet.
            </>
          )}
        />
      )}

      {losing.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12, borderRadius: 10 }}
          message={losing.length === 1
            ? '1 region is not covering its standing cost'
            : `${losing.length} regions are not covering their standing cost`}
          description={(
            <>
              {losing.map((l) => (
                <div key={`${l.cloud}/${l.region}`}>
                  <Text code>{CLOUD_LABEL[l.cloud] || l.cloud} / {l.region}</Text>
                  {' '}— short {money(l.shortfallPerHour, 4)}/hr, {l.machinesShort} machine
                  {l.machinesShort === 1 ? '' : 's'} below what you assumed.
                </div>
              ))}
              <div style={{ marginTop: 6 }}>
                Either the region fills up, or lower what you spread the cost over — which raises
                the price of every tier sold there.
              </div>
            </>
          )}
        />
      )}

      <Table
        rowKey={(r) => `${r.cloud}/${r.region}`}
        columns={columns}
        dataSource={rows}
        loading={loading}
        size="small"
        pagination={false}
        scroll={{ x: 980 }}
      />
    </Card>
  );
};

export default CloudRegionCosts;
