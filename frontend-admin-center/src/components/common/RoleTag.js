import React from 'react';
import { Tag } from 'antd';
import { formatStatus } from '../../utils/helpers';

const ROLE_COLORS = {
  super_admin: 'red',
  admin: 'volcano',
  moderator: 'blue',
  viewer: 'green',
  custom: 'purple',
  customer: 'cyan',
};

const RoleTag = ({ role }) => {
  return (
    <Tag color={ROLE_COLORS[role] || 'default'}>
      {formatStatus(role)}
    </Tag>
  );
};

export default RoleTag;
