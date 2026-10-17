import React, { useState, useEffect, useCallback } from 'react';
import {
  Form, InputNumber, Button, Typography, Alert, Card, Row, Col, Space,
  message, Divider, Statistic, Switch, Tag,
} from 'antd';
import { SaveOutlined, CalculatorOutlined } from '@ant-design/icons';
import settingsApi from '../../api/settingsApi';

const { Text, Paragraph } = Typography;

/**
 * What the platform adds on top of a cloud provider's charge.
 *
 * ── The idea this screen has to get across ──
 *
 * A customer pays for a machine. The platform pays for the machine **and** for
 * everything it needs to be reachable and safe — NAT, egress, logging, our own
 * always-on infrastructure — plus tax on all of it. None of that appears on any
 * per-VM price list, because no cloud sells it that way.
 *
 * So four numbers turn "what Google charges" into "what this actually costs us,
 * and the least we may sell it for". Getting them wrong does not break
 * anything; it silently changes what the platform considers profitable. That is
 * why this screen shows a **worked example** that recomputes as the fields
 * move — the arithmetic is simple, and seeing it on a real figure is the
 * difference between setting these once and setting them correctly.
 *
 * Every default is zero, which means the provider's raw cost and nothing
 * invented on top.
 */

/** A figure to demonstrate against — a small machine's real hourly cost. */
const EXAMPLE_PROVIDER_COST = 0.0335;

const CloudPricingSettings = ({ canUpdate = true }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Mirrors the fields so the worked example is about what is on screen now,
  // not about what happens to be saved.
  const [live, setLive] = useState({
    overheadPercent: 0, overheadPerHour: 0, taxPercent: 0, targetMarginPercent: 0,
  });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getSettings();
      const cp = data.settings?.cloudPricingSettings || {};
      const values = {
        overheadPercent: Number(cp.overheadPercent) || 0,
        overheadPerHour: Number(cp.overheadPerHour) || 0,
        taxPercent: Number(cp.taxPercent) || 0,
        targetMarginPercent: Number(cp.targetMarginPercent) || 0,
        // Both default to on and are only off when explicitly set to false —
        // the same rule on each cloud, and the same rule the server applies.
        gcpEnabled: cp.providers?.gcp !== false,
        awsEnabled: cp.providers?.aws !== false,
      };
      form.setFieldsValue(values);
      setLive(values);
    } catch {
      message.error('Could not load cloud cost settings');
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => { load(); }, [load]);

  const sync = () => {
    const v = form.getFieldsValue();
    setLive({
      overheadPercent: Number(v.overheadPercent) || 0,
      overheadPerHour: Number(v.overheadPerHour) || 0,
      taxPercent: Number(v.taxPercent) || 0,
      targetMarginPercent: Number(v.targetMarginPercent) || 0,
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const v = form.getFieldsValue();
      const data = await settingsApi.updateCloudPricing({
        overheadPercent: Number(v.overheadPercent) || 0,
        overheadPerHour: Number(v.overheadPerHour) || 0,
        taxPercent: Number(v.taxPercent) || 0,
        targetMarginPercent: Number(v.targetMarginPercent) || 0,
        providers: { gcp: v.gcpEnabled !== false, aws: v.awsEnabled !== false },
      });
      if (data.success) message.success(data.message || 'Saved');
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  // The same arithmetic costModel.js does, on one example figure.
  const direct = EXAMPLE_PROVIDER_COST;
  const overhead = (direct * live.overheadPercent) / 100 + live.overheadPerHour;
  const tax = ((direct + overhead) * live.taxPercent) / 100;
  const totalCost = direct + overhead + tax;
  const floor = totalCost * (1 + live.targetMarginPercent / 100);
  const multiple = direct > 0 ? floor / direct : 0;

  return (
    <Form form={form} layout="vertical" disabled={!canUpdate || loading} onValuesChange={sync}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 20, borderRadius: 10 }}
        message="A machine costs more than the provider charges for it"
        description={(
          <>
            The customer pays for a machine. We pay for the machine <em>and</em> for the NAT it
            reaches the internet through, the egress itself, the logging, our own always-on
            infrastructure, and tax on all of it. None of that is on a per-VM price list, because
            no cloud sells it that way. These four numbers are how that reaches the price.
          </>
        )}
      />

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item
            name="overheadPercent"
            label="Overhead that scales with the machine (%)"
            extra="Egress and logging roughly track how busy a machine is, so they are a share of its cost. Take it from your own bill: last month's egress + logging ÷ last month's compute."
          >
            <InputNumber min={0} max={500} step={1} addonAfter="%" style={{ width: '100%' }} size="large" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="overheadPerHour"
            label="Overhead that does not scale (per machine-hour)"
            extra="A NAT gateway and our own servers cost the same whether one machine runs or twenty. Take that monthly bill ÷ 730 ÷ how many machines you expect to have running."
          >
            <InputNumber min={0} max={1000} step={0.001} precision={4} prefix="$" style={{ width: '100%' }} size="large" />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item
            name="taxPercent"
            label="Tax (%)"
            extra="Applied to the provider's charge AND the overhead — both are real spending on a real invoice."
          >
            <InputNumber min={0} max={100} step={0.5} addonAfter="%" style={{ width: '100%' }} size="large" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="targetMarginPercent"
            label="Margin we need (%)"
            extra="What the platform keeps. This sets the price FLOOR under every tier — it does not change any price by itself."
          >
            <InputNumber min={0} max={1000} step={5} addonAfter="%" style={{ width: '100%' }} size="large" />
          </Form.Item>
        </Col>
      </Row>

      {/*
        * The worked example. The arithmetic is four lines, and an operator who
        * has seen it on a real figure sets these correctly the first time —
        * which matters, because every one of these fields is silently wrong
        * rather than visibly broken.
        */}
      <Card
        size="small"
        title={<Space><CalculatorOutlined />What this does to a real machine</Space>}
        style={{ marginBottom: 20, borderRadius: 12 }}
      >
        <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 14 }}>
          Taking a small machine that Google charges{' '}
          <Text strong>${EXAMPLE_PROVIDER_COST.toFixed(4)}</Text> an hour for:
        </Paragraph>
        <Row gutter={[16, 12]}>
          <Col xs={12} md={6}>
            <Statistic title="Provider charges" value={direct} precision={4} prefix="$" />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="+ our overhead" value={overhead} precision={4} prefix="$" />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="+ tax" value={tax} precision={4} prefix="$" />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title="= actually costs us"
              value={totalCost}
              precision={4}
              prefix="$"
              valueStyle={{ fontWeight: 700 }}
            />
          </Col>
        </Row>
        <Divider style={{ margin: '14px 0' }} />
        <Space align="center" wrap>
          <Statistic
            title="Lowest we may sell it for"
            value={floor}
            precision={4}
            prefix="$"
            valueStyle={{ color: '#1A9655', fontWeight: 700 }}
          />
          {multiple > 0 && (
            <Tag color={multiple >= 2 ? 'green' : 'orange'} style={{ marginLeft: 12 }}>
              {multiple.toFixed(2)}× what the provider charges
            </Tag>
          )}
        </Space>
        <Paragraph type="secondary" style={{ fontSize: 12, margin: '10px 0 0' }}>
          Any tier priced below the floor loses money on every hour it runs. The catalogue shows
          this figure while a tier is being written, and provisioning refuses to build a machine
          that would sell below its cost.
        </Paragraph>
      </Card>

      <Divider titlePlacement="left" plain style={{ fontSize: 12 }}>Clouds</Divider>

      <Row gutter={16}>
        {/*
          * The same control on each cloud, because they do the same thing.
          *
          * On: ask that cloud what a machine costs, every time. Off: use the
          * cost table recorded by hand on that cloud's Pricing tab.
          *
          * This is NOT a kill switch for the cloud — that is on the cloud's
          * own page. Turning this off is for when a provider's prices come
          * back wrong and you want the hand-written figure used instead,
          * without stopping machines from being built.
          */}
        <Col xs={24} md={12}>
          <Form.Item
            name="gcpEnabled"
            label="Price machines on Google Cloud"
            valuePropName="checked"
            extra="Reads Google's own prices automatically. Off falls back to the costs recorded by hand."
          >
            <Switch checkedChildren="On" unCheckedChildren="Off" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="awsEnabled"
            label="Price machines on AWS"
            valuePropName="checked"
            extra="Reads AWS's own prices automatically. Off falls back to the costs recorded by hand."
          >
            <Switch checkedChildren="On" unCheckedChildren="Off" />
          </Form.Item>
        </Col>
      </Row>

      <Button
        type="primary"
        icon={<SaveOutlined />}
        loading={saving}
        onClick={save}
        size="large"
        disabled={!canUpdate}
      >
        Save cloud cost settings
      </Button>
    </Form>
  );
};

export default CloudPricingSettings;
