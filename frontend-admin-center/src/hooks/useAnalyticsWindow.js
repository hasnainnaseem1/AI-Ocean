import { useState, useMemo } from 'react';

/**
 * The reporting window every analytics tab is read through.
 *
 * One hook rather than `useState('30d')` in each page, because the window is
 * now two things that have to stay consistent — a preset OR a custom range —
 * and three places would have had to agree about which is active: the toolbar,
 * the request, and the effect that refetches.
 *
 * ── What it hands back ──
 *
 *   params  what goes on the request: `{ period }` for a preset, or
 *           `{ from, to }` for a custom range. Never both; the server reads
 *           `from`/`to` first and would quietly ignore the preset.
 *   key     a single string for the refetch dependency array. Spreading
 *           `[params.period, params.from, params.to]` there works until
 *           somebody adds a fourth field and forgets one.
 *   picker  spread straight onto `<PeriodPicker />`.
 *
 * ── Days are sent as days ──
 *
 * The range goes over as two plain dates, not as instants. Converting them to
 * a timestamp here would stamp them with the BROWSER's timezone, while the
 * server buckets on the reporting timezone from the policy — so an operator in
 * Karachi reading a UTC report would get a first bar five hours short, and the
 * two numbers would never quite reconcile. Which day boundaries a report uses
 * is the report's decision, so the question is left to the one place that
 * answers it: `resolveWindow`.
 */
const useAnalyticsWindow = (initialPeriod = '30d') => {
  const [period, setPeriod] = useState(initialPeriod);
  // `[dayjs, dayjs]` while a custom range is active, null while a preset is.
  const [range, setRange] = useState(null);

  const params = useMemo(() => {
    if (range && range[0] && range[1]) {
      return {
        from: range[0].format('YYYY-MM-DD'),
        to: range[1].format('YYYY-MM-DD'),
      };
    }
    return { period };
  }, [period, range]);

  const key = params.from ? `${params.from}..${params.to}` : params.period;

  return {
    params,
    key,
    picker: {
      period,
      range,
      // Choosing a preset clears the range, and choosing a range is what makes
      // the preset inactive — only one of them can be true at a time.
      onPeriod: (value) => { setRange(null); setPeriod(value); },
      onRange: (value) => setRange(value && value[0] && value[1] ? value : null),
    },
  };
};

export default useAnalyticsWindow;
