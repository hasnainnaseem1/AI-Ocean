import React, { useEffect, useState } from 'react';
import {
  Card, Table, Tag, Typography, Button, Space,
} from 'antd';
import { ApartmentOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import teamsApi from '../../api/teamsApi';
import { formatDateTime } from '../../utils/helpers';

const { Text } = Typography;

const ROLE_COLORS = {
  owner: 'gold', admin: 'blue', billing: 'purple', developer: 'cyan', viewer: 'default',
};

/**
 * The organizations this customer belongs to.
 *
 * Worth having on the customer page because their work is not necessarily
 * billed to them: a Developer in somebody else's organization spends that
 * organization's money, so an operator looking at usage or a support ticket
 * needs to know which other account it landed on.
 *
 * Their personal account is deliberately left out — that is this page.
 */
const CustomerTeamsCard = ({ customerId, style }) => {
  const navigate = useNavigate();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    teamsApi.getCustomerTeams(customerId)
      .then((data) => { if (live) setTeams(data.teams || []); })
      .catch(() => { /* the rest of the page still works */ })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [customerId]);

  if (!loading && !teams.length) return null;

  return (
    <Card title={<Space><ApartmentOutlined />Organizations</Space>} style={style}>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        pagination={false}
        dataSource={teams}
        columns={[
          {
            title: 'Organization',
            dataIndex: 'name',
            key: 'name',
            render: (name, r) => (
              <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/teams/${r.id}`)}>
                {name}
              </Button>
            ),
          },
          {
            title: 'Role',
            dataIndex: 'role',
            key: 'role',
            width: 120,
            render: (r) => <Tag color={ROLE_COLORS[r]}>{r}</Tag>,
          },
          {
            title: 'Created',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 170,
            render: (d) => <Text type="secondary">{formatDateTime(d)}</Text>,
          },
        ]}
      />
    </Card>
  );
};

export default CustomerTeamsCard;
