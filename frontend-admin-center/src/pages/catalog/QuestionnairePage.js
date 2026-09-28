import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Space, message, Tag, Modal, Form,
  Input, InputNumber, Switch, Select, Alert, Typography, Row, Col, Divider,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  ArrowUpOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import DataTable, { rowActions } from '../../components/common/DataTable';
import { usePermission } from '../../hooks/usePermission';
import { questionsApi } from '../../api/catalogApi';
import { PERMISSIONS } from '../../utils/permissions';

const { Text, Paragraph } = Typography;

const TYPES = [
  { value: 'select', label: 'Dropdown (one choice)' },
  { value: 'multiselect', label: 'Dropdown (many choices)' },
  { value: 'radio', label: 'Radio buttons' },
  { value: 'boolean', label: 'Yes / No toggle' },
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
];

const NEEDS_OPTIONS = ['select', 'multiselect', 'radio'];

const QuestionnairePage = () => {
  const { hasPermission } = usePermission();
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [type, setType] = useState('select');

  const canEdit = hasPermission(PERMISSIONS.MODELS_EDIT);
  const canCreate = hasPermission(PERMISSIONS.MODELS_CREATE);
  const canDelete = hasPermission(PERMISSIONS.MODELS_DELETE);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await questionsApi.getQuestions();
      setQuestions(data.questions || []);
    } catch {
      message.error('Failed to load questions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setType('select');
    form.setFieldsValue({
      type: 'select', required: false, isActive: true,
      displayOrder: questions.length + 1, options: [],
    });
    setModalOpen(true);
  };

  const openEdit = (q) => {
    setEditing(q);
    setType(q.type);
    form.setFieldsValue({
      ...q,
      // The form edits options as "Label|value" lines — simplest thing that works
      options: (q.options || []).map((o) => `${o.label}|${o.value}`),
      dependsOnKey: q.dependsOn?.questionKey || undefined,
      dependsOnEquals: q.dependsOn?.equals ?? undefined,
    });
    setModalOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      const { options, dependsOnKey, dependsOnEquals, ...rest } = values;

      const payload = {
        ...rest,
        options: NEEDS_OPTIONS.includes(values.type)
          ? (options || []).map((entry) => {
              const [label, value] = String(entry).split('|');
              const finalLabel = (label || '').trim();
              return {
                label: finalLabel,
                // Derive a machine value when the admin didn't supply one
                value: (value || finalLabel).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
              };
            }).filter((o) => o.label)
          : [],
        dependsOn: dependsOnKey
          ? { questionKey: dependsOnKey, equals: dependsOnEquals === 'true' ? true : dependsOnEquals === 'false' ? false : dependsOnEquals }
          : { questionKey: '', equals: null },
      };

      if (editing) {
        await questionsApi.updateQuestion(editing.id, payload);
        message.success('Question updated');
      } else {
        await questionsApi.createQuestion(payload);
        message.success('Question added');
      }

      setModalOpen(false);
      fetch();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err.response?.data?.message || 'Could not save the question');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (q) => {
    try {
      await questionsApi.deleteQuestion(q.id);
      message.success('Question deleted');
      fetch();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not delete the question');
    }
  };

  /** Swap a question with its neighbour and persist the new ordering. */
  const move = async (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;

    const reordered = [...questions];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setQuestions(reordered);

    try {
      await questionsApi.reorder(reordered.map((q, i) => ({ id: q.id, displayOrder: i + 1 })));
    } catch {
      message.error('Could not save the new order');
      fetch();
    }
  };

  const columns = [
    {
      title: '#',
      key: 'order',
      width: 75,
      render: (_, __, index) => (
        <Space size={0}>
          <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={index === 0 || !canEdit} onClick={() => move(index, -1)} />
          <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={index === questions.length - 1 || !canEdit} onClick={() => move(index, 1)} />
        </Space>
      ),
    },
    {
      title: 'Question',
      dataIndex: 'question',
      render: (q, row) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            <Text strong>{q}</Text>
            {row.required && <Tag color="red">Required</Tag>}
            {!row.isActive && <Tag>Hidden</Tag>}
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <code>{row.key}</code>
            {row.helpText ? ` · ${row.helpText}` : ''}
          </Text>
          {row.dependsOn?.questionKey && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Shown only when <code>{row.dependsOn.questionKey}</code> = {String(row.dependsOn.equals)}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      width: 207,
      render: (t) => <Tag>{TYPES.find((x) => x.value === t)?.label || t}</Tag>,
    },
    {
      title: 'Options',
      dataIndex: 'options',
      width: 195,
      render: (opts) =>
        (opts || []).length === 0
          ? <Text type="secondary">—</Text>
          : (
            <Space size={4} wrap>
              {opts.slice(0, 4).map((o) => <Tag key={o.value} style={{ marginInlineEnd: 0 }}>{o.label}</Tag>)}
              {opts.length > 4 && <Text type="secondary">+{opts.length - 4}</Text>}
            </Space>
          ),
    },
    {
      title: 'Scope',
      key: 'scope',
      width: 100,
      render: (_, row) =>
        row.appliesTo?.allModels !== false
          ? <Tag color="blue">All models</Tag>
          : <Tag color="orange">Some models</Tag>,
    },
    rowActions([
      {
        key: 'edit', icon: <EditOutlined />, label: 'Edit',
        visible: () => canEdit, onClick: openEdit,
      },
      {
        key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true,
        visible: () => canDelete,
        confirm: { title: 'Delete this question?', description: 'Answers already recorded on existing deployments are kept.' },
        onClick: remove,
      },
    ], { width: 110 }),
  ];

  return (
    <div>
      <PageHeader
        title="Deployment Questionnaire"
        subtitle="Questions customers answer when requesting a deployment"
        count={questions.length}
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'AI Infrastructure' }, { label: 'Questionnaire' }]}
        extra={
          canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Add question</Button>
        }
      />

      <Alert
        type="info"
        showIcon
        message="These are the questions customers answer when requesting a deployment"
        description="Add, edit and reorder them freely — the deploy wizard renders whatever is here, and the answers show up on the deployment in your fulfillment queue."
        style={{ marginBottom: 20 }}
      />

      <DataTable
        title="Questions"
        count={questions.length}
        onRefresh={fetch}
        refreshLoading={loading}
        empty={{ title: 'No questions yet' }}
        columns={columns}
        dataSource={questions}
        rowKey="id"
        loading={loading}
        pagination={false}
        scroll={{ x: 820 }}
      />

      <Modal
        title={editing ? 'Edit question' : 'Add question'}
        open={modalOpen}
        onOk={save}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={680}
        okText={editing ? 'Save changes' : 'Add question'}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="question"
            label="Question"
            rules={[{ required: true, message: 'The question text is required' }]}
          >
            <Input placeholder="What will you use this model for?" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="key"
                label="Key"
                help={editing ? 'Keys are fixed once answers reference them' : 'Machine name, e.g. use_case'}
                rules={[
                  { required: true, message: 'A key is required' },
                  { pattern: /^[a-z][a-z0-9_]*$/, message: 'Lowercase letters, numbers and underscores only' },
                ]}
              >
                <Input placeholder="use_case" disabled={!!editing} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="type" label="Answer type" rules={[{ required: true }]}>
                <Select options={TYPES} onChange={setType} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="helpText" label="Help text">
            <Input placeholder="Shown under the question to guide the answer" />
          </Form.Item>

          {NEEDS_OPTIONS.includes(type) && (
            <Form.Item
              name="options"
              label="Options"
              help="Type an option and press Enter. Use Label|value to set the stored value explicitly."
              rules={[{ required: true, message: 'Add at least one option' }]}
            >
              <Select mode="tags" placeholder="Chat / assistant" open={false} />
            </Form.Item>
          )}

          {['text', 'textarea', 'number'].includes(type) && (
            <Form.Item name="placeholder" label="Placeholder">
              <Input placeholder="Example answer to show in the empty field" />
            </Form.Item>
          )}

          <Divider />
          <Paragraph type="secondary" style={{ fontSize: 12 }}>
            Optionally show this question only when another one has a specific answer.
          </Paragraph>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="dependsOnKey" label="Depends on question">
                <Select
                  allowClear
                  placeholder="Always show"
                  options={questions
                    .filter((q) => !editing || q.id !== editing.id)
                    .map((q) => ({ value: q.key, label: q.question }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="dependsOnEquals" label="…when its answer is">
                <Input placeholder="true" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="displayOrder" label="Order">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="required" label="Required" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="isActive" label="Active" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
};

export default QuestionnairePage;
