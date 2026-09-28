import React from 'react';
import { Typography, Breadcrumb, Space, Flex, Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { ADMIN_DENSITY, brandSoft, getBrand, monoNumeric, muted } from '../../theme/colors';

const { Title, Text } = Typography;

/**
 * The heading every page opens with.
 *
 * Used by 32 of the app's 43 pages, which makes it the cheapest place to
 * change how the whole product reads — so the existing `{title, breadcrumbs,
 * extra}` contract is preserved exactly and the new props are all optional.
 * No call site needed editing for this to take effect.
 *
 * Two deliberate differences from the customer center's equivalent:
 *   • Breadcrumbs stay. The customer center has flat navigation and no use for
 *     them; this app has real hierarchy (Website → Blog Posts → Edit).
 *   • The title is 24px rather than 30px, per the admin center's tighter
 *     density — see ADMIN_DENSITY.
 *
 * @param title        the page name
 * @param breadcrumbs  [{ label, path? }] — trailing entry is the current page
 * @param extra        right-hand actions; put `className="btn-gradient"` on the
 *                     one primary action, if the page has one
 * @param subtitle     one line saying what the page is for
 * @param count        an optional record count shown as a chip beside the title
 * @param backTo       renders a back link above the title (detail/form pages)
 */
const PageHeader = ({ title, breadcrumbs = [], extra, subtitle, count, backTo }) => {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const mutedColor = muted(isDark);

  return (
    <div style={{ marginBottom: 14 }}>
      {backTo && (
        <Button
          className="no-print"
          type="text"
          size="small"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(typeof backTo === 'string' ? backTo : -1)}
          style={{ marginBottom: 6, paddingLeft: 0, color: mutedColor }}
        >
          {typeof backTo === 'string' ? 'Back' : 'Back'}
        </Button>
      )}

      {breadcrumbs.length > 0 && (
        <Breadcrumb
          style={{ marginBottom: 4, fontSize: 12 }}
          items={breadcrumbs.map((b) => ({
            title: b.path ? <Link to={b.path}>{b.label}</Link> : b.label,
          }))}
        />
      )}

      <Flex justify="space-between" align="flex-start" gap={16} wrap="wrap">
        <div style={{ minWidth: 0 }}>
          <Flex align="center" gap={10}>
            <Title
              level={3}
              style={{ margin: 0, fontSize: ADMIN_DENSITY.pageTitleSize, lineHeight: 1.2 }}
            >
              {title}
            </Title>
            {count != null && (
              <span
                style={{
                  ...monoNumeric,
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '2px 9px',
                  borderRadius: 999,
                  background: brandSoft(isDark),
                  color: getBrand(isDark),
                  lineHeight: 1.6,
                }}
              >
                {typeof count === 'number' ? count.toLocaleString() : count}
              </span>
            )}
          </Flex>
          {subtitle && (
            <Text style={{ display: 'block', marginTop: 3, fontSize: 12.5, color: mutedColor }}>
              {subtitle}
            </Text>
          )}
        </div>
        {extra && <Space wrap className="no-print">{extra}</Space>}
      </Flex>
    </div>
  );
};

export default PageHeader;
