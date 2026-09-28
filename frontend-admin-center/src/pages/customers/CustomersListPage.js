import React, { useState, useEffect, useCallback } from 'react';
import { message, Tag, Button } from 'antd';
import {
  EyeOutlined, CheckCircleOutlined,
  StopOutlined, DeleteOutlined, MailOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import StatusTag from '../../components/common/StatusTag';
import DataTable, { rowActions } from '../../components/common/DataTable';
import { StatRow, StatCard } from '../../components/StatRow';
import customersApi from '../../api/customersApi';
import { usePermission } from '../../hooks/usePermission';
import { PERMISSIONS } from '../../utils/permissions';
import { DEFAULT_PAGE_SIZE } from '../../utils/constants';
import { formatDateTime } from '../../utils/helpers';

const CustomersListPage = () => {
  const navigate = useNavigate();
  const { isSuperAdmin, hasPermission } = usePermission();
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0 });
  const [stats, setStats] = useState({});
  const [filters, setFilters] = useState({ search: '', status: [] });

  // Selection for bulk actions
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await customersApi.getCustomers({
        page: pagination.current,
        limit: pagination.pageSize,
        search: filters.search,
        status: filters.status.join(','),
      });
      setCustomers(data.customers || []);
      setPagination((prev) => ({ ...prev, total: data.pagination?.totalItems || 0 }));
      setStats(data.stats || {});
    } catch {
      message.error('Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [pagination.current, pagination.pageSize, filters]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const handleTableChange = (pag) => {
    setPagination((prev) => ({ ...prev, current: pag.current, pageSize: pag.pageSize }));
  };

  const handleSearch = (e) => {
    setFilters((prev) => ({ ...prev, search: e.target.value }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value || [] }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleExport = async () => {
    setExportLoading(true);
    try {
      await customersApi.exportCustomers({
        search: filters.search,
        status: filters.status.join(','),
      });
      message.success('Customers exported successfully');
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to export customers');
    } finally {
      setExportLoading(false);
    }
  };

  const handleClearFilters = () => {
    setFilters({ search: '', status: [] });
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleSuspendCustomer = async (customer) => {
    const newStatus = customer.status === 'suspended' ? 'active' : 'suspended';
    try {
      await customersApi.updateStatus(customer.id, newStatus);
      message.success(`Customer ${newStatus === 'suspended' ? 'suspended' : 'activated'} successfully`);
      fetchCustomers();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to update customer status');
    }
  };

  const handleVerifyEmail = async (id) => {
    try {
      await customersApi.verifyEmail(id);
      message.success('Email verified');
      fetchCustomers();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to verify email');
    }
  };

  // --- Delete (super admin only) ---
  const handleDeleteCustomer = async (id) => {
    try {
      await customersApi.deleteCustomer(id);
      message.success('Customer deleted successfully');
      setSelectedRowKeys((prev) => prev.filter((k) => k !== id));
      fetchCustomers();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to delete customer');
    }
  };

  const handleBulkDelete = async (keys) => {
    try {
      const result = await customersApi.bulkDeleteCustomers(keys);
      message.success(result.message || `${result.deletedCount} customer(s) deleted`);
      setSelectedRowKeys([]);
      fetchCustomers();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to delete customers');
    }
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name, record) => (
        <Button type="link" onClick={() => navigate(`/customers/${record.id}`)} style={{ padding: 0 }}>
          {name}
        </Button>
      ),
    },
    { title: 'Email', dataIndex: 'email', key: 'email', ellipsis: true },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 115,
      render: (status) => <StatusTag status={status} />,
    },
    {
      title: 'Email Verified',
      dataIndex: 'isEmailVerified',
      key: 'isEmailVerified',
      width: 105,
      render: (v) => v ? <Tag color="green">Yes</Tag> : <Tag color="red">No</Tag>,
    },
    {
      title: 'Last Login',
      dataIndex: 'lastLogin',
      key: 'lastLogin',
      width: 160,
      render: (date) => formatDateTime(date),
    },
    rowActions([
      {
        key: 'view', icon: <EyeOutlined />, label: 'View',
        onClick: (r) => navigate(`/customers/${r.id}`),
      },
      {
        key: 'suspend', icon: <StopOutlined />, label: 'Suspend', danger: true,
        permission: PERMISSIONS.CUSTOMERS_EDIT, visible: (r) => r.status !== 'suspended',
        confirm: 'Suspend this customer?', onClick: handleSuspendCustomer,
      },
      {
        key: 'activate', icon: <CheckCircleOutlined />, label: 'Activate',
        permission: PERMISSIONS.CUSTOMERS_EDIT, visible: (r) => r.status === 'suspended',
        confirm: 'Activate this customer?', onClick: handleSuspendCustomer,
      },
      {
        key: 'verifyEmail', icon: <MailOutlined />, label: 'Verify Email',
        permission: PERMISSIONS.CUSTOMERS_VERIFY, visible: (r) => !r.isEmailVerified,
        confirm: 'Manually verify this email?', onClick: (r) => handleVerifyEmail(r.id),
      },
      {
        key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true,
        visible: () => isSuperAdmin,
        confirm: { title: 'Permanently delete this customer?' }, onClick: (r) => handleDeleteCustomer(r.id),
      },
    ], { maxVisible: 3 }),
  ];

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Every customer account on the platform"
        count={pagination.total}
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Customers' }]}
      />

      <StatRow>
        <StatCard count={4} tone="blue" icon={<TeamOutlined />} label="Total" value={stats.totalCustomers || 0} />
        <StatCard count={4} tone="green" icon={<CheckCircleOutlined />} label="Active" value={stats.activeCustomers || 0} />
      </StatRow>

      <DataTable
        title="Customers"
        count={pagination.total}
        search={{ value: filters.search, onChange: handleSearch, placeholder: 'Search by name or email' }}
        filters={[
          {
            key: 'status', placeholder: 'Status', mode: 'multiple',
            options: [
              { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' },
              { value: 'pending_verification', label: 'Pending' },
            ],
          },
        ]}
        filterValues={filters}
        onFilterChange={handleFilterChange}
        onClearFilters={handleClearFilters}
        onRefresh={fetchCustomers}
        refreshLoading={loading}
        onExport={hasPermission(PERMISSIONS.CUSTOMERS_VIEW) ? handleExport : undefined}
        exportLoading={exportLoading}
        selection={isSuperAdmin ? {
          enabled: true,
          selectedRowKeys,
          onChange: setSelectedRowKeys,
          actions: [{
            key: 'delete', label: 'Delete Selected', danger: true, icon: <DeleteOutlined />,
            confirm: { title: `Permanently delete ${selectedRowKeys.length} customer(s)?` },
            onClick: handleBulkDelete,
          }],
        } : undefined}
        empty={{ title: 'No customers found', description: 'Try adjusting your search or filters.' }}
        columns={columns}
        dataSource={customers}
        loading={loading}
        rowKey={(r) => r.id}
        pagination={{
          current: pagination.current, pageSize: pagination.pageSize, total: pagination.total,
          showSizeChanger: true, showTotal: (total) => `Total ${total} customers`,
        }}
        onChange={handleTableChange}
        scroll={{ x: 740 }}
        size="middle"
      />
    </div>
  );
};

export default CustomersListPage;
