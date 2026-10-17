import React, { useEffect, useState } from 'react';
import { Button, Dropdown, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import exportApi from '../../api/exportApi';
import { usePermission } from '../../hooks/usePermission';
import { PERMISSIONS } from '../../utils/permissions';

/**
 * Take this tab's data away, over the window it is currently showing.
 *
 * ── Why it sits next to the period control ──
 *
 * The export and the window are one decision. An operator narrows to a month,
 * reads the table, and wants that month as a file — if the button lived
 * somewhere else they would have to set the window twice and trust that both
 * copies agreed. Here the file is built from the same `params` the page just
 * fetched with, so the CSV and the screen cannot disagree.
 *
 * ── Why the list comes from the server ──
 *
 * Which datasets belong to which tab is declared in the backend registry, so
 * a dataset added there appears on its tab without a release. A hardcoded list
 * here would be a second place to update and the one that goes stale.
 *
 * ── Hidden, not disabled ──
 *
 * `analytics.export` is a separate right from looking at the screen. Without
 * it this renders nothing: a greyed-out button only produces a support ticket
 * asking why it is greyed out, and the honest answer — "you are not allowed to
 * take customer data out of the building" — is not something a tooltip should
 * be delivering.
 */

/* The registry is the same for every tab and does not change between them, so
   it is fetched once per session rather than on each tab mount. A failure is
   cached as an empty list: the request is not retried on every tab switch, and
   the button simply does not appear. */
let registry = null;
let inFlight = null;
const loadRegistry = () => {
  if (registry) return Promise.resolve(registry);
  if (!inFlight) {
    inFlight = exportApi.list()
      .then((d) => { registry = d.datasets || []; return registry; })
      .catch(() => { registry = []; return registry; })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
};

const ExportButton = ({ tab, params = {}, size = 'small' }) => {
  const { hasPermission } = usePermission();
  const canExport = hasPermission(PERMISSIONS.ANALYTICS_EXPORT);

  const [datasets, setDatasets] = useState(registry);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!canExport) return undefined;
    let alive = true;
    loadRegistry().then((all) => { if (alive) setDatasets(all); });
    return () => { alive = false; };
  }, [canExport]);

  const mine = (datasets || []).filter((d) => d.tab === tab);

  const run = async (key) => {
    setBusy(key);
    try {
      message.success(`Downloaded ${await exportApi.download(key, params)}`);
    } catch (err) {
      message.error(err.response?.status === 403
        ? 'Exporting needs the Analytics Export permission'
        : 'Could not build that export');
    } finally {
      setBusy(null);
    }
  };

  if (!canExport || !mine.length) return null;

  /* One dataset is a button. Several is a menu that names them, because
     "Export CSV" on a tab holding three tables would quietly pick one and the
     reader would have no way to know which. */
  if (mine.length === 1) {
    return (
      <Button
        icon={<DownloadOutlined />}
        size={size}
        loading={busy === mine[0].key}
        onClick={() => run(mine[0].key)}
      >
        Export CSV
      </Button>
    );
  }

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: mine.map((d) => ({ key: d.key, label: d.label })),
        onClick: ({ key }) => run(key),
      }}
    >
      <Button icon={<DownloadOutlined />} size={size} loading={!!busy}>
        Export CSV
      </Button>
    </Dropdown>
  );
};

export default ExportButton;
