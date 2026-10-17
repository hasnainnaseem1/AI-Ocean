import React, { useState, useEffect, useCallback } from 'react';
import {
  Form, Input, Button, Space, Alert, Row, Col, Typography, message, Spin,
  Descriptions, Tag, Card, Divider,
} from 'antd';
import {
  SaveOutlined, KeyOutlined, SettingOutlined, SafetyOutlined, LinkOutlined,
  ApiOutlined, CloudServerOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import settingsApi from '../../api/settingsApi';

const { Text, Paragraph } = Typography;

/**
 * How this platform reaches AWS.
 *
 * Deliberately the same four-tab shape as the Google Cloud page, and the same
 * split within it: credentials and the names of things here, switches next
 * door. An operator pasting a key should not be scrolling past the switch that
 * starts creating machines.
 *
 * ── The vocabulary, stated once ──
 *
 * The field labels use AWS's own words — account, security group, instance
 * profile — because those are what is printed on the console the operator is
 * copying from. The help text maps each one back to its Google equivalent for
 * anyone who set that up first.
 *
 * The secret access key is write-only: the server never returns it, not even
 * to a super admin, so the field renders blank every time and a blank field
 * means "keep the stored one". The access key ID *is* shown, because it
 * identifies which credential is loaded and is useless on its own.
 *
 * ── Why there is no "default region" here ──
 *
 * There used to be one, and it was wrong. A tier already says which regions it
 * is sold in, and the region the customer picked travels on the deployment —
 * so a default here would either be ignored or, worse, quietly override what
 * the customer was sold.
 *
 * What AWS genuinely needs instead is a block **per region**, because almost
 * everything below is regional on AWS and global on Google:
 *
 *   VPC, security group, subnet, machine image → one per region
 *   Account, access key, instance profile (IAM) → one, shared
 *
 * The machine image is the one that catches people out: `ami-0abc…` in Ireland
 * names a different image — usually none at all — in Mumbai.
 */

/** Plain-English names for the regions, for the card headings. */
const REGION_NAMES = {
  'eu-west-1': 'Ireland',
  'us-east-1': 'N. Virginia',
  'ap-south-1': 'Mumbai',
};

const AwsConnectionTab = ({ onSaved }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [current, setCurrent] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getSettings();
      const aws = data.settings?.awsSettings || {};
      setCurrent(aws);

      /*
       * The server sends every region the platform sells, configured or not,
       * each with its availability zones and what is still missing. So the
       * form shows the whole picture rather than hiding unbuilt regions behind
       * an "add" button — an operator needs to see that `ap-south` is empty,
       * because that is why tiers in Mumbai cannot be launched.
       */
      const regions = {};
      for (const [awsRegion, block] of Object.entries(aws.regions || {})) {
        regions[awsRegion] = {
          vpcId: block.vpcId || '',
          securityGroupId: block.securityGroupId || '',
          imageId: block.imageId || '',
          subnetIds: Object.fromEntries(
            (block.azs || []).map((az) => [az, block.subnetIds?.[az] || ''])
          ),
        };
      }

      form.setFieldsValue({
        accountId: aws.accountId || '',
        accessKeyId: aws.accessKeyId || '',
        secretAccessKey: '',
        instanceProfile: aws.instanceProfile || '',
        environment: aws.environment || 'staging',
        regions,
      });
    } catch {
      message.error('Could not load the AWS connection');
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const v = form.getFieldsValue();
      const payload = { ...v };

      // An untouched field must never wipe a stored secret.
      if (!v.secretAccessKey || !String(v.secretAccessKey).trim()) delete payload.secretAccessKey;

      // Blank subnet rows are dropped rather than sent as empty strings: an
      // empty subnet id would read as "configured but nowhere", and the server
      // treats a region with no subnet as not built, which is correct.
      payload.regions = Object.fromEntries(
        Object.entries(v.regions || {}).map(([awsRegion, block]) => [awsRegion, {
          vpcId: String(block?.vpcId || '').trim(),
          securityGroupId: String(block?.securityGroupId || '').trim(),
          imageId: String(block?.imageId || '').trim(),
          subnetIds: Object.fromEntries(
            Object.entries(block?.subnetIds || {})
              .map(([az, id]) => [az, String(id || '').trim()])
              .filter(([, id]) => id)
          ),
        }])
      );

      const data = await settingsApi.updateAws(payload);
      if (data.success) {
        message.success(data.message || 'Saved');
        form.setFieldsValue({ secretAccessKey: '' });
        setTestResult(null);
        load();
        if (onSaved) onSaved();
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult({ ok: true, ...(await settingsApi.testAws()) });
    } catch (err) {
      setTestResult({ ok: false, message: err.response?.data?.message || 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Spin spinning={loading}>
      <div style={{ maxWidth: 760 }}>
        <Alert
          type="info"
          showIcon
          icon={<CloudServerOutlined />}
          message="The AWS account this platform launches instances in"
          description={(
            <>
              The VPC, the isolation rules and the NAT these instances depend on are not configured
              here — they are built once from <Text code>infra/aws</Text> with Terragrunt. See{' '}
              <Text code>infra/aws/SETUP.md</Text>, which starts with a table mapping every Google
              Cloud term to its AWS equivalent.
            </>
          )}
          style={{ marginBottom: 20, borderRadius: 12 }}
        />

        {current?.hasSecretAccessKey && (
          <Descriptions size="small" bordered column={1} style={{ marginBottom: 20 }}>
            <Descriptions.Item label="Credential loaded">
              <Space>
                <Text code>{current.accessKeyId || 'unknown key id'}</Text>
                <Tag color="green">secret encrypted</Tag>
              </Space>
            </Descriptions.Item>
          </Descriptions>
        )}

        <Form form={form} layout="vertical" requiredMark={false}>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="accountId"
                label={<Space><SettingOutlined /> Account ID</Space>}
                extra="Your 12-digit AWS account number. The GCP equivalent is the project id."
              >
                <Input placeholder="123456789012" size="large" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="environment"
                label="Environment"
                extra="Matches the infra/aws/live/<env> that built the network."
              >
                <Input placeholder="staging" size="large" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="accessKeyId"
                label={<Space><KeyOutlined /> Access key ID</Space>}
                extra="Shown, because it only identifies which credential is loaded — it is useless without the secret."
              >
                <Input placeholder="AKIA…" size="large" style={{ fontFamily: 'monospace' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="secretAccessKey"
                label={<Space><KeyOutlined /> Secret access key</Space>}
                extra={current?.hasSecretAccessKey
                  ? 'Leave blank to keep the stored secret. Pasting a new one replaces it.'
                  : 'Created with: aws iam create-access-key --user-name aiocean-platform-runtime'}
              >
                <Input.Password
                  autoComplete="off"
                  placeholder={current?.hasSecretAccessKey
                    ? '••••••••  (leave blank to keep existing)'
                    : '40 characters'}
                  size="large"
                />
              </Form.Item>
            </Col>
          </Row>

          {current?.hasSecretAccessKey && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 20, borderRadius: 10 }}
              message="Delete your copy of the secret"
              description="Now that it is stored here, any copy in your terminal history or a downloaded
                .csv is a second copy of a credential that can create and destroy machines by the hour.
                Delete it, and never send it to anyone — including support."
            />
          )}

          <Form.Item
            name="instanceProfile"
            label={<Space><SafetyOutlined /> Instance profile</Space>}
            extra="The role-less profile every customer instance runs as. One is enough: IAM is the
              one thing on AWS that is global, so this works in every region. GCP's equivalent is the
              customer-vm service account."
          >
            <Input placeholder="aiocean-customer-vm" size="large" style={{ maxWidth: 360 }} />
          </Form.Item>

          {/*
            * `titlePlacement`, not `orientation` — antd now reads
            * `orientation` as horizontal/vertical and warns on the old
            * meaning. The rest of this app still uses the old prop; this is
            * simply a new Divider written against the current API rather than
            * one more instance to migrate later.
            */}
          <Divider titlePlacement="left" plain style={{ marginTop: 28 }}>
            <Space><GlobalOutlined />Each region, built separately</Space>
          </Divider>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 18, borderRadius: 10 }}
            message="On AWS a network belongs to one region, so each region needs its own"
            description={(
              <>
                This is the biggest difference from Google Cloud, where one network covers every
                region. Here the VPC, the security group, the subnets and the machine image all
                belong to a single region — so a region with nothing filled in below cannot build
                anything, however valid the credentials are.
                <br />
                <Text strong>A tier is only sellable in a region that is green here.</Text> Which
                region a machine goes to comes from the tier and the customer&apos;s choice, never
                from this page.
              </>
            )}
          />

          {Object.entries(current?.regions || {}).map(([awsRegion, info]) => (
            <Card
              key={awsRegion}
              size="small"
              style={{ marginBottom: 14, borderRadius: 12 }}
              title={(
                <Space wrap>
                  {info.ready
                    ? <CheckCircleOutlined style={{ color: '#1A9655' }} />
                    : <ExclamationCircleOutlined style={{ color: '#C97E14' }} />}
                  <Text strong>{awsRegion}</Text>
                  <Text type="secondary" style={{ fontWeight: 400 }}>
                    {REGION_NAMES[awsRegion] || ''}
                  </Text>
                  {(info.platformRegions || []).map((p) => (
                    <Tag key={p} color="blue">sold as {p}</Tag>
                  ))}
                  {info.ready
                    ? <Tag color="green">ready</Tag>
                    : <Tag color="orange">no {(info.missing || []).join(', ')}</Tag>}
                </Space>
              )}
            >
              <Row gutter={12}>
                <Col xs={24} sm={8}>
                  <Form.Item
                    name={['regions', awsRegion, 'vpcId']}
                    label={<Space><LinkOutlined /> VPC</Space>}
                    extra="Never the default VPC — its security group lets every instance reach every other."
                    rules={[{ pattern: /^vpc-[0-9a-f]{8,17}$/, message: 'e.g. vpc-0abc1234' }]}
                  >
                    <Input placeholder="vpc-0abc…" style={{ fontFamily: 'monospace' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={8}>
                  <Form.Item
                    name={['regions', awsRegion, 'securityGroupId']}
                    label={<Space><SafetyOutlined /> Security group</Space>}
                    extra="The customer group infra/aws created — no inbound rules at all."
                    rules={[{ pattern: /^sg-[0-9a-f]{8,17}$/, message: 'e.g. sg-0abc1234' }]}
                  >
                    <Input placeholder="sg-0abc…" style={{ fontFamily: 'monospace' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={8}>
                  <Form.Item
                    name={['regions', awsRegion, 'imageId']}
                    label={<Space><CloudServerOutlined /> Machine image</Space>}
                    extra="An AMI id only exists in one region — the same id names nothing in another."
                    rules={[{ pattern: /^ami-[0-9a-f]{8,17}$/, message: 'e.g. ami-0abc1234' }]}
                  >
                    <Input placeholder="ami-0abc…" style={{ fontFamily: 'monospace' }} />
                  </Form.Item>
                </Col>
              </Row>

              {/*
                * The availability zones come from the server, so they are
                * picked rather than typed. The old form let an AZ be typed
                * free-hand, and a subnet filed under a zone this platform
                * never places machines in is invisible until a launch fails.
                */}
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                Customer subnets — an instance is launched into a subnet, and the subnet is what
                decides its availability zone.
              </Text>
              <Row gutter={12} style={{ marginTop: 8 }}>
                {(info.azs || []).map((az) => (
                  <Col xs={24} sm={12} key={az}>
                    <Form.Item
                      name={['regions', awsRegion, 'subnetIds', az]}
                      label={<Text code style={{ fontSize: 12 }}>{az}</Text>}
                      rules={[{ pattern: /^subnet-[0-9a-f]{8,17}$/i, message: 'e.g. subnet-0abc1234' }]}
                    >
                      <Input placeholder="subnet-0abc…" style={{ fontFamily: 'monospace' }} />
                    </Form.Item>
                  </Col>
                ))}
              </Row>

              {!info.ready && (
                <Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
                  Build it with <Text code>{`infra/aws/live/<env>/${awsRegion}`}</Text>, then paste
                  the outputs here.
                </Paragraph>
              )}
            </Card>
          ))}

          <Space style={{ marginBottom: 8, marginTop: 10 }}>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save} size="large">
              Save connection
            </Button>
            <Button icon={<ApiOutlined />} loading={testing} onClick={test} size="large">
              Test connection
            </Button>
          </Space>
          <Paragraph type="secondary" style={{ fontSize: 12, margin: '4px 0 0' }}>
            The test checks every region that is ready, because a key can be valid while a region is
            disabled on the account — and that only shows up per region. It creates nothing.
          </Paragraph>

          {testResult && (
            <Alert
              type={testResult.ok ? 'success' : 'error'}
              showIcon
              style={{ marginTop: 12, borderRadius: 10 }}
              message={testResult.message || (testResult.ok ? 'Connection OK' : 'Connection failed')}
              description={testResult.dryRun
                ? 'Dry run is on, so nothing was sent to AWS. Turn it off under Provisioning to check the stored credentials for real.'
                : undefined}
            />
          )}
        </Form>
      </div>
    </Spin>
  );
};

export default AwsConnectionTab;
