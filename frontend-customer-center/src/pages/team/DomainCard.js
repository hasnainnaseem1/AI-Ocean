import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Input, Button, Space, Typography, Alert, Select, Tag, Popconfirm, message,
} from 'antd';
import { GlobalOutlined, CheckCircleFilled, CopyOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { cardStyle } from '../../theme/colors';
import teamsApi from '../../api/teamsApi';
import { formatDate } from '../../utils/format';
import { teamErrorText } from './TeamOnboardingPage';

const { Text, Paragraph } = Typography;

/**
 * The organization's company domain, and what happens when a colleague with an
 * address at it turns up.
 *
 * The screen keeps saying the thing that is easy to get wrong: an address at
 * the domain proves nothing, the DNS record does. Until the record is
 * published, the claim is just a claim — and the join rule cannot even be set.
 */
const DomainCard = () => {
  const { t } = useTranslation(['teams', 'common']);
  const { isDark } = useTheme();

  const [domain, setDomain] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await teamsApi.domain();
      // The platform can keep company domains off entirely — most do, because
      // an invitation is the only way into a team anyone needs. Then this
      // whole section is absent rather than disabled.
      if (!data.domain?.enabled) { setDomain(null); return; }
      setDomain(data.domain || null);
      setInput(data.domain?.domain || '');
    } catch {
      // Not permitted to see it, or it could not be read — the section simply
      // does not appear rather than breaking the page.
      setDomain(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (fn, okText) => {
    setBusy(true);
    try {
      await fn();
      if (okText) message.success(okText);
      await load();
    } catch (err) {
      message.error(teamErrorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  if (!domain) return null;

  const verified = domain.verified;

  return (
    <Card style={{ ...cardStyle(isDark), marginBottom: 20 }} title={<span><GlobalOutlined /> {t('domain.title')}</span>}>
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Text type="secondary" style={{ fontSize: 12.5 }}>{t('domain.hint')}</Text>

        <Space.Compact style={{ width: '100%', maxWidth: 520 }}>
          <Input
            placeholder={t('domain.placeholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={() => run(() => teamsApi.setDomain(input), t('domain.saved'))}
            disabled={busy}
          />
          <Button type="primary" loading={busy} onClick={() => run(() => teamsApi.setDomain(input), t('domain.saved'))}>
            {domain.domain ? t('domain.replace') : t('domain.save')}
          </Button>
        </Space.Compact>

        {domain.domain && verified && (
          <Space wrap>
            <Tag icon={<CheckCircleFilled />} color="success">{t('domain.verified')}</Tag>
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              {t('domain.verifiedOn', { date: formatDate(domain.verifiedAt, 'dateTime') })}
            </Text>
            <Popconfirm
              title={t('domain.removeConfirm', { domain: domain.domain })}
              description={t('domain.removeHint')}
              okText={t('domain.remove')}
              okButtonProps={{ danger: true }}
              onConfirm={() => run(() => teamsApi.removeDomain(), t('domain.removed'))}
            >
              <Button size="small" danger>{t('domain.remove')}</Button>
            </Popconfirm>
          </Space>
        )}

        {domain.domain && !verified && (
          <Alert
            type="info"
            showIcon
            message={t('domain.proveTitle', { domain: domain.domain })}
            description={(
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text>{t('domain.proveBody')}</Text>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('domain.recordType')}</Text>
                  <div><Text code>TXT</Text></div>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('domain.recordHost')}</Text>
                  <div><Text code>{domain.txtHost}</Text></div>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('domain.recordValue')}</Text>
                  <Paragraph style={{ marginBottom: 0 }}>
                    <Text code style={{ wordBreak: 'break-all' }}>{domain.txtRecord}</Text>
                    <Button
                      size="small"
                      type="text"
                      icon={<CopyOutlined />}
                      onClick={() => {
                        navigator.clipboard?.writeText(domain.txtRecord);
                        message.success(t('settings.copied'));
                      }}
                    />
                  </Paragraph>
                </div>
                <Space>
                  <Button type="primary" loading={busy} onClick={() => run(() => teamsApi.verifyDomain(), t('domain.verifiedNow'))}>
                    {t('domain.verify')}
                  </Button>
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('domain.dnsSlow')}</Text>
                </Space>
              </Space>
            )}
          />
        )}

        {verified && (
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Text strong style={{ fontSize: 13 }}>{t('domain.joinTitle')}</Text>
            <Space wrap>
              <Select
                value={domain.joinMode}
                style={{ width: 260 }}
                onChange={(mode) => run(() => teamsApi.setJoinRule({ mode }), t('domain.ruleSaved'))}
                options={[
                  { value: 'off', label: t('domain.modeOff') },
                  { value: 'request', label: t('domain.modeRequest') },
                  { value: 'auto', label: t('domain.modeAuto') },
                ]}
              />
              {domain.joinMode !== 'off' && (
                <Select
                  value={domain.joinRole}
                  style={{ width: 180 }}
                  onChange={(role) => run(() => teamsApi.setJoinRule({ mode: domain.joinMode, role }), t('domain.ruleSaved'))}
                  options={[
                    { value: 'developer', label: t('roles.developer') },
                    { value: 'viewer', label: t('roles.viewer') },
                  ]}
                />
              )}
            </Space>
            <Text type="secondary" style={{ fontSize: 12.5 }}>{t(`domain.modeHint_${domain.joinMode}`)}</Text>
            {domain.joinMode !== 'off' && (
              <Text type="secondary" style={{ fontSize: 12.5 }}>{t('domain.roleHint')}</Text>
            )}
          </Space>
        )}

      </Space>
    </Card>
  );
};

export default DomainCard;
