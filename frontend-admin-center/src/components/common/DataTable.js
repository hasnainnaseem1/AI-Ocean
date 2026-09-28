import React from 'react';
import {
  Table, Input, Select, Button, Space, Alert, Empty, Popconfirm, Tooltip, Dropdown, Typography,
} from 'antd';
import {
  SearchOutlined, ClearOutlined, DownloadOutlined, ReloadOutlined, MoreOutlined,
} from '@ant-design/icons';
import { useTheme } from '../../contexts/ThemeContext';
import { usePermission } from '../../hooks/usePermission';
import { adminCardStyle, hairline, muted, STATUS_COLORS } from '../../theme/colors';
import { TableRowsSkeleton } from '../Skeletons';

const { Text } = Typography;

/**
 * The table shape every list page in this app was hand-rolling: a card, an
 * optional search-and-filter toolbar, an optional bulk-action bar, and an
 * antd `<Table>` with the ledger styling and a skeleton for its first load.
 * 27 pages had their own copy of this scaffolding — one of them (Customers)
 * had drifted enough to ship a column bound to a field the API never sends.
 *
 * DataTable is a STRICT SUPERSET of antd's `<Table>`: every prop it does not
 * recognise itself (`columns`, `dataSource`, `rowKey`, `pagination`, `onChange`,
 * `scroll`, `size`, an explicit `rowSelection`…) is spread straight onto the
 * inner `<Table>`. That is what makes migration incremental rather than a
 * rewrite — a page can start by only swapping the import and the tag (get the
 * card, the skeleton and the empty state for free), then adopt `search` /
 * `filters` next, then `selection` and `rowActions()` last. A page that never
 * migrates at all is not "half done"; it simply keeps its own `<Table>` and
 * still inherits the global ledger styling from index.css.
 */
const DataTable = ({
  // card chrome
  title,
  count,

  // search
  search, // { value, onChange, placeholder }

  // filter bar — controlled from the caller's own filters state object
  filters, // [{ key, placeholder, options, mode, style }]
  filterValues,
  onFilterChange,
  onClearFilters,

  // toolbar right
  onRefresh,
  refreshLoading,
  onExport,
  exportLoading,
  toolbarExtra,

  // bulk selection
  selection, // { enabled, selectedRowKeys, onChange, actions: [{ key, label, danger, icon, confirm, onClick }] }

  // states
  skeletonRows = 6,
  empty,
  error,

  // antd Table passthrough
  columns,
  dataSource,
  loading,
  rowSelection,
  ...tableProps
}) => {
  const { isDark } = useTheme();
  const card = adminCardStyle(isDark);
  const border = hairline(isDark);
  const rows = dataSource || [];

  const hasToolbar = !!(search || filters?.length || onExport || onRefresh || toolbarExtra || title);
  const hasActiveFilters =
    (search?.value && search.value.length > 0) ||
    (filters || []).some((f) => {
      const v = filterValues?.[f.key];
      return Array.isArray(v) ? v.length > 0 : !!v;
    });

  const resolvedSelection =
    rowSelection !== undefined
      ? rowSelection
      : selection?.enabled
        ? { selectedRowKeys: selection.selectedRowKeys, onChange: selection.onChange }
        : undefined;

  const emptyNode = (
    <Empty
      description={
        empty?.title ? (
          <Space direction="vertical" size={2}>
            <Text strong>{empty.title}</Text>
            {empty.description && <Text style={{ color: muted(isDark) }}>{empty.description}</Text>}
          </Space>
        ) : (
          empty?.description || undefined
        )
      }
      style={{ padding: 32 }}
    >
      {empty?.action}
    </Empty>
  );

  const showSkeleton = loading && rows.length === 0;

  return (
    <div>
      {error && (
        <Alert type="error" showIcon message={error} style={{ marginBottom: 12, borderRadius: 8 }} />
      )}

      {showSkeleton ? (
        <TableRowsSkeleton rows={skeletonRows} />
      ) : (
        <div style={card}>
          {hasToolbar && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '10px 12px',
                borderBottom: `1px solid ${border}`,
              }}
            >
              <Space wrap size={8}>
                {title && (
                  <Space size={8} style={{ marginRight: 4 }}>
                    <Text strong style={{ fontSize: 13 }}>{title}</Text>
                    {count != null && <Text style={{ color: muted(isDark), fontSize: 12 }}>({count})</Text>}
                  </Space>
                )}
                {search && (
                  <Input
                    allowClear
                    prefix={<SearchOutlined style={{ color: muted(isDark) }} />}
                    placeholder={search.placeholder || 'Search…'}
                    value={search.value}
                    onChange={search.onChange}
                    style={{ width: 210 }}
                  />
                )}
                {(filters || []).map((f) => (
                  <Select
                    key={f.key}
                    mode={f.mode}
                    allowClear
                    placeholder={f.placeholder}
                    value={filterValues?.[f.key]}
                    onChange={(v) => onFilterChange?.(f.key, v)}
                    options={f.options}
                    style={{ minWidth: 132, maxWidth: 220, ...f.style }}
                    maxTagCount="responsive"
                  />
                ))}
                {hasActiveFilters && onClearFilters && (
                  <Button icon={<ClearOutlined />} onClick={onClearFilters}>
                    Clear filters
                  </Button>
                )}
              </Space>

              <Space wrap size={8}>
                {toolbarExtra}
                {onExport && (
                  <Button icon={<DownloadOutlined />} onClick={onExport} loading={exportLoading}>
                    Export CSV
                  </Button>
                )}
                {onRefresh && (
                  <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={refreshLoading}>
                    Refresh
                  </Button>
                )}
              </Space>
            </div>
          )}

          {selection?.enabled && selection.selectedRowKeys?.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '8px 12px',
                background: STATUS_COLORS.info.bg(isDark),
                borderBottom: `1px solid ${border}`,
              }}
            >
              <Text style={{ fontSize: 12.5 }}>
                {selection.selectedRowKeys.length} selected
              </Text>
              <Space size={8}>
                {(selection.actions || []).map((action) => {
                  const btn = (
                    <Button
                      key={action.key}
                      size="small"
                      danger={action.danger}
                      icon={action.icon}
                      onClick={action.confirm ? undefined : () => action.onClick(selection.selectedRowKeys)}
                    >
                      {action.label}
                    </Button>
                  );
                  if (!action.confirm) return btn;
                  const confirmCfg = typeof action.confirm === 'string'
                    ? { title: action.confirm }
                    : action.confirm;
                  return (
                    <Popconfirm
                      key={action.key}
                      title={confirmCfg.title}
                      description={confirmCfg.description}
                      okButtonProps={{ danger: action.danger }}
                      onConfirm={() => action.onClick(selection.selectedRowKeys)}
                    >
                      {btn}
                    </Popconfirm>
                  );
                })}
                <Button size="small" onClick={() => selection.onChange([])}>
                  Clear selection
                </Button>
              </Space>
            </div>
          )}

          <Table
            scroll={{ x: 'max-content' }}
            className="ledger-table"
            rowClassName="row-hover"
            columns={columns}
            dataSource={rows}
            loading={loading && rows.length > 0}
            rowSelection={resolvedSelection}
            locale={{ emptyText: emptyNode }}
            {...tableProps}
          />
        </div>
      )}
    </div>
  );
};

export default DataTable;

/**
 * Builds a complete `{ title: 'Actions', ... }` column definition.
 *
 * Replaces the row of unlabeled icon buttons every list page used to hand-
 * roll — including one with a bare red-bordered ban icon whose meaning had to
 * be guessed. Every action here always renders inside a `<Tooltip>`, resolves
 * its own `permission` (nothing extra for the caller to wire), honours
 * `visible(record)` for state-dependent actions ("Suspend" only when active),
 * and wires `confirm` to a `Popconfirm`. Once more than `maxVisible` actions
 * are visible for a row, the rest collapse into a `⋯` dropdown instead of
 * turning the column into a wall of squares.
 *
 * @param actions [{ key, icon, label, onClick(record), danger, permission,
 *                    visible(record), confirm: string | {title, description} }]
 */
export const rowActions = (actions, { maxVisible = 3, width } = {}) => ({
  title: 'Actions',
  key: 'actions',
  fixed: 'right',
  // A column can never be narrower than its own header. "Actions" at the
  // table's 12px header size plus the cell's inline padding needs ~76px, and
  // pages that asked for 60 were getting the word broken across three lines
  // ("Acti / Reques / ons"), which then inflated the height of every row in
  // the table. Callers keep control of the upper bound; only the floor is
  // enforced here, because the floor is a fact about the label, not a
  // preference of the page.
  //
  // The floor is sized to the buttons this table will ACTUALLY render — that
  // is `actions.length` capped at `maxVisible`, not `maxVisible` itself.
  // Sizing it to the cap charged every single-action table (Deployments has
  // one "View") for three buttons' worth of width, 44px it then had to take
  // from a column carrying real data.
  width: Math.max(width || 0, Math.min(actions.length, maxVisible) * 30 + 30, 76),
  render: (_, record) => <RowActionsCell actions={actions} record={record} maxVisible={maxVisible} />,
});

const RowActionsCell = ({ actions, record, maxVisible }) => {
  const { hasPermission } = usePermission();

  const resolved = actions.filter(
    (a) => (!a.permission || hasPermission(a.permission)) && (!a.visible || a.visible(record))
  );

  const renderAction = (action) => {
    const btn = (
      <Tooltip key={action.key} title={action.label}>
        <Button
          size="small"
          type="text"
          danger={action.danger}
          icon={action.icon}
          onClick={action.confirm ? undefined : () => action.onClick(record)}
        />
      </Tooltip>
    );
    if (!action.confirm) return btn;
    const confirmCfg = typeof action.confirm === 'string' ? { title: action.confirm } : action.confirm;
    return (
      <Popconfirm
        key={action.key}
        title={confirmCfg.title}
        description={confirmCfg.description}
        okButtonProps={{ danger: action.danger }}
        onConfirm={() => action.onClick(record)}
      >
        {btn}
      </Popconfirm>
    );
  };

  if (resolved.length <= maxVisible) {
    return <Space size={2}>{resolved.map(renderAction)}</Space>;
  }

  const visible = resolved.slice(0, maxVisible - 1);
  const overflow = resolved.slice(maxVisible - 1);

  return (
    <Space size={2}>
      {visible.map(renderAction)}
      <Dropdown
        menu={{
          items: overflow.map((a) => ({
            key: a.key,
            icon: a.icon,
            label: a.label,
            danger: a.danger,
            onClick: () => {
              if (a.confirm) {
                // Popconfirm needs a real anchor element, which a Dropdown menu
                // item can't host — a plain confirm keeps the safety check
                // without silently dropping it for overflowed actions.
                const confirmCfg = typeof a.confirm === 'string' ? { title: a.confirm } : a.confirm;
                // eslint-disable-next-line no-alert
                if (window.confirm([confirmCfg.title, confirmCfg.description].filter(Boolean).join('\n'))) {
                  a.onClick(record);
                }
              } else {
                a.onClick(record);
              }
            },
          })),
        }}
        trigger={['click']}
      >
        <Button size="small" type="text" icon={<MoreOutlined />} />
      </Dropdown>
    </Space>
  );
};
