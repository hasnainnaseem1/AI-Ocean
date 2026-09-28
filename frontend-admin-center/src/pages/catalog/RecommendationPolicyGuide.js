import React from 'react';
import { Drawer, Typography, Alert, Collapse } from 'antd';
import { GUIDE } from './recommendationPolicyContent';
import { useTheme } from '../../contexts/ThemeContext';
import { getBrand, STATUS_COLORS } from '../../theme/colors';

const { Paragraph, Title, Text } = Typography;

/** A plain numbered walkthrough — used for both the editing and experimenting flows. */
const NumberedList = ({ items }) => {
  const { isDark } = useTheme();
  return (
    <div>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
          <div style={{
            flexShrink: 0, width: 22, height: 22, borderRadius: 11,
            background: getBrand(isDark), color: '#fff', fontSize: 12, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {i + 1}
          </div>
          <Text style={{ fontSize: 13 }}>{item}</Text>
        </div>
      ))}
    </div>
  );
};

/**
 * The full explanation of how recommendations work, opened from either the
 * policy list or the policy editor. Kept as one shared drawer so the two
 * pages can never drift on what they tell the admin.
 */
const RecommendationPolicyGuide = ({ open, onClose }) => {
  const { isDark } = useTheme();
  return (
  <Drawer
    title="How recommendations work"
    placement="right"
    width={520}
    open={open}
    onClose={onClose}
  >
    <Paragraph style={{ fontSize: 13.5 }}>{GUIDE.intro}</Paragraph>

    <Title level={5} style={{ marginTop: 28 }}>What happens when a customer deploys</Title>
    {GUIDE.pipeline.map((stage, i) => (
      <div key={stage.title} style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <div style={{
          flexShrink: 0, width: 24, height: 24, borderRadius: 12,
          background: STATUS_COLORS.neutral.bg(isDark), fontSize: 12, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {i + 1}
        </div>
        <div>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 2 }}>{stage.title}</Text>
          <Text type="secondary" style={{ fontSize: 12.5 }}>{stage.body}</Text>
        </div>
      </div>
    ))}

    <Title level={5} style={{ marginTop: 28 }}>Four things worth knowing</Title>
    {GUIDE.rules.map((rule) => (
      <Alert
        key={rule.title}
        type="info"
        style={{ marginBottom: 10 }}
        message={<Text strong style={{ fontSize: 13 }}>{rule.title}</Text>}
        description={<Text style={{ fontSize: 12.5 }}>{rule.body}</Text>}
      />
    ))}

    <Title level={5} style={{ marginTop: 28 }}>Changing a setting safely</Title>
    <NumberedList items={GUIDE.howToEdit} />

    <Title level={5} style={{ marginTop: 24 }}>Trying big changes without risk</Title>
    <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
      Rather than editing the live policy, work on a copy — from the policy list, press Duplicate.
    </Paragraph>
    <NumberedList items={GUIDE.howToExperiment} />

    <Title level={5} style={{ marginTop: 24 }}>About the {'{braced}'} words</Title>
    <Paragraph style={{ fontSize: 13 }}>{GUIDE.placeholders}</Paragraph>

    <Title level={5} style={{ marginTop: 28 }}>Common questions</Title>
    <Collapse
      ghost
      size="small"
      items={GUIDE.faq.map((item, i) => ({
        key: String(i),
        label: <Text strong style={{ fontSize: 12.5 }}>{item.q}</Text>,
        children: <Text style={{ fontSize: 12.5 }}>{item.a}</Text>,
      }))}
    />
  </Drawer>
  );
};

export default RecommendationPolicyGuide;
