import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Tag, Space, Button, InputNumber, Typography, Alert, Tooltip, message, Popover,
} from 'antd';
import {
  SyncOutlined, WarningOutlined, InfoCircleOutlined, RollbackOutlined,
} from '@ant-design/icons';
import { tiersApi } from '../../api/catalogApi';

const { Text, Paragraph } = Typography;

/**
 * What this tier costs, and sells for, everywhere it is sold.
 *
 * ── What this replaced, and why ──
 *
 * A single panel that showed one cost figure for `regions[0]` and asked Google
 * for it regardless of which cloud the machine would be built on. For an AWS
 * tier the number it showed was not that tier's cost.
 *
 * The same machine costs a different amount on each cloud and a different
 * amount again in each region, so one figure could only ever have been right
 * by accident.
 *
 * ── One decision, not six ──
 *
 * An operator is asked for exactly one number: what the tier should earn over
 * its cost. Every price below is that tier's own cost in that place plus the
 * margin, kept in step hourly with what the clouds charge.
 *
 * A single price can still be typed in — to match a competitor in one region,
 * say — and is then left alone by the refresh. It is still checked against the
 * floor, so overriding is not a way to sell below cost by accident.
 */

const CLOUD_LABEL = { gcp: 'Google Cloud', aws: 'AWS' };

const STATUS_META = {
  sellable: { color: 'green', label: 'On sale' },
  below_floor: { color: 'red', label: 'Below cost' },
  unpriced: { color: 'orange', label: 'No price' },
  unbuildable: { color: 'default', label: 'Cannot build' },
};

const money = (n) => `$${Number(n || 0).toFixed(4)}`;

const TierPriceMatrix = ({ tierId, tierName, marginPercent, platformMargin, onMarginChange, canEdit }) => {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState(null);

  const load = useCallback(async () => {
    if (!tierId) return;
    setLoading(true);
    try {
      const data = await tiersApi.getPrices(tierId);
      setRows(data.prices || []);
      setSummary(data.summary || null);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not load prices');
    } finally {
      setLoading(false);
    }
  }, [tierId]);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const data = await tiersApi.refreshPrices(tierId);
      setRows(data.prices || []);
      message.success('Prices re-read');
      await load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not refresh');
    } finally {
      setRefreshing(false);
    }
  };

  const setPrice = async (row, value) => {
    const key = `${row.cloud}/${row.region}`;
    setBusyKey(key);
    try {
      const data = await tiersApi.setPrice(tierId, {
        cloud: row.cloud, region: row.region, sellPricePerHour: value,
      });
      setRows(data.prices || []);
      await load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not save');
    } finally {
      setBusyKey(null);
    }
  };

  /* ── An unsaved tier has nothing to price yet ──────────────────────── */
  if (!tierId) {
    return (
      <Alert
        type="info"
        showIcon
        style={{ borderRadius: 10 }}
        message="Save the tier first"
        description="Once it is saved, this is where you will see what it costs on each cloud in
          each region, and what it sells for there."
      />
    );
  }

  const problems = rows.filter((r) => r.status !== 'sellable');

  const columns = [
    {
      title: 'Where',
      key: 'where',
      render: (_, row) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{row.region}</Text>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {CLOUD_LABEL[row.cloud] || row.cloud}
            </Text>
          </div>
        </div>
      ),
    },
    {
      title: 'Builds as',
      dataIndex: 'machineType',
      width: 150,
      render: (t) => (t
        ? <Text code style={{ fontSize: 12 }}>{t}</Text>
        : <Text type="secondary" style={{ fontSize: 12 }}>—</Text>),
    },
    {
      title: (
        <Tooltip title="The machine, plus this region's own standing cost, plus overhead and tax.">
          <Space size={4}>Costs us <InfoCircleOutlined style={{ fontSize: 11, opacity: 0.5 }} /></Space>
        </Tooltip>
      ),
      dataIndex: 'totalCostPerHour',
      width: 150,
      render: (total, row) => {
        if (!total) return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
        return (
          <Popover
            title="What makes up this cost"
            content={(
              <div style={{ fontFamily: 'monospace', fontSize: 12.5, minWidth: 230 }}>
                {[
                  ['the machine', row.providerCostPerHour],
                  ['this region', row.regionalSharePerHour],
                  ['our overhead', row.overheadPerHour],
                  ['tax', row.taxPerHour],
                ].map(([label, v]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                    <span>{label}</span><span>{money(v)}</span>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid #8883', marginTop: 5, paddingTop: 5, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                  <strong>total</strong><strong>{money(total)}</strong>
                </div>
              </div>
            )}
          >
            <Text style={{ fontSize: 13, cursor: 'help', borderBottom: '1px dotted #8886' }}>
              {money(total)}/hr
            </Text>
          </Popover>
        );
      },
    },
    {
      title: 'Lowest we may sell',
      dataIndex: 'floorPricePerHour',
      width: 140,
      render: (floor) => (floor
        ? <Text style={{ fontSize: 13 }}>{money(floor)}/hr</Text>
        : <Text type="secondary" style={{ fontSize: 12 }}>—</Text>),
    },
    {
      title: 'Sells for',
      dataIndex: 'sellPricePerHour',
      width: 210,
      render: (sell, row) => {
        const key = `${row.cloud}/${row.region}`;
        if (row.status === 'unbuildable' || row.status === 'unpriced') {
          return <Text type="secondary" style={{ fontSize: 12 }}>not on sale</Text>;
        }
        return (
          <Space size={4}>
            <InputNumber
              value={sell}
              min={0}
              step={0.01}
              precision={4}
              prefix="$"
              disabled={!canEdit || busyKey === key}
              onBlur={(e) => {
                const v = Number(e.target.value.replace(/[^0-9.]/g, ''));
                if (Number.isFinite(v) && v !== sell) setPrice(row, v);
              }}
              style={{ width: 120 }}
              size="small"
            />
            {row.sellPriceIsOverridden ? (
              <Tooltip title="Set by hand. Click to hand it back to the hourly refresh.">
                <Button
                  size="small"
                  type="text"
                  icon={<RollbackOutlined />}
                  disabled={!canEdit || busyKey === key}
                  onClick={() => setPrice(row, null)}
                />
              </Tooltip>
            ) : (
              <Tooltip title="Kept in step with what this cloud charges.">
                <Tag style={{ fontSize: 10, margin: 0 }}>auto</Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: 'State',
      dataIndex: 'status',
      width: 160,
      render: (status, row) => {
        const meta = STATUS_META[status] || { color: 'default', label: status };
        const tag = <Tag color={meta.color}>{meta.label}</Tag>;
        return (
          <Space size={2} direction="vertical">
            {row.lastError ? <Tooltip title={row.lastError}>{tag}</Tooltip> : tag}
            {/*
              * Priced is not the same as built. A cloud publishes what a region
              * costs long before anything exists there, so a cell can be
              * correctly priced while its network does not exist yet — which is
              * the case where a customer is the first to deploy somewhere.
              */}
            {status === 'sellable' && !row.regionBuilt && (
              <Tooltip title="The network here is built the first time somebody deploys, which takes a few extra minutes.">
                <Text type="secondary" style={{ fontSize: 11 }}>network not built yet</Text>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <Card
      size="small"
      style={{ borderRadius: 12 }}
      title={(
        <Space wrap>
          <span>What this sells for</span>
          {summary?.cheapest !== null && summary?.cheapest !== undefined && (
            <Text type="secondary" style={{ fontWeight: 400, fontSize: 12.5 }}>
              {summary.cheapest === summary.dearest
                ? `${money(summary.cheapest)}/hr`
                : `${money(summary.cheapest)} – ${money(summary.dearest)}/hr`}
            </Text>
          )}
        </Space>
      )}
      extra={canEdit && (
        <Button size="small" icon={<SyncOutlined />} onClick={refresh} loading={refreshing}>
          Re-read prices
        </Button>
      )}
    >
      {/*
        * The one decision. Everything in the table below follows from it, so
        * it sits above the table rather than inside it.
        */}
      <Space align="center" wrap style={{ marginBottom: 14 }}>
        <Text strong style={{ fontSize: 13 }}>Earn on top of cost</Text>
        <InputNumber
          value={marginPercent}
          min={0}
          max={1000}
          step={5}
          precision={2}
          suffix="%"
          placeholder={String(platformMargin ?? 0)}
          disabled={!canEdit}
          onChange={onMarginChange}
          style={{ width: 120 }}
        />
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          {marginPercent === null || marginPercent === undefined || marginPercent === ''
            ? `Using the platform default (${platformMargin ?? 0}%). Set a number here to give this tier its own.`
            : 'Every price below is this tier\'s own cost in that place, plus this.'}
        </Text>
      </Space>

      {problems.length > 0 && (
        <Alert
          type={problems.some((p) => p.status === 'below_floor') ? 'error' : 'warning'}
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 12, borderRadius: 10 }}
          message={problems.length === 1
            ? '1 place is not on sale'
            : `${problems.length} places are not on sale`}
          description={(
            <div style={{ fontSize: 12.5 }}>
              {problems.map((p) => (
                <div key={`${p.cloud}/${p.region}`}>
                  <Text code>{CLOUD_LABEL[p.cloud] || p.cloud} / {p.region}</Text>
                  {' — '}{p.lastError || STATUS_META[p.status]?.label}
                </div>
              ))}
            </div>
          )}
        />
      )}

      {!loading && rows.length === 0 && (
        <Alert
          type="info"
          showIcon
          style={{ borderRadius: 10 }}
          message="No prices yet"
          description={(
            <>
              {tierName ? <Text code>{tierName}</Text> : 'This tier'} has no price anywhere yet.
              That happens when no cloud is switched on, or the tier is not sold in any region
              this platform serves. Press <Text strong>Re-read prices</Text> once a cloud is on.
            </>
          )}
        />
      )}

      {(loading || rows.length > 0) && (
        <Table
          rowKey={(r) => `${r.cloud}/${r.region}`}
          columns={columns}
          dataSource={rows}
          loading={loading}
          size="small"
          pagination={false}
          scroll={{ x: 900 }}
        />
      )}

      <Paragraph type="secondary" style={{ fontSize: 12, margin: '12px 0 0' }}>
        Prices are re-read every hour so they stay in step with what the clouds charge. A price
        you type in is left alone — but it is still checked against the floor, so it cannot drift
        below cost without this screen saying so.
      </Paragraph>
    </Card>
  );
};

export default TierPriceMatrix;
