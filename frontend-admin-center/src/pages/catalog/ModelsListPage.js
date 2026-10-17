import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Space, message, Tag, Typography, Select,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  CheckCircleOutlined, StopOutlined, ApartmentOutlined,
  StarFilled, CloudServerOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import DataTable, { rowActions } from '../../components/common/DataTable';
import { StatRow, StatCard } from '../../components/StatRow';
import { usePermission } from '../../hooks/usePermission';
import { modelsApi } from '../../api/catalogApi';
import settingsApi from '../../api/settingsApi';
import { PERMISSIONS } from '../../utils/permissions';
import { useTheme } from '../../contexts/ThemeContext';
import { STATUS_COLORS as THEME_STATUS_COLORS } from '../../theme/colors';

const { Text } = Typography;

const STATUS_COLORS = {
  available: 'green',
  beta: 'gold',
  coming_soon: 'blue',
  deprecated: 'default',
};

const ModelsListPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const { isDark } = useTheme();
  const warning = THEME_STATUS_COLORS.warning[isDark ? 'dark' : 'light'];

  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState([]);
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState();
  const [status, setStatus] = useState();

  const canEdit = hasPermission(PERMISSIONS.MODELS_EDIT);
  const canCreate = hasPermission(PERMISSIONS.MODELS_CREATE);
  const canDelete = hasPermission(PERMISSIONS.MODELS_DELETE);
  const canManage = canEdit;

  /*
   * Which clouds are switched on, and which one unassigned models use.
   *
   * Read from settings rather than hardcoded, because the per-model cloud
   * column only makes sense when there is more than one cloud to choose
   * between — and the "Default" option has to name the cloud it actually
   * resolves to, or it tells an admin nothing.
   */
  const [enabledClouds, setEnabledClouds] = useState([]);
  const [defaultCloud, setDefaultCloud] = useState('');
  const [savingCloud, setSavingCloud] = useState(null);

  useEffect(() => {
    settingsApi.getSettings().then((data) => {
      const st = data?.settings || {};
      setEnabledClouds([
        ...(st.gcpSettings?.enabled ? [{ value: 'gcp', label: 'Google Cloud' }] : []),
        ...(st.awsSettings?.enabled ? [{ value: 'aws', label: 'AWS' }] : []),
      ]);
      setDefaultCloud(st.cloudRoutingSettings?.defaultCloud || '');
    }).catch(() => { /* the column simply does not render */ });
  }, []);

  const defaultCloudLabel = defaultCloud
    ? (defaultCloud === 'aws' ? 'AWS' : 'Google Cloud')
    : 'none set';

  /**
   * Assign a model to a cloud.
   *
   * The message afterwards says what did NOT move, because that is the part
   * people get wrong: changing this decides where the next deployment goes,
   * and every machine already running stays exactly where it was built.
   */
  const setModelCloud = async (row, value) => {
    setSavingCloud(row.id);
    try {
      const data = await modelsApi.setCloud(row.id, value);
      const already = Object.entries(data.existingDeployments || {})
        .filter(([, n]) => n > 0)
        .map(([cloud, n]) => `${n} on ${cloud === 'manual' ? 'the manual queue' : cloud.toUpperCase()}`);

      message.success(
        already.length
          ? `${data.message} ${already.join(', ')} stay where they are.`
          : data.message
      );
      setModels((prev) => prev.map((m) => (m.id === row.id ? { ...m, cloudProvider: value || null } : m)));
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not set the cloud for this model');
    } finally {
      setSavingCloud(null);
    }
  };

  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (family) params.family = family;
      if (status) params.status = status;
      const data = await modelsApi.getModels(params);
      setModels(data.models || []);
    } catch {
      message.error('Failed to load models');
    } finally {
      setLoading(false);
    }
  }, [search, family, status]);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  const toggle = async (model) => {
    try {
      await modelsApi.toggleModel(model.id);
      message.success(`${model.name} ${model.isActive ? 'disabled' : 'enabled'}`);
      fetchModels();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not toggle the model');
    }
  };

  const remove = async (model) => {
    try {
      await modelsApi.deleteModel(model.id);
      message.success('Model deleted');
      fetchModels();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not delete the model');
    }
  };

  const activeCount = models.filter((m) => m.isActive).length;
  const totalDeployments = models.reduce((s, m) => s + (m.deploymentCount || 0), 0);
  const families = [...new Set(models.map((m) => m.family))].sort();

  const handleFilterChange = (key, value) => {
    if (key === 'family') setFamily(value);
    else if (key === 'status') setStatus(value);
  };

  const handleClearFilters = () => {
    setSearch('');
    setFamily(undefined);
    setStatus(undefined);
  };

  const columns = [
    {
      title: 'Model',
      dataIndex: 'name',
      render: (name, row) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            <Text strong>{name}</Text>
            {row.isFeatured && <StarFilled style={{ color: warning }} />}
            {!row.isActive && <Tag>Disabled</Tag>}
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.parameterSize}
            {row.contextLength ? ` · ${(row.contextLength / 1000).toFixed(0)}K context` : ''}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Family',
      dataIndex: 'family',
      width: 117,
      render: (f) => <Tag>{f}</Tag>,
    },
    {
      title: 'Capabilities',
      dataIndex: 'modalities',
      width: 165,
      render: (mods) => (
        <Space size={4} wrap>
          {(mods || []).map((m) => <Tag key={m} style={{ marginInlineEnd: 0 }}>{m}</Tag>)}
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 100,
      render: (s) => <Tag color={STATUS_COLORS[s] || 'default'}>{s.replace('_', ' ')}</Tag>,
    },
    {
      title: 'Tiers',
      key: 'tiers',
      width: 75,
      align: 'right',
      render: (_, row) => (
        <Text type={row.supportedTiers?.length ? undefined : 'danger'}>
          {row.supportedTiers?.length || 0}
        </Text>
      ),
    },
    /*
      * Which cloud this model's machines are built on.
      *
      * Shown only when more than one cloud is switched on — with a single
      * cloud there is nothing to choose, and a dropdown with one option is
      * noise that implies a decision nobody has to make.
      *
      * Changing it decides where the NEXT deployment goes. Everything already
      * running keeps the cloud frozen onto it, which the confirmation says
      * out loud because it is the opposite of what people expect.
      */
    ...(enabledClouds.length > 1 ? [{
      title: 'Cloud',
      dataIndex: 'cloudProvider',
      // Wide enough for "Default (Google Cloud)" to read in full — the whole
      // value of the label is naming which cloud "default" resolves to, and a
      // truncated one says less than no label at all.
      width: 230,
      render: (value, row) => (
        <Select
          size="small"
          style={{ width: 210 }}
          value={value || ''}
          loading={savingCloud === row.id}
          disabled={!canManage || savingCloud === row.id}
          onChange={(v) => setModelCloud(row, v)}
          options={[
            { value: '', label: `Default (${defaultCloudLabel})` },
            ...enabledClouds,
          ]}
        />
      ),
    }] : []),
    {
      title: 'Deployments',
      dataIndex: 'deploymentCount',
      // 100px left the sorter's up/down carets touching the title with almost
      // no gap — this column is the only one that pairs a `sorter` with a
      // narrow width, so it's the only one that needed the extra room.
      width: 132,
      align: 'right',
      sorter: (a, b) => (a.deploymentCount || 0) - (b.deploymentCount || 0),
      render: (n) => <Text type="secondary">{n || 0}</Text>,
    },
    rowActions([
      {
        key: 'edit', icon: <EditOutlined />, label: 'Edit',
        visible: () => canEdit, onClick: (r) => navigate(`/models/${r.id}/edit`),
      },
      {
        key: 'disable', icon: <StopOutlined />, label: 'Disable',
        visible: (r) => canEdit && r.isActive, onClick: toggle,
      },
      {
        key: 'enable', icon: <CheckCircleOutlined />, label: 'Enable',
        visible: (r) => canEdit && !r.isActive, onClick: toggle,
      },
      {
        key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true,
        visible: () => canDelete,
        confirm: { title: 'Delete this model?', description: "Models with active deployments can't be deleted — disable them instead." },
        onClick: remove,
      },
    ], { maxVisible: 3 }),
  ];

  return (
    <div>
      <PageHeader
        title="AI Models"
        subtitle="The catalogue customers can deploy from"
        count={models.length}
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'AI Infrastructure' }, { label: 'Models' }]}
        extra={
          canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/models/new')}>
              New model
            </Button>
          )
        }
      />

      <StatRow>
        <StatCard count={3} tone="blue" icon={<ApartmentOutlined />} label="Active Models" value={activeCount} suffix={`/ ${models.length}`} />
        <StatCard count={3} tone="green" icon={<CloudServerOutlined />} label="Total Deployments" value={totalDeployments} />
        <StatCard count={3} tone="purple" icon={<ApartmentOutlined />} label="Model Families" value={families.length} />
      </StatRow>

      <DataTable
        title="Models"
        count={models.length}
        search={{ value: search, onChange: (e) => setSearch(e.target.value), placeholder: 'Search models…' }}
        filters={[
          { key: 'family', placeholder: 'Any family', options: families.map((f) => ({ value: f, label: f })) },
          { key: 'status', placeholder: 'Any status', options: Object.keys(STATUS_COLORS).map((s) => ({ value: s, label: s.replace('_', ' ') })) },
        ]}
        filterValues={{ family, status }}
        onFilterChange={handleFilterChange}
        onClearFilters={handleClearFilters}
        onRefresh={fetchModels}
        refreshLoading={loading}
        empty={{ title: 'No models found', description: 'Try adjusting your search or filters.' }}
        columns={columns}
        dataSource={models}
        rowKey="id"
        loading={loading}
        pagination={models.length > 20 ? { pageSize: 20 } : false}
        scroll={{ x: 930 }}
      />
    </div>
  );
};

export default ModelsListPage;
