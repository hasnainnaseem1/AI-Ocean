import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Tag, Space, Typography, Badge,
  Modal, message,
} from 'antd';
import {
  CheckOutlined, DeleteOutlined,
  FilterOutlined, ExclamationCircleOutlined,
  InfoCircleOutlined, WarningOutlined,
  EyeOutlined
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import DataTable, { rowActions } from '../../components/common/DataTable';
import notificationsApi from '../../api/notificationsApi';
import { useTheme } from '../../contexts/ThemeContext';
import { TILE, STATUS_COLORS } from '../../theme/colors';

const { Text, Paragraph } = Typography;
const { confirm } = Modal;

const typeColors = {
  welcome: 'green',
  email_verification: 'blue',
  password_reset: 'orange',
  analysis_limit_reached: 'red',
  account_suspended: 'red',
  account_activated: 'green',
  new_feature: 'blue',
  system_alert: 'orange',
  admin_message: 'purple',
  security_alert: 'red',
};

const priorityColors = {
  low: 'blue',
  medium: 'gold',
  high: 'orange',
  urgent: 'red',
};

/** "system_alert" -> "System alert" — the sentence case every other list's Tag uses. */
const sentenceCase = (s) => {
  const words = (s || '').replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
};

const NotificationsPage = () => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [searchText, setSearchText] = useState('');
  const [filterUnread, setFilterUnread] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [viewModal, setViewModal] = useState(null);
  const { isDark } = useTheme();
  const warning = STATUS_COLORS.warning[isDark ? 'dark' : 'light'];
  const error = STATUS_COLORS.error[isDark ? 'dark' : 'light'];
  const info = TILE.blue.fg(isDark);
  const priorityIcons = {
    low: <InfoCircleOutlined style={{ color: info }} />,
    medium: <InfoCircleOutlined style={{ color: warning }} />,
    high: <WarningOutlined style={{ color: warning }} />,
    urgent: <ExclamationCircleOutlined style={{ color: error }} />,
  };

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const data = await notificationsApi.getNotifications({
        limit: pagination.pageSize,
        skip: (pagination.current - 1) * pagination.pageSize,
        unreadOnly: filterUnread,
      });
      setNotifications(data.notifications || []);
      setTotal(data.total || 0);
      setUnreadCount(data.unreadCount || 0);
    } catch {
      message.error('Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [pagination, filterUnread]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAsRead = async (id) => {
    try {
      await notificationsApi.markAsRead(id);
      message.success('Marked as read');
      fetchNotifications();
    } catch {
      message.error('Failed to mark as read');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllAsRead();
      message.success('All notifications marked as read');
      fetchNotifications();
    } catch {
      message.error('Failed to mark all as read');
    }
  };

  const handleDelete = (id) => {
    confirm({
      title: 'Delete this notification?',
      icon: <ExclamationCircleOutlined />,
      content: 'This action cannot be undone.',
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await notificationsApi.deleteNotification(id);
          message.success('Notification deleted');
          fetchNotifications();
        } catch {
          message.error('Failed to delete notification');
        }
      },
    });
  };

  const handleBulkDelete = () => {
    if (selectedRowKeys.length === 0) return;
    confirm({
      title: `Delete ${selectedRowKeys.length} notification(s)?`,
      icon: <ExclamationCircleOutlined />,
      okText: 'Delete',
      okType: 'danger',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map((id) => notificationsApi.deleteNotification(id)));
          message.success(`Deleted ${selectedRowKeys.length} notification(s)`);
          setSelectedRowKeys([]);
          fetchNotifications();
        } catch {
          message.error('Failed to delete some notifications');
        }
      },
    });
  };

  const filteredNotifications = searchText
    ? notifications.filter(
        (n) =>
          n.title?.toLowerCase().includes(searchText.toLowerCase()) ||
          n.message?.toLowerCase().includes(searchText.toLowerCase())
      )
    : notifications;

  const columns = [
    {
      title: '',
      dataIndex: 'isRead',
      key: 'isRead',
      width: 64,
      render: (isRead) =>
        !isRead ? (
          <Badge status="processing" />
        ) : (
          <Badge status="default" />
        ),
    },
    {
      title: 'Priority',
      dataIndex: 'priority',
      key: 'priority',
      width: 126,
      render: (p) => (
        <Tag color={priorityColors[p]}>
          {sentenceCase(p || 'medium')}
        </Tag>
      ),
      filters: [
        { text: 'Urgent', value: 'urgent' },
        { text: 'High', value: 'high' },
        { text: 'Medium', value: 'medium' },
        { text: 'Low', value: 'low' },
      ],
      onFilter: (value, record) => record.priority === value,
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 213,
      render: (type) => (
        <Tag color={typeColors[type] || 'default'}>
          {sentenceCase(type)}
        </Tag>
      ),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title, record) => (
        <Text
          strong={!record.isRead}
          style={{ cursor: 'pointer' }}
          onClick={() => setViewModal(record)}
        >
          {title}
        </Text>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 179,
      render: (d) =>
        d
          ? new Date(d).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '-',
      sorter: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
      defaultSortOrder: 'descend',
    },
    rowActions([
      { key: 'view', icon: <EyeOutlined />, label: 'View', onClick: setViewModal },
      {
        key: 'markRead', icon: <CheckOutlined />, label: 'Mark as read',
        visible: (r) => !r.isRead, onClick: (r) => handleMarkAsRead(r.id),
      },
      {
        key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true,
        onClick: (r) => handleDelete(r.id),
      },
    ]),
  ];

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}
        count={total}
        extra={
          <Button
            icon={<CheckOutlined />}
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
          >
            Mark All Read
          </Button>
        }
      />

      <DataTable
        title="Notifications"
        count={total}
        search={{ value: searchText, onChange: (e) => setSearchText(e.target.value), placeholder: 'Search notifications...' }}
        onRefresh={fetchNotifications}
        refreshLoading={loading}
        toolbarExtra={
          <Button
            icon={<FilterOutlined />}
            type={filterUnread ? 'primary' : 'default'}
            onClick={() => {
              setFilterUnread(!filterUnread);
              setPagination({ ...pagination, current: 1 });
            }}
          >
            {filterUnread ? 'Showing Unread Only' : 'Show Unread Only'}
          </Button>
        }
        selection={{
          enabled: true,
          selectedRowKeys,
          onChange: setSelectedRowKeys,
          actions: [{
            key: 'delete', label: 'Delete Selected', danger: true, icon: <DeleteOutlined />,
            onClick: handleBulkDelete,
          }],
        }}
        empty={{ title: 'No notifications' }}
        columns={columns}
        dataSource={filteredNotifications}
        rowKey="id"
        loading={loading}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `Total ${t} notifications`,
          onChange: (page, pageSize) =>
            setPagination({ current: page, pageSize }),
        }}
      />

      {/* View Modal */}
      <Modal
        title={
          <Space>
            {priorityIcons[viewModal?.priority]}
            <span>{viewModal?.title}</span>
          </Space>
        }
        open={!!viewModal}
        onCancel={() => {
          if (viewModal && !viewModal.isRead) {
            handleMarkAsRead(viewModal.id);
          }
          setViewModal(null);
        }}
        footer={[
          <Button key="close" onClick={() => setViewModal(null)}>
            Close
          </Button>,
          viewModal?.action?.url && (
            <Button
              key="action"
              type="primary"
              href={viewModal.action.url}
              target="_blank"
            >
              {viewModal.action.label || 'View'}
            </Button>
          ),
        ]}
      >
        {viewModal && (
          <div>
            <Space style={{ marginBottom: 16 }}>
              <Tag color={typeColors[viewModal.type] || 'default'}>
                {sentenceCase(viewModal.type)}
              </Tag>
              <Tag color={priorityColors[viewModal.priority]}>
                {sentenceCase(viewModal.priority || 'medium')}
              </Tag>
              <Text type="secondary">
                {new Date(viewModal.createdAt).toLocaleString()}
              </Text>
            </Space>
            <Paragraph>{viewModal.message}</Paragraph>
            {viewModal.senderName && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                From: {viewModal.senderName}
              </Text>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default NotificationsPage;
