import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Space, message,
  Modal, Form, InputNumber,
} from 'antd';
import {
  DownloadOutlined, DeleteOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import StatusTag from '../../components/common/StatusTag';
import DateTimeRangePicker from '../../components/common/DateTimeRangePicker';
import PermissionGuard from '../../components/guards/PermissionGuard';
import DataTable from '../../components/common/DataTable';
import { StatRow, StatCard } from '../../components/StatRow';
import logsApi from '../../api/logsApi';
import { PERMISSIONS } from '../../utils/permissions';
import { DEFAULT_PAGE_SIZE, ACTION_TYPES } from '../../utils/constants';
import { formatDateTime, downloadBlob } from '../../utils/helpers';
import dayjs from 'dayjs';
import { useTheme } from '../../contexts/ThemeContext';
import { STATUS_COLORS, muted } from '../../theme/colors';

const LogsListPage = () => {
  const { isDark } = useTheme();
  const error = STATUS_COLORS.error[isDark ? 'dark' : 'light'];
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 50, total: 0 });
  const [stats, setStats] = useState({});
  const [filters, setFilters] = useState({ search: '', actionType: [], status: [], dateRange: null });
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteForm] = Form.useForm();
  const [deleteByDateModalOpen, setDeleteByDateModalOpen] = useState(false);
  const [deleteByDateLoading, setDeleteByDateLoading] = useState(false);
  const [deleteByDateForm] = Form.useForm();
  const [userOptions, setUserOptions] = useState([]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page: pagination.current,
        limit: pagination.pageSize,
        search: filters.search,
      };
      
      if (filters.actionType.length > 0) params.actionType = filters.actionType.join(',');
      if (filters.status.length > 0) params.status = filters.status.join(',');
      
      if (filters.dateRange && filters.dateRange.length === 2) {
        params.startDate = filters.dateRange[0].toISOString();
        params.endDate = filters.dateRange[1].toISOString();
      }

      const data = await logsApi.getLogs(params);
      setLogs(data.logs || []);
      setPagination((prev) => ({ ...prev, total: data.pagination?.totalItems || 0 }));
      setStats(data.stats || {});
    } catch {
      message.error('Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [pagination.current, pagination.pageSize, filters]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleTableChange = (pag) => {
    setPagination((prev) => ({ ...prev, current: pag.current, pageSize: pag.pageSize }));
  };

  const handleSearch = (e) => {
    const value = e.target.value;
    setFilters((prev) => ({ ...prev, search: value }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleClearFilters = () => {
    setFilters({ search: '', actionType: [], status: [], dateRange: null });
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleExport = async () => {
    try {
      const params = {
        search: filters.search,
      };
      
      if (filters.actionType.length > 0) params.actionType = filters.actionType.join(',');
      if (filters.status.length > 0) params.status = filters.status.join(',');
      
      if (filters.dateRange && filters.dateRange.length === 2) {
        params.startDate = filters.dateRange[0].toISOString();
        params.endDate = filters.dateRange[1].toISOString();
      }

      const blob = await logsApi.exportCSV(params);
      downloadBlob(blob, `activity_logs_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.csv`);
      message.success('CSV exported');
    } catch {
      message.error('Export failed');
    }
  };

  const handleDeleteOld = async (values) => {
    setDeleteLoading(true);
    try {
      const data = await logsApi.deleteOldLogs(values.days);
      message.success(data.message || `Deleted ${data.deletedCount} old logs`);
      setDeleteModalOpen(false);
      deleteForm.resetFields();
      fetchLogs();
    } catch (err) {
      message.error(err.response?.data?.message || 'Delete failed');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDeleteByDateRange = async (values) => {
    setDeleteByDateLoading(true);
    try {
      if (!values.dateRange || values.dateRange.length !== 2) {
        message.error('Please select a date range');
        setDeleteByDateLoading(false);
        return;
      }

      const params = {
        startDate: values.dateRange[0].toISOString(),
        endDate: values.dateRange[1].toISOString(),
      };

      const data = await logsApi.deleteLogsByDateRange(params);
      message.success(data.message || `Deleted ${data.deletedCount} logs`);
      setDeleteByDateModalOpen(false);
      deleteByDateForm.resetFields();
      fetchLogs();
    } catch (err) {
      message.error(err.response?.data?.message || 'Delete failed');
    } finally {
      setDeleteByDateLoading(false);
    }
  };

  const columns = [
    {
      title: 'Time',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 154,
      render: (date) => formatDateTime(date),
      sorter: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    },
    { title: 'User', dataIndex: 'userName', key: 'userName', width: 150, ellipsis: true },
    { title: 'Action', dataIndex: 'action', key: 'action', width: 140, ellipsis: true },
    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: 'Target', dataIndex: 'targetName', key: 'targetName', width: 120, ellipsis: true },
    { title: 'IP', dataIndex: 'ipAddress', key: 'ipAddress', width: 130 },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 104,
      render: (status) => <StatusTag status={status} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Activity Logs"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Activity Logs' }]}
        extra={
          <Space>
            <PermissionGuard permission={PERMISSIONS.LOGS_EXPORT}>
              <Button icon={<DownloadOutlined />} onClick={handleExport}>Export CSV</Button>
            </PermissionGuard>
            <PermissionGuard permission={PERMISSIONS.LOGS_DELETE}>
              <Button icon={<DeleteOutlined />} danger onClick={() => setDeleteModalOpen(true)}>
                Delete Old
              </Button>
            </PermissionGuard>
            <PermissionGuard permission={PERMISSIONS.LOGS_DELETE}>
              <Button icon={<DeleteOutlined />} danger onClick={() => setDeleteByDateModalOpen(true)}>
                Delete by Date
              </Button>
            </PermissionGuard>
          </Space>
        }
      />

      <StatRow>
        <StatCard count={4} tone="blue" label="Total" value={stats.totalLogs || 0} />
        <StatCard count={4} tone="green" label="Success" value={stats.successLogs || 0} />
        <StatCard count={4} tone="pink" label="Failed" value={stats.failedLogs || 0} />
        <StatCard count={4} tone="amber" label="Warnings" value={stats.warningLogs || 0} />
      </StatRow>

      <DataTable
        title="Logs"
        count={pagination.total}
        search={{ value: filters.search, onChange: handleSearch, placeholder: 'Search by user, action, or description' }}
        filters={[
          { key: 'actionType', placeholder: 'Action Type', mode: 'multiple', options: ACTION_TYPES.map((t) => ({ value: t, label: t.toUpperCase() })) },
          {
            key: 'status', placeholder: 'Status', mode: 'multiple',
            options: [
              { value: 'success', label: 'Success' },
              { value: 'failed', label: 'Failed' },
              { value: 'warning', label: 'Warning' },
            ],
          },
        ]}
        filterValues={filters}
        onFilterChange={(key, v) => { setFilters((p) => ({ ...p, [key]: v || [] })); setPagination((p) => ({ ...p, current: 1 })); }}
        onClearFilters={handleClearFilters}
        onRefresh={fetchLogs}
        refreshLoading={loading}
        toolbarExtra={
          <DateTimeRangePicker
            value={filters.dateRange}
            onChange={(dates) => {
              setFilters((p) => ({ ...p, dateRange: dates }));
              setPagination((p) => ({ ...p, current: 1 }));
            }}
            use24HourFormat={false}
            style={{ width: 280 }}
          />
        }
        empty={{ title: 'No logs found', description: 'Try adjusting your search or filters.' }}
        dataSource={logs}
        columns={columns}
        loading={loading}
        rowKey={(r) => r.id}
        pagination={{
          current: pagination.current, pageSize: pagination.pageSize, total: pagination.total,
          showSizeChanger: true, showTotal: (total) => `Total ${total} logs`,
        }}
        onChange={handleTableChange}
        scroll={{ x: 740 }}
        size="small"
      />

      {/* Delete Old Logs Modal */}
      <Modal
        title="Delete Old Logs"
        open={deleteModalOpen}
        onCancel={() => { setDeleteModalOpen(false); deleteForm.resetFields(); }}
        onOk={() => deleteForm.submit()}
        confirmLoading={deleteLoading}
      >
        <Form form={deleteForm} layout="vertical" onFinish={handleDeleteOld} initialValues={{ days: 90 }}>
          <Form.Item name="days" label="Delete logs older than (days)" rules={[{ required: true }, { type: 'number', min: 30, message: 'Minimum 30 days' }]}>
            <InputNumber min={30} style={{ width: '100%' }} />
          </Form.Item>
          <p style={{ color: muted(isDark), fontSize: 12 }}>This action cannot be undone.</p>
        </Form>
      </Modal>

      {/* Delete by Date Range Modal */}
      <Modal
        title="Delete Logs by Date Range"
        open={deleteByDateModalOpen}
        onCancel={() => { setDeleteByDateModalOpen(false); deleteByDateForm.resetFields(); }}
        onOk={() => deleteByDateForm.submit()}
        confirmLoading={deleteByDateLoading}
      >
        <Form form={deleteByDateForm} layout="vertical" onFinish={handleDeleteByDateRange}>
          <Form.Item 
            name="dateRange" 
            label="Select Date Range" 
            rules={[{ required: true, message: 'Please select a date range' }]}
          >
            <DateTimeRangePicker
              use24HourFormat={false}
              placeholder={['Start Date & Time', 'End Date & Time']}
            />
          </Form.Item>
          <p style={{ color: error, fontSize: 12 }}>
            ⚠️ All logs within the selected date range will be permanently deleted. This action cannot be undone.
          </p>
        </Form>
      </Modal>
    </div>
  );
};

export default LogsListPage;
