import React from 'react';
import { Tag } from 'antd';
import { STATUS_COLORS } from '../../utils/constants';
import { formatStatus } from '../../utils/helpers';

const StatusTag = ({ status }) => {
  return (
    <Tag color={STATUS_COLORS[status] || 'default'}>
      {formatStatus(status)}
    </Tag>
  );
};

export default StatusTag;
