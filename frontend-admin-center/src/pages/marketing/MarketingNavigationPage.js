import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Switch, InputNumber, message, Space, Tag,
} from 'antd';
import {
  SaveOutlined, MenuOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import marketingApi from '../../api/marketingApi';
import { useTheme } from '../../contexts/ThemeContext';
import { muted, subtle } from '../../theme/colors';

const MarketingNavigationPage = () => {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pages, setPages] = useState([]);

  const fetchPages = useCallback(async () => {
    setLoading(true);
    try {
      const data = await marketingApi.getPages();
      // Only show published + draft pages (not archived)
      const filteredPages = (data.pages || [])
        .filter((p) => p.status !== 'archived')
        .sort((a, b) => (a.navigationOrder || 0) - (b.navigationOrder || 0));
      setPages(filteredPages);
    } catch {
      message.error('Failed to load pages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  const handleToggleNavigation = async (id) => {
    const page = pages.find((p) => p.id === id);
    if (!page) return;
    try {
      await marketingApi.updatePage(id, { showInNavigation: !page.showInNavigation });
      setPages(pages.map((p) => p.id === id ? { ...p, showInNavigation: !p.showInNavigation } : p));
    } catch {
      message.error('Failed to update');
    }
  };

  const handleOrderChange = (id, value) => {
    setPages(pages.map((p) => p.id === id ? { ...p, navigationOrder: value } : p));
  };

  const handleSaveOrder = async () => {
    setSaving(true);
    try {
      const orderData = pages.map((p) => ({ id: p.id, navigationOrder: p.navigationOrder || 0 }));
      await marketingApi.reorderPages(orderData);
      message.success('Navigation order saved');
    } catch {
      message.error('Failed to save order');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: '',
      width: 64,
      render: () => <MenuOutlined style={{ color: subtle(isDark), cursor: 'grab' }} />,
    },
    {
      title: 'Page',
      dataIndex: 'title',
      key: 'title',
      render: (title, record) => (
        <Space>
          <span style={{ fontWeight: 600 }}>{title}</span>
          <Tag color={record.status === 'published' ? 'green' : 'orange'}>{record.status}</Tag>
        </Space>
      ),
    },
    {
      title: 'Show in Nav',
      dataIndex: 'showInNavigation',
      key: 'showInNavigation',
      width: 100,
      align: 'center',
      render: (show, record) => (
        <Switch checked={show} onChange={() => handleToggleNavigation(record.id)} />
      ),
    },
    {
      title: 'Order',
      dataIndex: 'navigationOrder',
      key: 'navigationOrder',
      width: 80,
      align: 'center',
      render: (order, record) => (
        <InputNumber
          size="small"
          min={0}
          value={order}
          onChange={(val) => handleOrderChange(record.id, val)}
          style={{ width: 70 }}
        />
      ),
    },
    {
      title: 'URL',
      dataIndex: 'slug',
      key: 'slug',
      render: (slug, record) => (
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: muted(isDark) }}>
          /{record.isHomePage ? '' : slug}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Navigation"
        subtitle="Configure which pages appear in the marketing site navigation and their order"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Website' }, { label: 'Navigation' }]}
        extra={
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSaveOrder}>
            Save Order
          </Button>
        }
      />

      <DataTable
        title="Pages"
        count={pages.length}
        onRefresh={fetchPages}
        refreshLoading={loading}
        empty={{ title: 'No pages found', description: 'Create marketing pages first.' }}
        dataSource={pages}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
        size="middle"
      />
    </div>
  );
};

export default MarketingNavigationPage;
