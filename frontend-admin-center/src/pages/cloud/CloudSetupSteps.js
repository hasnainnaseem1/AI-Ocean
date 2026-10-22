import React from 'react';
import { Card, Typography, Space, Button, Tag } from 'antd';
import { CheckCircleFilled, RightOutlined } from '@ant-design/icons';
import { useTheme } from '../../contexts/ThemeContext';
import { hairline } from '../../theme/colors';

const { Text, Paragraph } = Typography;

/**
 * The four things that have to be true before this cloud can build a machine,
 * in the order they have to happen.
 *
 * ── Why this exists ──
 *
 * The settings for a cloud are spread over three tabs and about twenty fields,
 * and nothing on any of them said which ones mattered first, or what the
 * platform was still waiting for. An operator could fill in every field on the
 * connection tab and still have nothing happen, with no way to find out why
 * short of reading the code.
 *
 * So the tabs keep every detail, and this says what state the cloud is in and
 * what the next thing to do is. Each step is one sentence of plain language
 * and a button that goes to the tab that fixes it.
 *
 * ── The order is not arbitrary ──
 *
 * Each step is genuinely blocked by the one above it. There is no point
 * costing a region that has no network in it, and no point letting a cloud
 * build machines before we know what they cost — that last one is the whole
 * reason the steps are numbered rather than listed.
 */

const Step = ({ index, done, blocked, title, detail, action, onAction, isDark }) => (
  <div
    style={{
      display: 'flex',
      gap: 14,
      alignItems: 'flex-start',
      padding: '13px 0',
      borderBottom: `1px solid ${hairline(isDark)}`,
      opacity: blocked ? 0.5 : 1,
    }}
  >
    <div style={{ flexShrink: 0, width: 26, textAlign: 'center', paddingTop: 1 }}>
      {done ? (
        <CheckCircleFilled style={{ color: '#1A9655', fontSize: 18 }} />
      ) : (
        <span
          style={{
            display: 'inline-block',
            width: 20,
            height: 20,
            lineHeight: '19px',
            borderRadius: '50%',
            border: `1.5px solid ${hairline(isDark)}`,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {index}
        </span>
      )}
    </div>

    <div style={{ flex: 1, minWidth: 0 }}>
      <Text strong style={{ fontSize: 14, display: 'block' }}>{title}</Text>
      <Text type="secondary" style={{ fontSize: 13 }}>{detail}</Text>
    </div>

    <div style={{ flexShrink: 0 }}>
      {done ? (
        <Tag color="green">done</Tag>
      ) : (
        action && (
          <Button size="small" onClick={onAction} disabled={blocked} icon={<RightOutlined />}>
            {action}
          </Button>
        )
      )}
    </div>
  </div>
);

/**
 * @param {string} cloud       'gcp' | 'aws'
 * @param {object} settings    that cloud's settings block
 * @param {Array}  regionCosts rows from the region-cost screen, this cloud's
 * @param {func}   onGoToTab   (tabKey) => void
 */
const CloudSetupSteps = ({ cloud, label, settings = {}, regionCosts = [], onGoToTab }) => {
  const { isDark } = useTheme();

  const connected = cloud === 'aws'
    ? !!(settings.accountId && settings.hasSecretAccessKey)
    : !!(settings.projectId && settings.hasServiceAccountKey);

  /*
   * "Built" means different things on the two clouds, and the difference is
   * real: Google's network is global, so one connected project covers every
   * region, while AWS needs a VPC, security group, subnets and an image in
   * each region separately.
   */
  const builtRegions = cloud === 'aws'
    ? Object.values(settings.regions || {}).filter((r) => r.ready).length
    : (connected ? 1 : 0);
  const built = builtRegions > 0;

  const costed = regionCosts.filter((r) => r.fixedCostPerHour > 0 || r.perMachineCostPerHour > 0).length;
  const knowsCost = costed > 0;

  const building = !!settings.enabled && settings.dryRun === false;

  const steps = [
    {
      title: `Connect your ${label} account`,
      detail: connected
        ? cloud === 'aws'
          ? `Account ${settings.accountId}, with its key stored and encrypted.`
          : `Project ${settings.projectId}, with its key stored and encrypted.`
        : cloud === 'aws'
          ? 'Paste your 12-digit account number and an access key. Nothing is built yet — this only lets us look.'
          : 'Paste your project id and a service account key. Nothing is built yet — this only lets us look.',
      done: connected,
      action: 'Connection',
      tab: 'connection',
    },
    {
      title: cloud === 'aws' ? 'Build the network, one region at a time' : 'Build the network',
      detail: built
        ? cloud === 'aws'
          ? `${builtRegions} region${builtRegions === 1 ? '' : 's'} ready. Each one needs its own, because an AWS network belongs to a single region.`
          : 'One network covers every region on Google, so this is done once.'
        : cloud === 'aws'
          ? 'Run infra/aws for a region, then paste its ids on the Connection tab. A machine cannot be built in a region that has none.'
          : 'Run infra/gcp once. It builds the network, the isolation rules and the NAT that customer machines need.',
      done: built,
      blocked: !connected,
      action: 'Connection',
      tab: 'connection',
    },
    {
      title: 'Record what each region costs',
      detail: knowsCost
        ? `${costed} region${costed === 1 ? '' : 's'} costed. That cost is added to every machine sold there.`
        : cloud === 'aws'
          ? 'An AWS region costs about $65 a month standing, with nothing running in it. Until that is recorded, tiers sold there are priced short by it.'
          : 'A Google region costs very little standing, but it is not nothing. Record it so it reaches a price.',
      done: knowsCost,
      blocked: !built,
      action: 'Cloud overview',
      tab: 'overview',
    },
    {
      title: `Let ${label} build real machines`,
      detail: building
        ? 'Switched on and out of dry run. Customer deployments are being built here for real.'
        : settings.enabled
          ? 'Switched on, but in dry run — the whole chain runs and nothing reaches the cloud. Turn dry run off when the steps above are done.'
          : 'Still off. Nothing is built here, and nothing is charged.',
      done: building,
      blocked: !built,
      action: 'Provisioning',
      tab: 'provisioning',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card
      size="small"
      style={{ borderRadius: 12, marginBottom: 16 }}
      title={(
        <Space>
          <span>Setting up {label}</span>
          <Tag color={doneCount === steps.length ? 'green' : 'blue'}>
            {doneCount} of {steps.length}
          </Tag>
        </Space>
      )}
    >
      <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 4 }}>
        {doneCount === steps.length
          ? `${label} is set up. The tabs below are where you change any of it.`
          : 'Each step needs the one above it. The tabs below hold every detail; this is the order to do them in.'}
      </Paragraph>

      <div>
        {steps.map((s, i) => (
          <Step
            key={s.title}
            index={i + 1}
            done={s.done}
            blocked={s.blocked && !s.done}
            title={s.title}
            detail={s.detail}
            action={s.action}
            onAction={() => onGoToTab?.(s.tab)}
            isDark={isDark}
          />
        ))}
      </div>
    </Card>
  );
};

export default CloudSetupSteps;
