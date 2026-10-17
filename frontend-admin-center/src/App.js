import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import ProtectedRoute from './components/guards/ProtectedRoute';
import RouteGuard from './components/guards/RouteGuard';
import RouteLoader from './components/RouteLoader';
import { PERMISSIONS } from './utils/permissions';
import { FeatureProvider } from './contexts/FeatureContext';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const UsersListPage = lazy(() => import('./pages/users/UsersListPage'));
const UserDetailPage = lazy(() => import('./pages/users/UserDetailPage'));
const CustomersListPage = lazy(() => import('./pages/customers/CustomersListPage'));
const CustomerDetailPage = lazy(() => import('./pages/customers/CustomerDetailPage'));
const TeamsListPage = lazy(() => import('./pages/teams/TeamsListPage'));
const TeamDetailPage = lazy(() => import('./pages/teams/TeamDetailPage'));
const SupportTicketsListPage = lazy(() => import('./pages/support/SupportTicketsListPage'));
const SupportTicketDetailPage = lazy(() => import('./pages/support/SupportTicketDetailPage'));
const RolesListPage = lazy(() => import('./pages/roles/RolesListPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
// The analytics domains are lazily loaded by AnalyticsPage itself, one per
// tab, and the policy editor is a section of the Settings page.
const LogsListPage = lazy(() => import('./pages/logs/LogsListPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const DepartmentsPage = lazy(() => import('./pages/settings/DepartmentsPage'));
const ModelsListPage = lazy(() => import('./pages/catalog/ModelsListPage'));
const ModelFormPage = lazy(() => import('./pages/catalog/ModelFormPage'));
const TiersPage = lazy(() => import('./pages/catalog/TiersPage'));
const ResourcePricingPage = lazy(() => import('./pages/catalog/ResourcePricingPage'));
const QuestionnairePage = lazy(() => import('./pages/catalog/QuestionnairePage'));
const RecommendationPolicyListPage = lazy(() => import('./pages/catalog/RecommendationPolicyListPage'));
const RecommendationPolicyFormPage = lazy(() => import('./pages/catalog/RecommendationPolicyFormPage'));
const AdminDeploymentsListPage = lazy(() => import('./pages/deployments/DeploymentsListPage'));
const AdminDeploymentDetailPage = lazy(() => import('./pages/deployments/DeploymentDetailPage'));
const AdminCloudOverviewPage = lazy(() => import('./pages/cloud/CloudOverviewPage'));
const AdminGoogleCloudPage = lazy(() => import('./pages/cloud/GoogleCloudPage'));
const AdminAwsPage = lazy(() => import('./pages/cloud/AwsPage'));
const WalletsPage = lazy(() => import('./pages/billing/WalletsPage'));
const ReceivablesPage = lazy(() => import('./pages/billing/ReceivablesPage'));
const MarketingPagesListPage = lazy(() => import('./pages/marketing/MarketingPagesListPage'));
const MarketingPageFormPage = lazy(() => import('./pages/marketing/MarketingPageFormPage'));
const MarketingNavigationPage = lazy(() => import('./pages/marketing/MarketingNavigationPage'));
const MarketingBrandingPage = lazy(() => import('./pages/marketing/MarketingBrandingPage'));
const BlogPostsListPage = lazy(() => import('./pages/blog/BlogPostsListPage'));
const BlogPostFormPage = lazy(() => import('./pages/blog/BlogPostFormPage'));
const SeoSettingsPage = lazy(() => import('./pages/seo/SeoSettingsPage'));
const SeoDebugPage = lazy(() => import('./pages/seo/SeoDebugPage'));
const RedirectsPage = lazy(() => import('./pages/seo/RedirectsPage'));
const NotificationsPage = lazy(() => import('./pages/notifications/NotificationsPage'));
const AdminProfilePage = lazy(() => import('./pages/profile/ProfilePage'));
const IntegrationsPage = lazy(() => import('./pages/integrations/IntegrationsPage'));
const JobsPage = lazy(() => import('./pages/jobs/JobsPage'));

function App() {
  return (
    <FeatureProvider>
    <BrowserRouter>
      <Suspense fallback={<RouteLoader />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="users" element={<RouteGuard permission={PERMISSIONS.USERS_VIEW}><UsersListPage /></RouteGuard>} />
          <Route path="users/:id" element={<RouteGuard permission={PERMISSIONS.USERS_VIEW}><UserDetailPage /></RouteGuard>} />

          {/* AI infrastructure */}
          <Route path="models" element={<RouteGuard permission={PERMISSIONS.MODELS_VIEW}><ModelsListPage /></RouteGuard>} />
          <Route path="models/new" element={<RouteGuard permission={PERMISSIONS.MODELS_CREATE}><ModelFormPage /></RouteGuard>} />
          <Route path="models/:id/edit" element={<RouteGuard permission={PERMISSIONS.MODELS_EDIT}><ModelFormPage /></RouteGuard>} />
          <Route path="tiers" element={<RouteGuard permission={PERMISSIONS.MODELS_VIEW}><TiersPage /></RouteGuard>} />
          <Route path="resource-pricing" element={<RouteGuard permission={PERMISSIONS.MODELS_VIEW}><ResourcePricingPage /></RouteGuard>} />
          <Route path="questionnaire" element={<RouteGuard permission={PERMISSIONS.MODELS_VIEW}><QuestionnairePage /></RouteGuard>} />
          <Route path="recommendation-policy" element={<RouteGuard permission={PERMISSIONS.MODELS_VIEW}><RecommendationPolicyListPage /></RouteGuard>} />
          <Route path="recommendation-policy/:id/edit" element={<RouteGuard permission={PERMISSIONS.MODELS_VIEW}><RecommendationPolicyFormPage /></RouteGuard>} />
          <Route path="deployments" element={<RouteGuard permission={PERMISSIONS.DEPLOYMENTS_VIEW}><AdminDeploymentsListPage /></RouteGuard>} />
          <Route path="deployments/:id" element={<RouteGuard permission={PERMISSIONS.DEPLOYMENTS_VIEW}><AdminDeploymentDetailPage /></RouteGuard>} />
          <Route path="cloud" element={<RouteGuard permission={PERMISSIONS.DEPLOYMENTS_VIEW}><AdminCloudOverviewPage /></RouteGuard>} />
          <Route path="cloud/gcp" element={<RouteGuard permission={PERMISSIONS.DEPLOYMENTS_VIEW}><AdminGoogleCloudPage /></RouteGuard>} />
          <Route path="cloud/aws" element={<RouteGuard permission={PERMISSIONS.DEPLOYMENTS_VIEW}><AdminAwsPage /></RouteGuard>} />
          {/* The orphans list moved into the Google Cloud page. Kept so an old
              link or a notification sent before the move still lands somewhere. */}
          <Route path="cloud-orphans" element={<Navigate to="/cloud/gcp?tab=orphans" replace />} />
          <Route path="wallets" element={<RouteGuard permission={PERMISSIONS.BILLING_VIEW}><WalletsPage /></RouteGuard>} />
          <Route path="receivables" element={<RouteGuard permission={PERMISSIONS.BILLING_VIEW}><ReceivablesPage /></RouteGuard>} />
          <Route path="marketing/pages" element={<RouteGuard permission={PERMISSIONS.SETTINGS_VIEW}><MarketingPagesListPage /></RouteGuard>} />
          <Route path="marketing/pages/new" element={<RouteGuard permission={PERMISSIONS.SETTINGS_EDIT}><MarketingPageFormPage /></RouteGuard>} />
          <Route path="marketing/pages/:id/edit" element={<RouteGuard permission={PERMISSIONS.SETTINGS_EDIT}><MarketingPageFormPage /></RouteGuard>} />
          <Route path="marketing/navigation" element={<RouteGuard permission={PERMISSIONS.SETTINGS_VIEW}><MarketingNavigationPage /></RouteGuard>} />
          <Route path="marketing/branding" element={<RouteGuard permission={PERMISSIONS.SETTINGS_VIEW}><MarketingBrandingPage /></RouteGuard>} />
          <Route path="blog/posts" element={<RouteGuard permission={PERMISSIONS.SETTINGS_VIEW}><BlogPostsListPage /></RouteGuard>} />
          <Route path="blog/posts/new" element={<RouteGuard permission={PERMISSIONS.SETTINGS_EDIT}><BlogPostFormPage /></RouteGuard>} />
          <Route path="blog/posts/:id/edit" element={<RouteGuard permission={PERMISSIONS.SETTINGS_EDIT}><BlogPostFormPage /></RouteGuard>} />
          <Route path="seo/settings" element={<RouteGuard permission={PERMISSIONS.SETTINGS_VIEW}><SeoSettingsPage /></RouteGuard>} />
          <Route path="seo/redirects" element={<RouteGuard permission={PERMISSIONS.SETTINGS_VIEW}><RedirectsPage /></RouteGuard>} />
          <Route path="seo/debug" element={<RouteGuard permission={PERMISSIONS.SETTINGS_VIEW}><SeoDebugPage /></RouteGuard>} />
          <Route path="customers" element={<RouteGuard permission={PERMISSIONS.CUSTOMERS_VIEW}><CustomersListPage /></RouteGuard>} />
          <Route path="customers/:id" element={<RouteGuard permission={PERMISSIONS.CUSTOMERS_VIEW}><CustomerDetailPage /></RouteGuard>} />
          <Route path="teams" element={<RouteGuard permission={PERMISSIONS.CUSTOMERS_VIEW}><TeamsListPage /></RouteGuard>} />
          <Route path="teams/:id" element={<RouteGuard permission={PERMISSIONS.CUSTOMERS_VIEW}><TeamDetailPage /></RouteGuard>} />
          <Route path="support-tickets" element={<RouteGuard permission={PERMISSIONS.SUPPORT_VIEW}><SupportTicketsListPage /></RouteGuard>} />
          <Route path="support-tickets/:id" element={<RouteGuard permission={PERMISSIONS.SUPPORT_VIEW}><SupportTicketDetailPage /></RouteGuard>} />
          <Route path="roles" element={<RouteGuard permission={PERMISSIONS.ROLES_VIEW}><RolesListPage /></RouteGuard>} />
          {/*
            One page, eight tabs, and the tab in the URL.
            `/analytics/retention` is the Retention tab, which is also the URL
            it had when it was a route of its own — so every bookmark and deep
            link from before the move still lands where it did, and the back
            button steps through tabs. Each tab is still lazily loaded, so a
            domain nobody opens is never downloaded.
            Permissions are enforced per tab inside the page (money needs
            `analytics.revenue`, the export tab needs `analytics.export`); the
            guard here is the floor everything shares.
          */}
          <Route path="analytics" element={<RouteGuard permission={PERMISSIONS.ANALYTICS_VIEW}><AnalyticsPage /></RouteGuard>} />
          <Route path="analytics/:tab" element={<RouteGuard permission={PERMISSIONS.ANALYTICS_VIEW}><AnalyticsPage /></RouteGuard>} />
          <Route path="logs" element={<RouteGuard permission={PERMISSIONS.LOGS_VIEW}><LogsListPage /></RouteGuard>} />
          <Route path="settings" element={<RouteGuard permission={PERMISSIONS.SETTINGS_VIEW}><SettingsPage /></RouteGuard>} />
          <Route path="departments" element={<RouteGuard permission={PERMISSIONS.SETTINGS_VIEW}><DepartmentsPage /></RouteGuard>} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<AdminProfilePage />} />
          <Route path="integrations" element={<RouteGuard permission={PERMISSIONS.SETTINGS_VIEW}><IntegrationsPage /></RouteGuard>} />
          <Route path="jobs" element={<RouteGuard permission={PERMISSIONS.SETTINGS_VIEW}><JobsPage /></RouteGuard>} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
    </FeatureProvider>
  );
}

export default App;
