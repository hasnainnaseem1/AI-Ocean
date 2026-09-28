import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Dropdown, Typography, theme } from 'antd';
import {
  UserOutlined, TeamOutlined, CheckOutlined, SwapOutlined, PlusOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useTeam } from '../context/TeamContext';
import { useSite } from '../context/SiteContext';

const { Text } = Typography;

/**
 * Switch between the personal account and the teams the customer belongs to.
 *
 * Renders nothing for someone who belongs to no team: an individual customer
 * sees exactly the app they always had. The personal account is always
 * listed first and labelled "Personal" — it is the customer's own, and is
 * never shown as a "team".
 */
const TeamSwitcher = ({ collapsed = false }) => {
  const { t } = useTranslation('teams');
  const navigate = useNavigate();
  const { token: tok } = theme.useToken();
  const { siteConfig } = useSite();
  const {
    teams, activeTeam, hasTeams, switchTeam, role,
  } = useTeam();

  if (!hasTeams) return null;

  const labelOf = (team) => (team.kind === 'personal' ? t('switcher.personal') : team.name);
  const iconOf = (team) => (team.kind === 'personal' ? <UserOutlined /> : <TeamOutlined />);

  const items = [
    ...teams.map((team) => ({
      key: team.id,
      icon: iconOf(team),
      label: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minWidth: 200 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelOf(team)}</div>
            <div style={{ fontSize: 11.5, color: tok.colorTextSecondary }}>
              {team.kind === 'personal' ? t('switcher.personalHint') : t(`roles.${team.role}`)}
            </div>
          </div>
          {activeTeam?.id === team.id && <CheckOutlined style={{ color: tok.colorPrimary }} />}
        </div>
      ),
      onClick: () => {
        if (activeTeam?.id === team.id) return;
        switchTeam(team.kind === 'personal' ? null : team.id);
        navigate('/dashboard');
      },
    })),
    ...(siteConfig?.teams?.enabled ? [
      { type: 'divider' },
      { key: 'create', icon: <PlusOutlined />, label: t('menu.createOrganization'), onClick: () => navigate('/onboarding/team') },
    ] : []),
  ];

  const current = activeTeam || teams[0];

  return (
    <Dropdown menu={{ items }} trigger={['click']} placement="bottomLeft">
      <button
        type="button"
        aria-label={t('switcher.switch')}
        style={{
          width: collapsed ? 40 : 'calc(100% - 24px)', margin: collapsed ? '0 auto 10px' : '0 12px 12px',
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          padding: collapsed ? 8 : '8px 10px', borderRadius: 10,
          border: `1px solid ${tok.colorBorderSecondary}`, background: tok.colorBgContainer,
          color: tok.colorText, font: 'inherit', textAlign: 'start',
        }}
      >
        <span style={{
          width: 26, height: 26, borderRadius: 7, flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: tok.colorPrimaryBg, color: tok.colorPrimary,
        }}
        >
          {current ? iconOf(current) : <UserOutlined />}
        </span>
        {!collapsed && (
          <>
            <span style={{ flex: 1, minWidth: 0 }}>
              <Text strong ellipsis style={{ display: 'block', fontSize: 13 }}>{current ? labelOf(current) : ''}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {current?.kind === 'personal' ? t('switcher.personalHint') : t(`roles.${role}`)}
              </Text>
            </span>
            <SwapOutlined style={{ color: tok.colorTextTertiary }} />
          </>
        )}
      </button>
    </Dropdown>
  );
};

export default TeamSwitcher;
