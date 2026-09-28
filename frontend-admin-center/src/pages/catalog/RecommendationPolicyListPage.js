import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Space, message, Tag, Popconfirm, Tooltip, Typography, Alert,
} from 'antd';
import {
  ReloadOutlined, CheckCircleOutlined, CopyOutlined, DeleteOutlined,
  EditOutlined, QuestionCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import { usePermission } from '../../hooks/usePermission';
import { recommendationPolicyApi } from '../../api/catalogApi';
import { PERMISSIONS } from '../../utils/permissions';
import RecommendationPolicyGuide from './RecommendationPolicyGuide';

const { Text } = Typography;

/**
 * Every recommendation policy the platform can run under, and which one
 * customers are actually getting suggestions from right now.
 *
 * A dedicated list, separate from the editor (RecommendationPolicyFormPage),
 * on purpose — the same split this admin center already uses for models and
 * plans. Editing thirty-odd settings inside the same screen that also lists
 * every policy made it ambiguous which policy a given field belonged to;
 * clicking into one now opens it on its own page with nothing else on screen.
 */
const RecommendationPolicyListPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission(PERMISSIONS.MODELS_EDIT);

  const [loading, setLoading] = useState(false);
  const [policies, setPolicies] = useState([]);
  const [guideOpen, setGuideOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await recommendationPolicyApi.getPolicies();
      setPolicies(list.policies || []);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not load recommendation policies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activate = async (id) => {
    try {
      const r = await recommendationPolicyApi.activate(id);
      message.success(r.message);
      await load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not activate');
    }
  };

  /** Creates the copy, then jumps straight into editing it — nothing to hunt for. */
  const duplicate = async (id) => {
    try {
      const r = await recommendationPolicyApi.duplicate(id);
      message.success('Copy created — opening it for editing');
      navigate(`/recommendation-policy/${r.policy.id}/edit`);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not duplicate');
    }
  };

  const remove = async (id) => {
    try {
      await recommendationPolicyApi.deletePolicy(id);
      message.success('Policy deleted');
      await load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not delete');
    }
  };

  return (
    <>
      <PageHeader
        title="Recommendation Policy"
        subtitle="How the deployment journey decides what to suggest — and every sentence it shows a customer."
        count={policies.length}
        extra={
          <Space>
            <Button icon={<QuestionCircleOutlined />} onClick={() => setGuideOpen(true)}>
              How this works
            </Button>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Reload</Button>
          </Space>
        }
      />

      <Alert
        type="info" showIcon style={{ marginBottom: 16 }}
        message="New here? Read “How this works” first — it explains the whole flow in a couple of minutes."
        description={
          'Exactly one policy is live at a time, badged below. Click a policy\'s name to open its '
          + 'own editor — every setting there explains itself, and nothing is applied to customers '
          + 'until you press Save on that policy specifically.'
        }
        action={<Button size="small" onClick={() => setGuideOpen(true)}>Open guide</Button>}
      />

      <DataTable
        title="Policies"
        count={policies.length}
        onRefresh={load}
        refreshLoading={loading}
        empty={{ title: 'No policy saved', description: 'The engine is running on built-in defaults.' }}
        rowKey="id"
        loading={loading}
        pagination={false}
        dataSource={policies}
        columns={[
            {
              title: 'Name',
              dataIndex: 'name',
              render: (name, row) => (
                <Space size={8}>
                  <Button
                    type="link" style={{ padding: 0, height: 'auto', fontWeight: 600 }}
                    onClick={() => navigate(`/recommendation-policy/${row.id}/edit`)}
                  >
                    {name}
                  </Button>
                  {row.isActive && <Tag color="green" icon={<CheckCircleOutlined />}>Live — customers use this</Tag>}
                </Space>
              ),
            },
            { title: 'Key', dataIndex: 'key', width: 200, render: (k) => <Text code>{k}</Text> },
            {
              title: 'Actions',
              key: 'actions',
              width: 295,
              align: 'right',
              render: (_, row) => (
                <Space>
                  <Button
                    size="small" icon={<EditOutlined />}
                    onClick={() => navigate(`/recommendation-policy/${row.id}/edit`)}
                  >
                    Open editor
                  </Button>
                  {canEdit && !row.isActive && (
                    <Popconfirm
                      title="Make this the live policy?"
                      description="New deployment journeys will start using it straight away."
                      onConfirm={() => activate(row.id)}
                    >
                      <Button size="small">Make live</Button>
                    </Popconfirm>
                  )}
                  {canEdit && (
                    <Tooltip title="Creates an exact copy, switched off, that you can edit freely without affecting any customer">
                      <Button size="small" icon={<CopyOutlined />} onClick={() => duplicate(row.id)}>
                        Duplicate
                      </Button>
                    </Tooltip>
                  )}
                  {canEdit && !row.isActive && (
                    <Popconfirm title="Delete this policy?" onConfirm={() => remove(row.id)}>
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
        ]}
      />

      <RecommendationPolicyGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </>
  );
};

export default RecommendationPolicyListPage;
