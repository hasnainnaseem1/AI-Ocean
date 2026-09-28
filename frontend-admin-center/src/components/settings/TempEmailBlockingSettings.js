import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Input,
  List,
  Space,
  message,
  Modal,
  Empty,
  Spin,
  Tag,
  Tooltip,
  Divider,
  Upload,
  Row,
  Col
} from 'antd';
import {
  DeleteOutlined,
  PlusOutlined,
  DownloadOutlined,
  UploadOutlined,
  CopyOutlined
} from '@ant-design/icons';
import settingsApi from '../../api/settingsApi';
import { useTheme } from '../../contexts/ThemeContext';
import { muted, hairline } from '../../theme/colors';

const TempEmailBlockingSettings = ({ canUpdate }) => {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(false);
  const [domains, setDomains] = useState([]);
  const [newDomain, setNewDomain] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [buttonLoading, setButtonLoading] = useState({});

  useEffect(() => {
    fetchBlockedDomains();
  }, []);

  const fetchBlockedDomains = async () => {
    setLoading(true);
    try {
      const data = await settingsApi.getBlockedDomains();
      setDomains(data.domains || []);
    } catch (error) {
      message.error('Failed to load blocked domains');
    } finally {
      setLoading(false);
    }
  };

  const handleAddDomain = async () => {
    if (!newDomain.trim()) {
      message.warning('Please enter a domain');
      return;
    }

    // Basic domain validation
    const domainRegex = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
    if (!domainRegex.test(newDomain.trim())) {
      message.error('Invalid domain format. Example: tempmail.com');
      return;
    }

    setAddLoading(true);
    try {
      const data = await settingsApi.addBlockedDomain(newDomain.trim());
      setDomains(data.domains || []);
      setNewDomain('');
      message.success(`Domain ${newDomain.trim()} blocked successfully`);
    } catch (error) {
      if (error.response?.data?.message === 'Domain already blocked') {
        message.info('This domain is already blocked');
      } else {
        message.error(error.response?.data?.message || 'Failed to add domain');
      }
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteDomain = (domain) => {
    Modal.confirm({
      title: 'Unblock Domain',
      content: `Are you sure you want to unblock ${domain}? Users will be able to sign up with this email domain.`,
      okText: 'Yes, Unblock',
      cancelText: 'Cancel',
      okButtonProps: { danger: true },
      onOk: async () => {
        setButtonLoading(prev => ({ ...prev, [domain]: true }));
        try {
          const data = await settingsApi.removeBlockedDomain(domain);
          setDomains(data.domains || []);
          message.success(`Domain ${domain} unblocked successfully`);
        } catch (error) {
          message.error(error.response?.data?.message || 'Failed to remove domain');
        } finally {
          setButtonLoading(prev => ({ ...prev, [domain]: false }));
        }
      }
    });
  };

  const handleBlankList = () => {
    Modal.confirm({
      title: 'Clear All Blocked Domains',
      content: 'Are you sure you want to remove ALL blocked temporary email domains? This cannot be undone.',
      okText: 'Yes, Clear All',
      cancelText: 'Cancel',
      okButtonProps: { danger: true },
      onOk: async () => {
        setButtonLoading(prev => ({ ...prev, clearAll: true }));
        try {
          const data = await settingsApi.updateBlockedDomains([]);
          setDomains(data.domains || []);
          message.success('All blocked domains removed');
        } catch (error) {
          message.error('Failed to clear blocked domains');
        } finally {
          setButtonLoading(prev => ({ ...prev, clearAll: false }));
        }
      }
    });
  };

  const handleDownloadList = () => {
    const domainText = domains.join('\n');
    const element = document.createElement('a');
    const file = new Blob([domainText], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `blocked-domains-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    message.success('List downloaded successfully');
  };

  const handleImportDomains = (file) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const newDomains = text
          .split('\n')
          .map(d => d.trim().toLowerCase())
          .filter(d => d && /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(d));

        if (newDomains.length === 0) {
          message.error('No valid domains found in the file');
          return;
        }

        // Merge with existing domains
        const merged = Array.from(new Set([...domains, ...newDomains]));
        
        setButtonLoading(prev => ({ ...prev, import: true }));
        const data = await settingsApi.updateBlockedDomains(merged);
        setDomains(data.domains || []);
        message.success(`Imported ${newDomains.length} domains successfully`);
      } catch (error) {
        message.error('Failed to import domains');
      } finally {
        setButtonLoading(prev => ({ ...prev, import: false }));
      }
    };
    reader.readAsText(file);
    return false; // Prevent default upload behavior
  };

  const handleCopyAllDomains = () => {
    const domainText = domains.join('\n');
    navigator.clipboard.writeText(domainText);
    message.success('All domains copied to clipboard');
  };

  return (
    <Spin spinning={loading}>
      <Card
        title="Temporary Email Blocking"
        extra={
          <Tag color="blue">
            {domains.length} {domains.length === 1 ? 'domain' : 'domains'} blocked
          </Tag>
        }
        style={{ marginBottom: 20 }}
      >
        <div style={{ marginBottom: 24 }}>
          <p style={{ color: muted(isDark), marginBottom: 16 }}>
            Block temporary email domains to prevent disposable email signups. Users attempting to sign up with these email domains will be rejected.
          </p>

          {/* Add New Domain Section */}
          <Divider>Add Domain</Divider>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col flex="auto">
              <Input
                placeholder="Enter domain (e.g., tempmail.com)"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                onPressEnter={handleAddDomain}
                disabled={!canUpdate}
              />
            </Col>
            <Col>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleAddDomain}
                loading={addLoading}
                disabled={!canUpdate || !newDomain.trim()}
              >
                Add Domain
              </Button>
            </Col>
          </Row>

          {/* Bulk Operations */}
          <Divider>Bulk Operations</Divider>
          <Space wrap style={{ marginBottom: 20 }}>
            <Upload
              beforeUpload={handleImportDomains}
              accept=".txt,.csv"
              maxCount={1}
              customRequest={({ onSuccess }) => onSuccess()}
            >
              <Button
                icon={<UploadOutlined />}
                disabled={!canUpdate}
                loading={buttonLoading.import}
              >
                Import List (TXT/CSV)
              </Button>
            </Upload>

            <Button
              icon={<DownloadOutlined />}
              onClick={handleDownloadList}
              disabled={domains.length === 0}
            >
              Download List
            </Button>

            <Button
              icon={<CopyOutlined />}
              onClick={handleCopyAllDomains}
              disabled={domains.length === 0}
            >
              Copy All Domains
            </Button>

            {domains.length > 0 && (
              <Button
                danger
                onClick={handleBlankList}
                disabled={!canUpdate}
                loading={buttonLoading.clearAll}
              >
                Clear All Domains
              </Button>
            )}
          </Space>
        </div>

        {/* Blocked Domains List */}
        <Divider>Blocked Domains List</Divider>
        {domains.length === 0 ? (
          <Empty description="No domains blocked" />
        ) : (
          <List
            dataSource={domains}
            renderItem={(domain) => (
              <List.Item
                key={domain}
                actions={[
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => handleDeleteDomain(domain)}
                    disabled={!canUpdate}
                    loading={buttonLoading[domain]}
                    title="Unblock domain"
                  />
                ]}
              >
                <List.Item.Meta
                  description={
                    <span style={{ fontFamily: 'monospace', fontSize: 13 }}>
                      {domain}
                    </span>
                  }
                />
              </List.Item>
            )}
            style={{
              maxHeight: 400,
              overflowY: 'auto',
              border: `1px solid ${hairline(isDark)}`,
              borderRadius: 6,
              padding: 12
            }}
          />
        )}
      </Card>
    </Spin>
  );
};

export default TempEmailBlockingSettings;
