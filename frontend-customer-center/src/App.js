import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { safeNext } from './auth/safeNext';
import { TeamProvider, useTeam } from './context/TeamContext';
import { ConfigProvider, theme as antTheme } from 'antd';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SiteProvider, useSite } from './context/SiteContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import RouteLoader from './components/RouteLoader';
import AppLayout from './components/AppLayout';

// Every route is its own chunk — the initial bundle only needs the shell
// (router, theme, auth) rather than every page in the app up front. Suspense
// shows RouteLoader for the brief moment a chunk is fetched.
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
const MaintenancePage = lazy(() => import('./pages/MaintenancePage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const VerifyEmailSentPage = lazy(() => import('./pages/VerifyEmailSentPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const CheckoutSuccessPage = lazy(() => import('./pages/CheckoutSuccessPage'));
const CheckoutCancelPage = lazy(() => import('./pages/CheckoutCancelPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const UsageLimitsPage = lazy(() => import('./pages/UsageLimitsPage'));
const ModelCatalogPage = lazy(() => import('./pages/catalog/ModelCatalogPage'));
const ModelDetailPage = lazy(() => import('./pages/catalog/ModelDetailPage'));
const MachineTypesPage = lazy(() => import('./pages/catalog/MachineTypesPage'));
const MachineDetailPage = lazy(() => import('./pages/catalog/MachineDetailPage'));
const DeployJourney = lazy(() => import('./pages/deploy/DeployJourney'));
const DeploymentsListPage = lazy(() => import('./pages/deployments/DeploymentsListPage'));
const DeploymentDetailPage = lazy(() => import('./pages/deployments/DeploymentDetailPage'));
const BillingPage = lazy(() => import('./pages/billing/BillingPage'));
const InvoiceDetailPage = lazy(() => import('./pages/billing/InvoiceDetailPage'));
const SupportTicketsPage = lazy(() => import('./pages/support/SupportTicketsPage'));
const TicketReplyPage = lazy(() => import('./pages/support/TicketReplyPage'));
const TeamOnboardingPage = lazy(() => import('./pages/team/TeamOnboardingPage'));
const InvitePage = lazy(() => import('./pages/team/InvitePage'));
const JoinPage = lazy(() => import('./pages/team/JoinPage'));
const TeamSettingsPage = lazy(() => import('./pages/team/TeamSettingsPage'));

// ── Theme tokens ──────────────────────────────────────────────────────────────
// A light cloud-console palette — white surfaces on a soft lavender-blue page
// with indigo as the accent — cascades from here into every antd component
// (buttons, inputs, tags, tables…), so most of the visual identity lives in
// this one object.
const lightToken = {
  colorPrimary:   '#4F6BED',
  colorInfo:      '#4F6BED',
  colorSuccess:   '#22A565',
  colorWarning:   '#D98A1F',
  colorError:     '#E5484D',
  borderRadius:   10,
  borderRadiusLG: 16,
  fontFamily:     "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  colorBgLayout:      '#F5F7FD',
  colorBgContainer:   '#FFFFFF',
  colorBorder:        '#ECEFF8',
  colorBorderSecondary: '#F3F5FB',
  colorText:          '#1B1F35',
  colorTextSecondary: '#6B7290',
  colorTextTertiary:  '#AEB4CC',
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
  colorBgBase:         '#0E1120',
  colorBgContainer:    '#171B2E',
  colorBgElevated:     '#1E2440',
  colorBgLayout:       '#0E1120',
  colorText:           '#E8EAF4',
  colorTextSecondary:  '#9BA1BC',
  colorTextTertiary:   '#6E7597',
  colorBorder:         '#242942',
  colorBorderSecondary: '#1E2338',
};

// The sidebar is a light surface in both modes, so the Menu keeps antd's
// light theme and only needs its selected/hover states tinted to indigo.
const menuComponentTokens = {
  itemSelectedBg: '#EEF2FF',
  itemSelectedColor: '#4F6BED',
  itemHoverBg: '#F5F7FD',
  itemColor: '#6B7290',
  itemHeight: 42,
  itemBorderRadius: 10,
  darkItemSelectedBg: 'rgba(94,124,247,0.16)',
  darkItemSelectedColor: '#A9BBFF',
  darkItemHoverBg: 'rgba(255,255,255,0.04)',
  darkItemColor: '#9BA1BC',
};

// ── Protected Route ───────────────────────────────────────────────────────────
const ProtectedRoute = ({ children }) => {
  const { token, loading, user } = useAuth();
  const location = useLocation();
  // If we have a cached user in localStorage, show content immediately
  // instead of flashing blank while fetchMe is in flight
  if (loading && !user) return null;
  if (!token) return <Navigate to="/login" replace />;
  // Chose "my team or company" at signup and has not created (or skipped)
  // their organization yet — that comes first, once.
  if (user?.teamOnboardingPending && location.pathname !== '/onboarding/team') {
    return <Navigate to="/onboarding/team" replace />;
  }
  return children;
};

// ── Money Route — only for roles that may see the account's money ───────────
// Developer and Viewer land on the dashboard instead. The server refuses
// these pages' data for them anyway; this only avoids a page full of errors.
const MoneyRoute = ({ children }) => {
  const { canSeeMoney, ready } = useTeam();
  if (!ready) return null;
  if (!canSeeMoney) return <Navigate to="/dashboard" replace />;
  return children;
};

// ── Deploy Route — only for roles that may create deployments ───────────────
const DeployRoute = ({ children }) => {
  const { can, ready } = useTeam();
  if (!ready) return null;
  if (!can('deployments.create')) return <Navigate to="/deployments" replace />;
  return children;
};

// ── Public Route (redirect if already logged in) ─────────────────────────────
const PublicRoute = ({ children }) => {
  const { token, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  // Already signed in: go where the link wanted (e.g. back to an invitation),
  // but only ever to a page inside this app — see auth/safeNext.js.
  if (token) return <Navigate to={safeNext(location.search) || '/dashboard'} replace />;
  return children;
};

// ── Conditionally wraps children with GoogleOAuthProvider only when a clientId exists.
// This prevents the "Missing required parameter client_id" crash when Google SSO is
// disabled or the site config hasn't resolved yet.
const MaybeGoogleProvider = ({ clientId, children }) => {
  if (!clientId) return children;
  return <GoogleOAuthProvider clientId={clientId}>{children}</GoogleOAuthProvider>;
};

// ── Inner app — must be inside ThemeProvider to read isDark ──────────────────
const AppWithTheme = () => {
  const { isDark } = useTheme();
  const { dir, antdLocale, meta } = useLanguage();
  const { siteConfig, loaded } = useSite();
  const googleClientId = siteConfig?.googleSSO?.enabled ? (siteConfig?.googleSSO?.clientId || '') : '';
  const isMaintenanceMode = loaded && siteConfig?.maintenance?.enabled;

  // Show maintenance page for non-admin users when maintenance is on
  if (isMaintenanceMode) {
    return (
      <ConfigProvider
        direction={dir}
        locale={antdLocale || undefined}
        theme={{
          algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
          token:     { ...(isDark ? darkToken : lightToken), fontFamily: meta.fontFamily },
          components: { Menu: menuComponentTokens },
        }}
      >
        <Suspense fallback={<RouteLoader />}>
          <MaintenancePage message={siteConfig?.maintenance?.message} />
        </Suspense>
      </ConfigProvider>
    );
  }

  return (
    <MaybeGoogleProvider clientId={googleClientId}>
    <ConfigProvider
      direction={dir}
      locale={antdLocale || undefined}
      theme={{
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        // The font follows the language: Latin languages keep the app's own
        // face, while Urdu, Arabic and Devanagari need their own — see
        // src/i18n/languages.js.
        token:     { ...(isDark ? darkToken : lightToken), fontFamily: meta.fontFamily },
      }}
    >
      <Router>
        <Suspense fallback={<RouteLoader />}>
        <Routes>
          {/* Public Auth Routes */}
          <Route path="/login"               element={<PublicRoute><LoginPage /></PublicRoute>} />
          <Route path="/signup"              element={<PublicRoute><SignupPage /></PublicRoute>} />
          <Route path="/verify-email-sent"   element={<VerifyEmailSentPage />} />
          {/* Works signed in or out — the page decides what to offer. */}
          <Route path="/invite/:token"       element={<InvitePage />} />
          {/* A join link: shows what a stranger may see, then asks them to sign in. */}
          <Route path="/join/:token"         element={<JoinPage />} />
          <Route path="/onboarding/team"     element={<ProtectedRoute><TeamOnboardingPage /></ProtectedRoute>} />
          <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
          <Route path="/forgot-password"     element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
          <Route path="/reset-password/:token" element={<ResetPasswordPage />} />

          {/* Protected App Routes — share one persistent AppLayout (sidebar +
              header) via a layout route, so navigating between pages swaps
              only the <Outlet/> content instead of remounting the sidebar. */}
          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/settings"  element={<ProfilePage />} />
            <Route path="/limits"    element={<MoneyRoute><UsageLimitsPage /></MoneyRoute>} />
            <Route path="/team"      element={<TeamSettingsPage />} />

            {/* Model catalog + deployments — the product */}
            <Route path="/models"                element={<ModelCatalogPage />} />
            <Route path="/models/:slug"          element={<ModelDetailPage />} />
            {/* The hardware catalogue — the inverse view of the model one:
                every machine, and which models run on it. */}
            <Route path="/machines"              element={<MachineTypesPage />} />
            <Route path="/machines/:slug"        element={<MachineDetailPage />} />
            {/* Two entry points, one journey: with a slug we size hardware for
                that model; without one we recommend a model too. */}
            <Route path="/deploy"                element={<DeployRoute><DeployJourney /></DeployRoute>} />
            <Route path="/deploy/:slug"          element={<DeployRoute><DeployJourney /></DeployRoute>} />
            <Route path="/deployments"           element={<DeploymentsListPage />} />
            <Route path="/deployments/:id"       element={<DeploymentDetailPage />} />

            {/* Billing hub — balance, cards, invoices, limits, plans */}
            <Route path="/billing"               element={<MoneyRoute><BillingPage /></MoneyRoute>} />
            <Route path="/billing/invoices/:id"  element={<MoneyRoute><InvoiceDetailPage /></MoneyRoute>} />

            {/* Support tickets — local-only for now, no backend yet */}
            <Route path="/support"               element={<SupportTicketsPage />} />
            <Route path="/support/:id"           element={<TicketReplyPage />} />

            <Route path="/checkout/success" element={<MoneyRoute><CheckoutSuccessPage /></MoneyRoute>} />
            <Route path="/checkout/cancel"  element={<MoneyRoute><CheckoutCancelPage /></MoneyRoute>} />
          </Route>

          {/* Legacy redirects — Profile absorbed the old Security tab, and
              everything money-related moved out of Settings into Billing. */}
          <Route path="/profile"       element={<Navigate to="/settings" replace />} />
          <Route path="/wallet"        element={<Navigate to="/billing?tab=overview" replace />} />
          <Route path="/invoices"      element={<Navigate to="/billing?tab=invoices" replace />} />

          {/* Fallback */}
          <Route path="/"  element={<Navigate to="/dashboard" replace />} />
          <Route path="*"  element={<Navigate to="/login" replace />} />
        </Routes>
        </Suspense>
      </Router>
    </ConfigProvider>
    </MaybeGoogleProvider>
  );
};

function App() {
  /*
   * LanguageProvider sits below SiteProvider and AuthProvider because it reads
   * from both — the allowed languages come from the site config, the saved
   * preference from the signed-in user — and above AppWithTheme because that is
   * where ConfigProvider lives, and antd needs `direction` and `locale` from
   * here. Both ConfigProvider sites are inside AppWithTheme, including the
   * maintenance-mode one, so this single placement covers them.
   */
  return (
    <SiteProvider>
      <ThemeProvider>
        <AuthProvider>
          {/* Which account (personal or a team) the app acts on — needs the
              signed-in user, and every page below reads it. */}
          <TeamProvider>
            <LanguageProvider>
              <AppWithTheme />
            </LanguageProvider>
          </TeamProvider>
        </AuthProvider>
      </ThemeProvider>
    </SiteProvider>
  );
}

export default App;
