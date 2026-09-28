import React, { useState, useEffect } from 'react';
import { Badge, Dropdown, Button, Empty, message, Space, Tag, Popconfirm } from 'antd';
import { BellOutlined, CheckOutlined, DeleteOutlined } from '@ant-design/icons';
import notificationsApi from '../../api/notificationsApi';
import { timeAgo } from '../../utils/helpers';
import { solidBg } from '../../theme/colors';
import './NotificationsDropdown.css';

const NotificationsDropdown = () => {
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  // Fetch notifications on mount and periodically
  useEffect(() => {
    fetchNotifications();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchNotifications = async () => {
    try {
      const data = await notificationsApi.getNotifications({ limit: 10, unreadOnly: false });
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  };

  const handleMarkAsRead = async (notificationId, e) => {
    e.stopPropagation();
    try {
      await notificationsApi.markAsRead(notificationId);
      message.success('Marked as read');
      fetchNotifications();
    } catch (error) {
      message.error('Failed to mark as read');
    }
  };

  const handleDelete = async (notificationId, e) => {
    e.stopPropagation();
    try {
      await notificationsApi.deleteNotification(notificationId);
      message.success('Notification deleted');
      fetchNotifications();
    } catch (error) {
      message.error('Failed to delete notification');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllAsRead();
      message.success('All notifications marked as read');
      fetchNotifications();
    } catch (error) {
      message.error('Failed to mark all as read');
    }
  };

  const getTypeColor = (type) => {
    const colorMap = {
      'password_reset': 'blue',
      'security_alert': 'red',
      'system_alert': 'orange',
      'account_suspended': 'red',
      'account_activated': 'green',
      'admin_message': 'purple',
    };
    return colorMap[type] || 'default';
  };

  const dropdownContent = (
    <div className="notifications-dropdown-content">
      {notifications.length === 0 ? (
        <Empty description="No notifications" />
      ) : (
        <>
          {unreadCount > 0 && (
            <div className="notifications-mark-all-button">
              <Button 
                type="text" 
                size="small" 
                icon={<CheckOutlined />}
                onClick={handleMarkAllRead}
                block
              >
                Mark all as read
              </Button>
            </div>
          )}
          <div className="notifications-list">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`notification-item ${!notification.isRead ? 'unread' : ''}`}
              >
                <div className="notification-content">
                  <div className="notification-header">
                    <strong className="notification-title">{notification.title}</strong>
                    <Tag color={getTypeColor(notification.type)} className="notification-type">
                      {notification.type.replace('_', ' ')}
                    </Tag>
                    {!notification.isRead && <div className="notification-dot" />}
                  </div>
                  <p className="notification-message">{notification.message}</p>
                  <span className="notification-time">{timeAgo(new Date(notification.createdAt))}</span>
                </div>
                <div className="notification-actions" onClick={(e) => e.stopPropagation()}>
                  {!notification.isRead && (
                    <Button
                      type="text"
                      size="small"
                      icon={<CheckOutlined />}
                      onClick={(e) => handleMarkAsRead(notification.id, e)}
                      title="Mark as read"
                    />
                  )}
                  <Popconfirm
                    title="Delete notification?"
                    onConfirm={(e) => handleDelete(notification.id, e)}
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      danger
                      title="Delete"
                    />
                  </Popconfirm>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );

  return (
    <Dropdown
      dropdownRender={() => dropdownContent}
      trigger={['click']}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      placement="bottomRight"
    >
      {/*
        The badge carries white text, so it takes the solid (darker) red in
        both themes. `STATUS_COLORS.error.dark` is the right shade for error
        *text* on a dark ground but only 2.81:1 behind white.
      */}
      <Badge count={unreadCount} offset={[-5, 5]} color={solidBg.error}>
        <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }} />} />
      </Badge>
    </Dropdown>
  );
};

export default NotificationsDropdown;
