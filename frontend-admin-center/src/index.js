import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp, theme as antTheme } from 'antd';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { PermissionProvider } from './contexts/PermissionContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import reportWebVitals from './reportWebVitals';
import './index.css';

// ── Theme tokens ──────────────────────────────────────────────────────────────
// The whole visual identity cascades from here into every antd component
// (buttons, inputs, tags, tables, modals…), so it lives in this one object
// rather than in the pages.
//
// Two things define this console and separate it from the customer center:
//
//   1. NEUTRAL SURFACES. Light mode is a grey ground with white cards; dark
//      mode is a true black ramp with no blue channel lift. See the SURFACE
//      block in theme/colors.js for why. Indigo stays as the accent — on a
//      neutral ground it finally reads as the one deliberate colour on screen.
//   2. DENSITY. `fontSize`, `controlHeight`, `padding` and the Table cell
//      tokens are all pulled below antd's defaults. This is not cosmetic: at
//      antd's stock 14px/32px rhythm an 8-column table needs more horizontal
//      room than the content area has, so tables overflowed and scrolled
//      sideways on ordinary laptop widths. Density is what makes them fit.
//
// Keep these in step with theme/colors.js — SURFACE/ink/muted/hairline there
// are the same values, for the hand-built markup antd does not reach.
const lightToken = {
  colorPrimary:   '#4F6BED',
  colorInfo:      '#4F6BED',
  colorSuccess:   '#1A9655',
  colorWarning:   '#C97E14',
  colorError:     '#DC3D42',
  borderRadius:   8,
  borderRadiusLG: 10,
  borderRadiusSM: 6,
  fontFamily:     "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",

  // Density — see note above.
  fontSize:       13,
  fontSizeSM:     12,
  fontSizeLG:     15,
  fontSizeHeading4: 16,
  fontSizeHeading5: 14,
  controlHeight:  30,
  controlHeightSM: 24,
  controlHeightLG: 36,
  padding:        14,
  paddingLG:      18,
  paddingSM:      10,
  paddingXS:      7,
  margin:         14,
  marginLG:       18,
  marginSM:       10,

  colorBgLayout:      '#F4F4F5',
  colorBgContainer:   '#FFFFFF',
  colorBgElevated:    '#FFFFFF',
  colorBorder:        '#E4E4E7',
  colorBorderSecondary: '#EFEFF1',
  colorText:          '#18181B',
  colorTextSecondary: '#71717A',
  colorTextTertiary:  '#A1A1AA',
  motionDurationFast: '0.12s',
  motionDurationMid:  '0.16s',
  motionDurationSlow: '0.2s',
};

const darkToken = {
  ...lightToken,
  colorPrimary:       '#7089F5',
  colorInfo:          '#7089F5',
  colorSuccess:       '#4FCB8C',
  colorWarning:       '#F5BC66',
  colorError:         '#F47174',
  colorBgBase:         '#0A0A0A',
  colorBgContainer:    '#151515',
  colorBgElevated:     '#1E1E1E',
  colorBgLayout:       '#0A0A0A',
  colorText:           '#EDEDED',
  colorTextSecondary:  '#A1A1AA',
  colorTextTertiary:   '#71717A',
  colorBorder:         '#272727',
  colorBorderSecondary: '#1F1F1F',
};

/**
 * Per-component overrides, applied in both modes.
 *
 * `Table` is the one that matters most — this app is mostly tables, and antd's
 * stock 16px cell padding is what pushed 8-column tables past the width of the
 * content area. `Menu`'s dark item tokens are live too, because the sidebar
 * Menu switches its own `theme` prop (see AppSider.js).
 */
const componentTokens = {
  /**
   * A count badge is white text on `colorError`. In dark mode that token is
   * `#F47174` — the right shade for error *text* on a dark ground, but only
   * 2.81:1 behind white, under the 3:1 floor. The badge gets the darker shade
   * in both modes instead (4.38:1); `colorError` itself is left alone, because
   * everywhere else it is a foreground and the lighter value is correct there.
   */
  Badge: {
    colorError: '#DC3D42',
  },
  Menu: {
    itemSelectedBg: '#EEF2FF',
    itemSelectedColor: '#4F6BED',
    itemHoverBg: '#F4F4F5',
    itemColor: '#52525B',
    itemHeight: 34,
    itemBorderRadius: 7,
    itemMarginBlock: 2,
    darkItemSelectedBg: 'rgba(94,124,247,0.18)',
    darkItemSelectedColor: '#A9BBFF',
    darkItemHoverBg: 'rgba(255,255,255,0.05)',
    darkItemColor: '#A1A1AA',
  },
  Table: {
    cellPaddingBlock: 8,
    cellPaddingInline: 12,
    cellPaddingBlockSM: 6,
    cellPaddingInlineSM: 10,
    headerBg: 'transparent',
    headerSplitColor: 'transparent',
    rowHoverBg: 'transparent', // the hover wash is owned by index.css, in both modes
    fontSize: 13,
  },
  Card: { paddingLG: 16 },
  Descriptions: { padding: 12, itemPaddingBottom: 10 },
  Form: { itemMarginBottom: 16, verticalLabelPadding: '0 0 4px' },
  Statistic: { contentFontSize: 22 },
  Modal: { titleFontSize: 16 },
  Tabs: { horizontalItemPadding: '9px 0', titleFontSize: 13 },
  Segmented: { trackPadding: 2 },
};

/**
 * ConfigProvider has to sit *inside* ThemeProvider so it can read `isDark`,
 * hence this thin wrapper rather than configuring antd at the root directly.
 *
 * Note `components` is passed unconditionally. The customer center only passes
 * its menu tokens on one branch of a conditional, which is why its dark
 * sidebar needs CSS overrides to compensate — that bug is not reproduced here.
 */
const ThemedConfigProvider = ({ children }) => {
  const { isDark } = useTheme();
  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: isDark ? darkToken : lightToken,
        components: componentTokens,
      }}
    >
      {children}
    </ConfigProvider>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <ThemedConfigProvider>
        <AntApp>
          <AuthProvider>
            <PermissionProvider>
              <App />
            </PermissionProvider>
          </AuthProvider>
        </AntApp>
      </ThemedConfigProvider>
    </ThemeProvider>
  </React.StrictMode>
);

reportWebVitals();
