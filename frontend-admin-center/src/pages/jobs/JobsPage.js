import React, { useState, useEffect, useCallback } from 'react';
import {
  Form, Input, Button, Row, Col, Switch, Typography,
  Table, Tag, Space, message, Tooltip, Badge,
  Popconfirm, Modal, Select, Divider, InputNumber,
} from 'antd';
import {
  ClockCircleOutlined, PlayCircleOutlined, ReloadOutlined,
  CheckCircleOutlined, ExclamationCircleOutlined,
  PlusOutlined, EditOutlined, DeleteOutlined,
} from '@ant-design/icons';
import settingsApi from '../../api/settingsApi';
import PageHeader from '../../components/common/PageHeader';
import { useTheme } from '../../contexts/ThemeContext';
import { getBrand, STATUS_COLORS } from '../../theme/colors';

const { Text } = Typography;

/**
 * Scheduled background tasks — the platform's own internal automation, not a
 * connection to anything external. Moved here from Integrations (which is
 * for external connections with their own API keys — Stripe, SMTP, Google —
 * none of which this page has) and kept out of Settings, since this is a
 * full record list with its own create/edit/run-now/delete flow, not a form
 * of toggles and preferences.
 */
const SCHEDULE_PRESETS = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every 30 minutes', value: '*/30 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Every 12 hours', value: '0 */12 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Daily at 9 AM', value: '0 9 * * *' },
  { label: 'Weekly (Sunday midnight)', value: '0 0 * * 0' },
  { label: 'Monthly (1st at midnight)', value: '0 0 1 * *' },
];

const JobsPage = () => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState(null); // null = create, object = edit
  const [modalSaving, setModalSaving] = useState(false);
  const [form] = Form.useForm();
  const actionType = Form.useWatch('actionType', form);
  const { isDark } = useTheme();
  const brand = getBrand(isDark);
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];

  const fetchJobs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getCronJobs();
      if (data.success) setJobs(data.jobs || []);
    } catch {
      message.error('Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const handleToggle = async (key) => {
    try {
      const data = await settingsApi.toggleCronJob(key);
      if (data.success) {
        message.success(data.message);
        fetchJobs();
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to toggle job');
    }
  };

  const handleTrigger = async (key) => {
    setTriggering(key);
    try {
      const data = await settingsApi.triggerCronJob(key);
      if (data.success) {
        message.success('Job executed successfully');
        fetchJobs();
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to trigger job');
    } finally {
      setTriggering(null);
    }
  };

  const openCreateModal = () => {
    setEditingJob(null);
    form.resetFields();
    form.setFieldsValue({ actionType: 'http', enabled: true, httpMethod: 'GET' });
    setModalOpen(true);
  };

  const openEditModal = (record) => {
    setEditingJob(record);
    form.resetFields();
    form.setFieldsValue({
      name: record.name,
      description: record.description || '',
      schedule: record.schedule,
      scheduleLabel: record.scheduleLabel || '',
      actionType: record.actionType || 'log',
      httpUrl: record.httpConfig?.url || '',
      httpMethod: record.httpConfig?.method || 'GET',
      httpBody: record.httpConfig?.body || '',
      logMessage: record.logMessage || '',
      emailTo: record.emailConfig?.to || '',
      emailSubject: record.emailConfig?.subject || '',
      emailBody: record.emailConfig?.body || '',
      cleanupTarget: record.cleanupConfig?.target || 'activityLogs',
      cleanupOlderThanDays: record.cleanupConfig?.olderThanDays ?? 30,
      notificationTitle: record.notificationConfig?.title || '',
      notificationMessage: record.notificationConfig?.message || '',
      notificationType: record.notificationConfig?.notificationType || 'system_alert',
      backupCollections: record.backupConfig?.collections || [],
      backupOutputDir: record.backupConfig?.outputDir || 'backups',
      enabled: record.enabled,
    });
    setModalOpen(true);
  };

  const handleDelete = async (key) => {
    try {
      const data = await settingsApi.deleteCronJob(key);
      if (data.success) {
        message.success('Job deleted');
        fetchJobs();
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to delete');
    }
  };

  const handleModalSave = async () => {
    try {
      const values = await form.validateFields();
      setModalSaving(true);

      // Build payload
      const payload = {
        name: values.name,
        description: values.description || '',
        schedule: values.schedule,
        scheduleLabel: values.scheduleLabel || values.schedule,
        actionType: values.actionType,
        enabled: values.enabled !== false,
      };
      if (values.actionType === 'http') {
        payload.httpConfig = {
          url: values.httpUrl,
          method: values.httpMethod || 'GET',
          body: values.httpBody || '',
        };
      } else if (values.actionType === 'email') {
        payload.emailConfig = {
          to: values.emailTo,
          subject: values.emailSubject,
          body: values.emailBody || '',
        };
      } else if (values.actionType === 'cleanup') {
        payload.cleanupConfig = {
          target: values.cleanupTarget || 'activityLogs',
          olderThanDays: values.cleanupOlderThanDays ?? 30,
        };
      } else if (values.actionType === 'notification') {
        payload.notificationConfig = {
          title: values.notificationTitle,
          message: values.notificationMessage || '',
          notificationType: values.notificationType || 'system_alert',
        };
      } else if (values.actionType === 'backup') {
        payload.backupConfig = {
          collections: values.backupCollections || [],
          outputDir: values.backupOutputDir || 'backups',
        };
      } else {
        payload.logMessage = values.logMessage || '';
      }

      if (editingJob) {
        // Update
        const data = await settingsApi.updateCronJob(editingJob.key, payload);
        if (data.success) {
          message.success('Job updated');
          setModalOpen(false);
          fetchJobs();
        }
      } else {
        // Create
        payload.key = values.key;
        const data = await settingsApi.createCronJob(payload);
        if (data.success) {
          message.success('Job created');
          setModalOpen(false);
          fetchJobs();
        }
      }
    } catch (err) {
      if (err.errorFields) return; // form validation
      message.error(err.response?.data?.message || 'Failed to save job');
    } finally {
      setModalSaving(false);
    }
  };

  const columns = [
    {
      title: 'Job',
      dataIndex: 'name',
      key: 'name',
      width: 340,
      // Stacked as Space.Items (not raw <br/>) so each line gets its own
      // clip-with-ellipsis from the global table CSS — a plain <div> with
      // <br/> tags falls apart under that same CSS: `white-space: nowrap`
      // (added globally for the ledger-table density) ignores line breaks
      // entirely, so name, description and the action-type tag all ran
      // together onto a single line, pushing every column after it off the
      // edge of the screen with no scrollbar to reach them.
      render: (text, record) => (
        <Space direction="vertical" size={2} style={{ display: 'flex', minWidth: 0 }}>
          <Space size={6}>
            <Text strong>{text}</Text>
            {record.system
              ? <Tag color="geekblue" style={{ fontSize: 10 }}>SYSTEM</Tag>
              : <Tag color="purple" style={{ fontSize: 10 }}>CUSTOM</Tag>}
          </Space>
          <Tooltip title={record.description}>
            <Text type="secondary" style={{ fontSize: 12 }}>{record.description}</Text>
          </Tooltip>
          {!record.system && record.actionType && (
            <Tag style={{ fontSize: 10 }} color={
              record.actionType === 'http' ? 'cyan' :
              record.actionType === 'email' ? 'green' :
              record.actionType === 'cleanup' ? 'red' :
              record.actionType === 'notification' ? 'purple' :
              record.actionType === 'backup' ? 'geekblue' :
              'orange'
            }>
              {record.actionType === 'http' ? `HTTP ${record.httpConfig?.method || 'GET'}` :
               record.actionType === 'email' ? 'EMAIL' :
               record.actionType === 'cleanup' ? `CLEANUP ${record.cleanupConfig?.target || ''}` :
               record.actionType === 'notification' ? 'NOTIFICATION' :
               record.actionType === 'backup' ? 'BACKUP' :
               'LOG'}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'Schedule',
      dataIndex: 'scheduleLabel',
      key: 'schedule',
      width: 160,
      render: (text, record) => (
        <Tooltip title={`Cron: ${record.schedule}`}>
          <Tag icon={<ClockCircleOutlined />} color="blue">{text || record.schedule}</Tag>
        </Tooltip>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'enabled',
      key: 'status',
      width: 110,
      render: (enabled) =>
        enabled
          ? <Badge status="success" text={<Text style={{ color: success }}>Active</Text>} />
          : <Badge status="error" text={<Text type="danger">Disabled</Text>} />,
    },
    {
      title: 'Last Run',
      dataIndex: 'lastRun',
      key: 'lastRun',
      width: 180,
      render: (val, record) => {
        if (!val) return <Text type="secondary">Never</Text>;
        return (
          <Space direction="vertical" size={0}>
            <Text style={{ fontSize: 13 }}>
              {new Date(val).toLocaleString()}
            </Text>
            <Tag
              color={record.lastStatus === 'success' ? 'green' : 'red'}
              icon={record.lastStatus === 'success' ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
              style={{ fontSize: 11 }}
            >
              {record.lastStatus}
            </Tag>
          </Space>
        );
      },
    },
    {
      title: 'Runs',
      dataIndex: 'runCount',
      key: 'runCount',
      width: 64,
      render: (v) => <Tag>{v}</Tag>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 230,
      render: (_, record) => (
        <Space wrap>
          <Switch
            checked={record.enabled}
            onChange={() => handleToggle(record.key)}
            checkedChildren="ON"
            unCheckedChildren="OFF"
            size="small"
          />
          <Popconfirm
            title="Run this job now?"
            description="This will immediately execute the job."
            onConfirm={() => handleTrigger(record.key)}
            okText="Run"
          >
            <Button
              size="small"
              icon={<PlayCircleOutlined />}
              loading={triggering === record.key}
              type="primary"
              ghost
            >
              Run
            </Button>
          </Popconfirm>
          {!record.system && (
            <>
              <Tooltip title="Edit">
                <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)} />
              </Tooltip>
              <Popconfirm
                title="Delete this job?"
                description="This action cannot be undone."
                onConfirm={() => handleDelete(record.key)}
                okText="Delete"
                okButtonProps={{ danger: true }}
              >
                <Tooltip title="Delete">
                  <Button size="small" icon={<DeleteOutlined />} danger />
                </Tooltip>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Jobs"
        subtitle="Scheduled background tasks and maintenance"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Administration' }, { label: 'Jobs' }]}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchJobs}>Refresh</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}
              style={{ background: brand, borderColor: brand }}>
              Create Job
            </Button>
          </Space>
        }
      />

      <Table
        columns={columns}
        dataSource={jobs}
        rowKey="key"
        loading={loading}
        pagination={false}
        scroll={{ x: 1060 }}
        // Without this, the browser falls back to content-sizing each column
        // (table-layout: auto) and ignores every `width` above — the "Job"
        // column's long description then grows to fit on one line instead of
        // clipping, dragging the whole table out to ~2000px and pushing
        // Schedule/Status/Last Run/Runs/Actions off the visible edge.
        tableLayout="fixed"
        style={{ borderRadius: 12, overflow: 'hidden' }}
      />

      {/* ─── Create / Edit Modal ─── */}
      <Modal
        title={editingJob ? `Edit Job: ${editingJob.name}` : 'Create Custom Job'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleModalSave}
        okText={editingJob ? 'Update' : 'Create'}
        confirmLoading={modalSaving}
        width={600}
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 16 }}>
          {!editingJob && (
            <Form.Item
              name="key"
              label="Job Key"
              rules={[
                { required: true, message: 'Job key is required' },
                { pattern: /^[a-z0-9_-]+$/, message: 'Only lowercase letters, numbers, hyphens, underscores' },
              ]}
              extra="Unique identifier (e.g., daily_report, cleanup_logs)"
            >
              <Input placeholder="my_custom_job" />
            </Form.Item>
          )}

          <Form.Item name="name" label="Job Name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="Daily Report Generator" />
          </Form.Item>

          <Form.Item name="description" label="Description">
            <Input.TextArea placeholder="What does this job do?" rows={2} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={16}>
              <Form.Item
                name="schedule"
                label="Cron Schedule"
                rules={[{ required: true, message: 'Schedule is required' }]}
                extra={<Text type="secondary" style={{ fontSize: 11 }}>Format: minute hour day month weekday  (e.g., 0 9 * * * = daily at 9 AM)</Text>}
              >
                <Select
                  showSearch
                  placeholder="Select or type a cron expression"
                  options={SCHEDULE_PRESETS}
                  allowClear
                  dropdownRender={(menu) => (
                    <>
                      {menu}
                      <Divider style={{ margin: '8px 0' }} />
                      <div style={{ padding: '0 8px 8px' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>Or type a custom expression above</Text>
                      </div>
                    </>
                  )}
                  filterOption={(input, option) =>
                    option?.label?.toLowerCase().includes(input.toLowerCase()) ||
                    option?.value?.includes(input)
                  }
                  // Allow custom input
                  mode={undefined}
                  onSearch={() => {}}
                  notFoundContent={<Text type="secondary">Type a valid cron expression</Text>}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="scheduleLabel" label="Label (optional)">
                <Input placeholder="Every hour" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="actionType" label="Action Type" rules={[{ required: true }]}>
            <Select
              options={[
                { label: 'HTTP Request — call an API endpoint', value: 'http' },
                { label: 'Send Email — send email via SMTP', value: 'email' },
                { label: 'Database Cleanup — remove old records', value: 'cleanup' },
                { label: 'Notification — send in-app admin notification', value: 'notification' },
                { label: 'Database Backup — export collections to JSON', value: 'backup' },
                { label: 'Log Message — write to server log', value: 'log' },
              ]}
            />
          </Form.Item>

          {actionType === 'http' && (
            <>
              <Row gutter={16}>
                <Col span={6}>
                  <Form.Item name="httpMethod" label="Method" initialValue="GET">
                    <Select options={[
                      { label: 'GET', value: 'GET' },
                      { label: 'POST', value: 'POST' },
                      { label: 'PUT', value: 'PUT' },
                      { label: 'DELETE', value: 'DELETE' },
                    ]} />
                  </Form.Item>
                </Col>
                <Col span={18}>
                  <Form.Item name="httpUrl" label="URL" rules={[{ required: true, message: 'URL is required' }]}>
                    <Input placeholder="https://api.example.com/webhook" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="httpBody" label="Request Body (JSON)" extra="Only used for POST/PUT methods">
                <Input.TextArea placeholder='{"key": "value"}' rows={3} style={{ fontFamily: 'monospace' }} />
              </Form.Item>
            </>
          )}

          {actionType === 'email' && (
            <>
              <Form.Item name="emailTo" label="Recipients" rules={[{ required: true, message: 'At least one recipient is required' }]}
                extra="Comma-separated email addresses">
                <Input placeholder="admin@example.com, team@example.com" />
              </Form.Item>
              <Form.Item name="emailSubject" label="Subject" rules={[{ required: true, message: 'Subject is required' }]}>
                <Input placeholder="Daily Report — {{date}}" />
              </Form.Item>
              <Form.Item name="emailBody" label="Email Body (HTML)">
                <Input.TextArea placeholder="<h2>Daily Report</h2><p>Everything is running smoothly.</p>" rows={4} style={{ fontFamily: 'monospace' }} />
              </Form.Item>
            </>
          )}

          {actionType === 'cleanup' && (
            <Row gutter={16}>
              <Col span={14}>
                <Form.Item name="cleanupTarget" label="What to Clean" rules={[{ required: true }]} initialValue="activityLogs">
                  <Select options={[
                    { label: 'Activity Logs', value: 'activityLogs' },
                    { label: 'Notifications', value: 'notifications' },
                    { label: 'Unverified Users', value: 'unverifiedUsers' },
                    { label: 'Expired Sessions/Tokens', value: 'expiredSessions' },
                    { label: 'Failed Job Errors', value: 'failedJobs' },
                  ]} />
                </Form.Item>
              </Col>
              <Col span={10}>
                <Form.Item name="cleanupOlderThanDays" label="Older Than (days)" initialValue={30}>
                  <InputNumber min={1} max={365} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          )}

          {actionType === 'notification' && (
            <>
              <Form.Item name="notificationTitle" label="Notification Title" rules={[{ required: true, message: 'Title is required' }]}>
                <Input placeholder="System Health Check" />
              </Form.Item>
              <Form.Item name="notificationMessage" label="Notification Message">
                <Input.TextArea placeholder="All systems are running normally." rows={2} />
              </Form.Item>
              <Form.Item name="notificationType" label="Notification Type" initialValue="system_alert">
                <Select options={[
                  { label: 'System Alert', value: 'system_alert' },
                  { label: 'New Feature', value: 'new_feature' },
                  { label: 'Admin Message', value: 'admin_message' },
                ]} />
              </Form.Item>
            </>
          )}

          {actionType === 'backup' && (
            <>
              <Form.Item name="backupCollections" label="Collections to Backup"
                extra="Leave empty to backup users, analyses, and activity logs by default">
                <Select mode="tags" placeholder="Type collection name and press Enter"
                  options={[
                    { label: 'users', value: 'users' },
                    { label: 'analyses', value: 'analyses' },
                    { label: 'activitylogs', value: 'activitylogs' },
                    { label: 'notifications', value: 'notifications' },
                    { label: 'cronjobs', value: 'cronjobs' },
                    { label: 'customroles', value: 'customroles' },
                    { label: 'adminsettings', value: 'adminsettings' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="backupOutputDir" label="Output Directory" initialValue="backups">
                <Input placeholder="backups" />
              </Form.Item>
            </>
          )}

          {actionType === 'log' && (
            <Form.Item name="logMessage" label="Log Message">
              <Input.TextArea placeholder="Custom job executed successfully" rows={2} />
            </Form.Item>
          )}

          <Form.Item name="enabled" label="Enabled" valuePropName="checked">
            <Switch checkedChildren="Active" unCheckedChildren="Disabled" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default JobsPage;
