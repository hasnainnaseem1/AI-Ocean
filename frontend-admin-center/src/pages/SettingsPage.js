import React, { useState, useEffect } from 'react';
import {
  Menu, Spin, Form, Input, Button, Switch, message, InputNumber, Select, Space, Alert, Typography,
  Row, Col,
} from 'antd';
import {
  SaveOutlined, UserOutlined, MailOutlined, SafetyOutlined, BellOutlined,
  DollarOutlined, ThunderboltOutlined, ToolOutlined, FileTextOutlined, GlobalOutlined,
  ApartmentOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/common/PageHeader';
import PermissionGuard from '../components/guards/PermissionGuard';
import FormSection from '../components/common/FormSection';
import TempEmailBlockingSettings from '../components/settings/TempEmailBlockingSettings';
import EmailTemplatesSettings from '../components/settings/EmailTemplatesSettings';
import { usePermission } from '../hooks/usePermission';
import { useTheme } from '../contexts/ThemeContext';
import { adminCardStyle } from '../theme/colors';
import settingsApi from '../api/settingsApi';
import { PERMISSIONS } from '../utils/permissions';

const SettingsPage = () => {
  const { hasPermission, isSuperAdmin } = usePermission();
  const { isDark } = useTheme();
  const [activeKey, setActiveKey] = useState('customer');
  const [loading, setLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [settings, setSettings] = useState({});
  const [customerForm] = Form.useForm();
  const [securityForm] = Form.useForm();
  const [notificationForm] = Form.useForm();
  const [maintenanceForm] = Form.useForm();
  const [featuresForm] = Form.useForm();
  const [billingForm] = Form.useForm();
  const [languagesForm] = Form.useForm();
  const [teamsForm] = Form.useForm();

  /**
   * Every language the product ships translation files for, sent by the server
   * alongside the settings. Deliberately not a copy kept here: the server owns
   * which languages exist, and a second list in the admin bundle would drift
   * the first time one was added.
   */
  const [availableLanguages, setAvailableLanguages] = useState([]);
  // Customers with their own PAYG setting, which the platform switch does not reach.
  const [paygOverrides, setPaygOverrides] = useState({ allowed: 0, blocked: 0 });
  // Watched so the "default language" select can be narrowed to what is
  // actually switched on, live, before the admin saves.
  const enabledLanguages = Form.useWatch('enabled', languagesForm) || [];

  const canUpdate = hasPermission(PERMISSIONS.SETTINGS_EDIT);

  // Map section keys to the correct API method
  const sectionApiMap = {
    customer: settingsApi.updateCustomer,
    security: settingsApi.updateSecurity,
    notifications: settingsApi.updateNotification,
    maintenance: settingsApi.updateMaintenance,
    features: settingsApi.updateFeatures,
    billing: settingsApi.updateBilling,
    // Languages live inside AdminSettings.features, so they ride the same
    // endpoint. handleSave reshapes the form values — see the branch there.
    languages: settingsApi.updateFeatures,
    // Organizations live inside AdminSettings.features too, and ride the same
    // endpoint for the same reason as languages.
    teams: settingsApi.updateFeatures,
  };

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      try {
        const data = await settingsApi.getSettings();
        const s = data.settings || {};
        setSettings(s);

        // Customer: nested under customerSettings
        const cs = s.customerSettings || {};
        customerForm.setFieldsValue({
          requireEmailVerification: cs.requireEmailVerification,
          allowTemporaryEmails: cs.allowTemporaryEmails,
          autoApproveNewcustomers: cs.autoApproveNewcustomers,
        });

        // Security: nested under securitySettings
        const sec = s.securitySettings || {};
        securityForm.setFieldsValue({
          ...sec,
          // Convert ms → minutes for display
          lockoutDuration: sec.lockoutDuration ? Math.round(sec.lockoutDuration / 60000) : 120,
          sessionTimeout: sec.sessionTimeout ? Math.round(sec.sessionTimeout / 60000) : 10080,
        });

        // Notifications: nested under notificationSettings
        const ns = s.notificationSettings || {};
        notificationForm.setFieldsValue({
          enableEmailNotifications: ns.enableEmailNotifications,
          enablePushNotifications: ns.enablePushNotifications,
          notifyAdminOnNewcustomer: ns.notifyAdminOnNewcustomer,
        });

        // Maintenance: nested under maintenanceMode
        const mm = s.maintenanceMode || {};
        maintenanceForm.setFieldsValue({
          enabled: mm.enabled,
          message: mm.message,
          allowAdminAccess: mm.allowAdminAccess,
        });

        // Features: nested under features
        featuresForm.setFieldsValue(s.features || {});

        // Organizations: resolved server-side as well, so a platform that
        // predates any of these settings still shows the defaults in force.
        teamsForm.setFieldsValue(s.features?.teams || {});

        // Languages: also under features, but resolved server-side so the
        // defaults are filled in even on a settings row that predates them.
        setAvailableLanguages(data.availableLanguages || []);
        const lang = s.features?.languages || {};
        languagesForm.setFieldsValue({
          enabled: lang.enabled || ['en'],
          default: lang.default || 'en',
          firstVisitPromptEnabled: !!lang.firstVisitPromptEnabled,
        });

        // Billing settings come from their own endpoint so defaults are filled in
        try {
          const billing = await settingsApi.getBilling();
          const bs = billing.billingSettings || {};
          setPaygOverrides(billing.paygOverrides || { allowed: 0, blocked: 0 });
          billingForm.setFieldsValue({
            ...bs,
            // The nested blocks (payg/cardGate/storageGrace/copy) are flattened
            // onto the form's field names, which mirror the flat request-body
            // keys the PUT route reads — the form never has to know the
            // schema is nested underneath.
            paygEnabled: bs.payg?.enabled,
            paygCreditLimit: bs.payg?.creditLimit,
            paygMaxDebtDays: bs.payg?.maxDebtDays,
            paygAutoChargeThreshold: bs.payg?.autoChargeThreshold,
            paygAutoChargeRetryDays: bs.payg?.autoChargeRetryDays,
            paygMinLifetimeSpend: bs.payg?.eligibility?.minLifetimeSpend,
            paygMinAccountAgeDays: bs.payg?.eligibility?.minAccountAgeDays,
            customBuildEnabled: bs.customBuild?.enabled,
            customBuildMarkupPercent: bs.customBuild?.markupPercent,
            cardGateRequireVerifiedCard: bs.cardGate?.requireVerifiedCard,
            cardGateVerifyWithAuthHold: bs.cardGate?.verifyWithAuthHold,
            cardGateWhenGatewayCannotStoreCards: bs.cardGate?.whenGatewayCannotStoreCards,
            storageGraceEnabled: bs.storageGrace?.enabled,
            storageGraceDays: bs.storageGrace?.graceDays,
            storageGraceTerminateAtEnd: bs.storageGrace?.terminateAtEnd,
            storageGraceWarnDailyFrom: bs.storageGrace?.warnDailyFrom,
            copyAutoSuspendedMessage: bs.copy?.autoSuspendedMessage,
            copyStorageDebtMessage: bs.copy?.storageDebtMessage,
            copyCheckoutCardRequiredMessage: bs.copy?.checkoutCardRequiredMessage,
            copyCheckoutPaygIneligibleMessage: bs.copy?.checkoutPaygIneligibleMessage,
          });
        } catch {
          // Non-fatal — the rest of the settings page still works
        }
      } catch {
        message.error('Failed to load settings');
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, [customerForm, securityForm, notificationForm, maintenanceForm, featuresForm, billingForm,
    languagesForm, teamsForm]);

  const handleSave = async (section, form) => {
    try {
      let values = await form.validateFields();
      // Convert minutes → ms for security settings before saving
      if (section === 'security') {
        values = {
          ...values,
          lockoutDuration: values.lockoutDuration ? values.lockoutDuration * 60000 : undefined,
          sessionTimeout: values.sessionTimeout ? values.sessionTimeout * 60000 : undefined,
        };
      }
      // The languages tab writes one nested block on the features endpoint,
      // rather than the flat booleans every other field there uses.
      if (section === 'languages') {
        values = { languages: values };
      }
      if (section === 'teams') {
        values = { teams: values };
      }
      setSaveLoading(true);
      const apiMethod = sectionApiMap[section];
      if (!apiMethod) throw new Error(`Unknown section: ${section}`);
      const result = await apiMethod(values);
      // Turning the card gate on can pause deployments immediately (see
      // fundingService.enforceCardGateNow) — worth saying so right here
      // rather than leaving the admin to discover it from a support ticket.
      if (result?.cardGateEnforcement?.paused > 0) {
        message.warning(
          `Settings saved — the card gate paused ${result.cardGateEnforcement.paused} `
          + `running deployment(s) that had no verified card on file.`,
          6
        );
      } else {
        message.success('Settings saved successfully');
      }
    } catch (err) {
      if (err.errorFields) return;
      message.error(err.response?.data?.message || 'Save failed');
    } finally {
      setSaveLoading(false);
    }
  };

  const tabItems = [
    {
      key: 'customer',
      label: 'Customer',
      children: (
        <Form form={customerForm} layout="vertical" disabled={!canUpdate}>
          <FormSection title="Signup" description="What happens when a new customer signs up.">
            <Form.Item name="requireEmailVerification" label="Require Email Verification" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="allowTemporaryEmails" label="Allow Temporary Emails" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="autoApproveNewcustomers" label="Auto-Approve New Customers" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </FormSection>
          <PermissionGuard permission={PERMISSIONS.SETTINGS_EDIT}>
            <Button type="primary" icon={<SaveOutlined />} loading={saveLoading} onClick={() => handleSave('customer', customerForm)}>
              Save Customer Settings
            </Button>
          </PermissionGuard>
        </Form>
      ),
    },
    {
      key: 'email-blocking',
      label: 'Email Blocking',
      children: <TempEmailBlockingSettings canUpdate={canUpdate} />
    },
    {
      key: 'security',
      label: 'Security',
      children: (
        <Form form={securityForm} layout="vertical" disabled={!canUpdate}>
          <FormSection title="Login & sessions" description="Lockout thresholds and password strength.">
            <Form.Item name="maxLoginAttempts" label="Max Login Attempts" rules={[{ required: true, type: 'number', min: 1 }]}>
              <InputNumber min={1} max={100} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="lockoutDuration" label="Lockout Duration (minutes)" rules={[{ required: true, type: 'number', min: 1 }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="sessionTimeout" label="Session Timeout (minutes)">
              <InputNumber min={5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="passwordMinLength" label="Min Password Length" rules={[{ required: true, type: 'number', min: 6 }]}>
              <InputNumber min={6} max={128} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="requireStrongPassword" label="Require Strong Password" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </FormSection>
          <PermissionGuard permission={PERMISSIONS.SETTINGS_EDIT}>
            <Button type="primary" icon={<SaveOutlined />} loading={saveLoading} onClick={() => handleSave('security', securityForm)}>
              Save Security Settings
            </Button>
          </PermissionGuard>
        </Form>
      ),
    },
    {
      key: 'notifications',
      label: 'Notifications',
      children: (
        <Form form={notificationForm} layout="vertical" disabled={!canUpdate}>
          <FormSection title="Admin notifications" description="What triggers an email or push alert.">
            <Form.Item name="enableEmailNotifications" label="Email Notifications" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="enablePushNotifications" label="Push Notifications" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="notifyAdminOnNewcustomer" label="Notify on New Customer" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </FormSection>
          <PermissionGuard permission={PERMISSIONS.SETTINGS_EDIT}>
            <Button type="primary" icon={<SaveOutlined />} loading={saveLoading} onClick={() => handleSave('notifications', notificationForm)}>
              Save Notification Settings
            </Button>
          </PermissionGuard>
        </Form>
      ),
    },
    {
      // Notifications decides *when* a system email fires; this decides
      // *what it says*. Moved here from Integrations — it isn't a connection
      // to anything external (no host, no API key), it's wording, same as
      // the "Customer messages" fields on the Billing tab below.
      key: 'email-templates',
      label: 'Email Templates',
      children: <EmailTemplatesSettings />,
    },
    {
      key: 'billing',
      label: 'Billing',
      children: (
        <Form form={billingForm} layout="vertical" disabled={!canUpdate}>
          <FormSection title="Credit settings" description="Top-up amounts, low-balance warnings, and how storage debt is handled.">
            {settings.activePaymentGateway === 'lemonsqueezy' && (
              <Alert
                type="warning"
                showIcon
                message="The active payment gateway can't save cards or charge them later"
                description={
                  'LemonSqueezy is a merchant-of-record with no API for storing a payment method or '
                  + 'charging one without the customer present — the card gate and pay-as-you-go both '
                  + 'need that. "When the gateway can\'t store cards" below decides what happens: either '
                  + 'this platform quietly runs prepaid-only, or every deployment is blocked outright. '
                  + 'Switch the active gateway to Stripe under AI Infrastructure → Integrations to use '
                  + 'either feature.'
                }
                style={{ marginBottom: 20 }}
              />
            )}

            <Space size={16} wrap align="start">
              <Form.Item name="currency" label="Currency">
                <Input style={{ width: 110 }} />
              </Form.Item>
              <Form.Item name="minTopUp" label="Minimum top-up">
                <InputNumber min={0} style={{ width: 140 }} />
              </Form.Item>
              <Form.Item name="maxTopUp" label="Maximum top-up">
                <InputNumber min={0} style={{ width: 140 }} />
              </Form.Item>
              <Form.Item
                name="signupBonusCredits"
                label="Signup bonus"
                help="Free credit granted at signup"
              >
                <InputNumber min={0} style={{ width: 140 }} />
              </Form.Item>
            </Space>

            <Form.Item
              name="topUpPresets"
              label="Top-up preset amounts"
              help="Quick-pick buttons shown on the customer's wallet page"
            >
              <Select mode="tags" placeholder="25, 50, 100, 250" />
            </Form.Item>

            <Space size={16} wrap align="start">
              <Form.Item
                name="lowBalanceThreshold"
                label="Low balance warning at"
                help="Warn the customer below this amount"
              >
                <InputNumber min={0} style={{ width: 170 }} />
              </Form.Item>
              <Form.Item
                name="lowBalanceHours"
                label="…or below this many hours"
                help="Runway at their current burn rate. 0 = off"
              >
                <InputNumber min={0} style={{ width: 190 }} />
              </Form.Item>
            </Space>
            <Space size={16} wrap align="start">
              <Form.Item
                name="graceBalance"
                label="Stop at balance"
                help="Negative deliberately allows a tab"
              >
                <InputNumber style={{ width: 170 }} />
              </Form.Item>
              <Form.Item
                name="minHoursBalanceToDeploy"
                label="Hours of runway to deploy"
                help="Balance required to start a new deployment"
              >
                <InputNumber min={0} style={{ width: 190 }} />
              </Form.Item>
            </Space>

            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="A deployment is stopped at the exact moment its credit runs out"
              description={
                'Billing works out when the balance would cross "Stop at balance", charges only up '
                + 'to that instant, and back-dates the pause to it. So a customer is never billed for '
                + 'time they could not pay for, and never gets time for free — including after a gap '
                + 'in cron runs, where the whole catch-up used to be charged in one go.'
              }
            />

            <Form.Item
              name="autoSuspendAtZero"
              label="Auto-pause deployments when credit runs out"
              // Turning this off no longer gives compute away — every minute is
              // billed either way — but it does let a customer keep running on
              // credit they do not have, so the consequence has to be on screen.
              help={
                'Off means a deployment is not stopped — it keeps running and its cost keeps '
                + 'going onto the customer\'s outstanding balance, up to the debt limit below.'
              }
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name="billStorageWhileStopped"
              label="Keep charging for storage while a deployment is paused or stopped"
              help={
                'The customer released the compute but their disk is still on your hardware. '
                + 'Which parts count as storage is set per component under AI Infrastructure → Resource Pricing. '
                + 'Turning this off gives that disk away for free — the time is never billed and never recoverable.'
              }
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            {/*
              * The "when storage outruns the wallet" policy used to live here as
              * a choice between letting the balance go negative and writing the
              * unpaid storage off. Neither is offered any more: the shortfall
              * goes onto the customer's outstanding balance, which is the only
              * ledger debt collection, the credit limit and the storage grace
              * period actually read. Writing it off was a setting whose entire
              * purpose was to waive money the platform was owed.
              */}

            <Form.Item
              name="hoursPerMonth"
              label="Hours per month"
              help="Used to convert between hourly and monthly prices. 730 is a year divided by twelve."
            >
              <InputNumber min={1} style={{ width: 170 }} />
            </Form.Item>

            {/*
              * The customer's own machine builder. Which parts it offers is set
              * per component under AI Infrastructure → Resource Pricing
              * ("Offer in customer-built machines"); this is the platform-wide
              * switch above it, and the margin you take on a machine that was
              * never priced as a tier.
              */}
            <Form.Item
              name="customBuildEnabled"
              label="Let customers build their own machine"
              help={
                'Deploy flow mein "Customize" button aata hai — customer khud CPU, RAM, GPU '
                + 'chun kar apni machine bana sakta hai. Off karne par sirf aapke banaye hue Tiers dikhte hain. '
                + 'Kaun se parts offer hon, wo har component par alag se set hota hai (Resource Pricing).'
              }
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name="customBuildMarkupPercent"
              label="Extra margin on customer-built machines (%)"
              help={
                'A tier is priced by hand, so you can build your margin into it. A custom machine is '
                + 'priced straight from the component rates, so this is where that margin goes. '
                + '0 charges exactly the sum of the parts.'
              }
              style={{ marginBottom: 0 }}
            >
              <InputNumber min={0} max={500} step={1} style={{ width: 170 }} />
            </Form.Item>
          </FormSection>

          <FormSection title="Card gate" description="A verified card, required before any deployment, on top of the wallet.">
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Applies to every deployment, prepaid or pay-as-you-go"
              description="Checked at order time and every resume. Turning it on before customers have had a chance to add a card will block them from resuming their own deployments — leave it off until the deploy flow that collects one is live."
            />

            <Form.Item
              name="cardGateRequireVerifiedCard"
              label="Require a verified card before any deployment can run"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name="cardGateVerifyWithAuthHold"
              label="Also verify with a $1 authorize-and-void"
              help="Extra proof the card is real and chargeable, beyond the card form's own verification"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name="cardGateWhenGatewayCannotStoreCards"
              label="When the active gateway can't store cards (e.g. LemonSqueezy)"
              style={{ marginBottom: 0 }}
            >
              <Select
                options={[
                  { value: 'prepaid_only', label: 'Quietly run prepaid-only — hide the card gate and pay-as-you-go' },
                  { value: 'block_all_deployments', label: 'Block every deployment outright' },
                ]}
              />
            </Form.Item>
          </FormSection>

          <FormSection title="Pay-as-you-go" description="Whichever limit below is reached first blocks further pay-as-you-go usage.">
            <Form.Item
              name="paygEnabled"
              label="Offer pay-as-you-go as a billing method"
              help="The default for every customer. Prepaid credit is unaffected. Turning it off moves existing pay-as-you-go deployments to prepaid (billed up to that moment first). You can allow or block one customer on their page, under Wallet & Billing."
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            {(paygOverrides.allowed > 0 || paygOverrides.blocked > 0) && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message="Some customers have their own setting, which this switch does not change"
                description={[
                  paygOverrides.allowed > 0 && `${paygOverrides.allowed} allowed — they keep pay-as-you-go even when this is off.`,
                  paygOverrides.blocked > 0 && `${paygOverrides.blocked} blocked — they never get pay-as-you-go, even when this is on.`,
                ].filter(Boolean).join(' ')}
              />
            )}

            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="A limit of 0 turns that one dimension off"
              description="The other still applies on its own."
            />

            <Space size={16} wrap align="start">
              <Form.Item
                name="paygCreditLimit"
                label="Maximum unpaid balance"
                help="Blocks PAYG once a customer's debt exceeds this"
              >
                <InputNumber min={0} style={{ width: 190 }} />
              </Form.Item>
              <Form.Item
                name="paygMaxDebtDays"
                label="Maximum days a debt may go unpaid"
                help="Blocks PAYG once a debt is older than this, however small"
              >
                <InputNumber min={0} style={{ width: 220 }} />
              </Form.Item>
            </Space>

            <Space size={16} wrap align="start">
              <Form.Item
                name="paygAutoChargeThreshold"
                label="Attempt to auto-charge once debt reaches"
                help="Below this, debt collection waits rather than making an attempt"
              >
                <InputNumber min={0} style={{ width: 220 }} />
              </Form.Item>
              <Form.Item
                name="paygAutoChargeRetryDays"
                label="Retry the card on these days after debt first appears"
                help="e.g. 1, 3, 5"
              >
                <Select mode="tags" placeholder="1, 3, 5" />
              </Form.Item>
            </Space>

            <Typography.Paragraph type="secondary" style={{ marginBottom: 8, marginTop: 8 }}>
              Extra requirements before a customer may choose pay-as-you-go, beyond the card gate above.
              0 turns a requirement off.
            </Typography.Paragraph>
            <Space size={16} wrap align="start">
              <Form.Item
                name="paygMinLifetimeSpend"
                label="Minimum lifetime spend required"
              >
                <InputNumber min={0} style={{ width: 220 }} />
              </Form.Item>
              <Form.Item
                name="paygMinAccountAgeDays"
                label="Minimum account age required (days)"
                style={{ marginBottom: 0 }}
              >
                <InputNumber min={0} style={{ width: 220 }} />
              </Form.Item>
            </Space>
          </FormSection>

          <FormSection title="Storage grace period" description="For a stopped deployment whose storage bill has gone unpaid.">
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="This only ever decides when the hardware is taken back"
              description="The debt itself is never forgiven by the grace period ending, regardless of this setting."
            />

            <Form.Item
              name="storageGraceEnabled"
              label="Enforce a grace period before releasing the disk"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Space size={16} wrap align="start">
              <Form.Item name="storageGraceDays" label="Grace period length (days)">
                <InputNumber min={1} style={{ width: 190 }} />
              </Form.Item>
              <Form.Item
                name="storageGraceWarnDailyFrom"
                label="Start daily warnings from day"
              >
                <InputNumber min={0} style={{ width: 190 }} />
              </Form.Item>
            </Space>

            <Form.Item
              name="storageGraceTerminateAtEnd"
              label="Terminate and release the disk once the grace period ends"
              help="Off leaves the debt accruing indefinitely without ever terminating on its own — an admin has to act by hand"
              valuePropName="checked"
              style={{ marginBottom: 0 }}
            >
              <Switch />
            </Form.Item>
          </FormSection>

          <FormSection title="Suspend order & housekeeping">
            <Space size={16} wrap align="start">
              <Form.Item
                name="suspendOrder"
                label="When one customer's wallet can't cover everything running at once"
                help="Pay-as-you-go deployments are never included — they accrue debt instead of pausing"
              >
                <Select
                  style={{ width: 280 }}
                  options={[
                    { value: 'most_expensive', label: 'Suspend the most expensive first' },
                    { value: 'least_expensive', label: 'Suspend the least expensive first' },
                    { value: 'newest', label: 'Suspend the newest first' },
                    { value: 'oldest', label: 'Suspend the oldest first' },
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="staleProvisioningDays"
                label="Flag a deployment stuck provisioning after (days)"
                help="Stock can be held and nothing billed for it while it sits unfinished"
                style={{ marginBottom: 0 }}
              >
                <InputNumber min={1} style={{ width: 220 }} />
              </Form.Item>
            </Space>
          </FormSection>

          <FormSection
            title="Customer messages"
            description={
              <>
                Editable wording for the billing notifications this platform sends. An unrecognised{' '}
                <code>{'{placeholder}'}</code> is left visible rather than silently blanking part of the
                sentence.
              </>
            }
          >
            <Form.Item
              name="copyAutoSuspendedMessage"
              label="Deployment paused — out of credit"
              help="Placeholder: {deploymentName}"
            >
              <Input.TextArea rows={2} maxLength={1000} showCount />
            </Form.Item>

            <Form.Item
              name="copyStorageDebtMessage"
              label="Stopped deployment running up a storage balance"
              help="Placeholders: {deploymentName}, {storageGb}"
            >
              <Input.TextArea rows={2} maxLength={1000} showCount />
            </Form.Item>

            <Form.Item
              name="copyCheckoutCardRequiredMessage"
              label="Checkout — verified card required"
              help="Shown in the checkout modal when the card gate is on and no verified card is on file. No placeholders."
            >
              <Input.TextArea rows={2} maxLength={1000} showCount />
            </Form.Item>

            <Form.Item
              name="copyCheckoutPaygIneligibleMessage"
              label="Checkout — pay-as-you-go not yet eligible"
              help="Placeholders: {currency}, {minLifetimeSpend}, {minAccountAgeDays}"
              style={{ marginBottom: 0 }}
            >
              <Input.TextArea rows={2} maxLength={1000} showCount />
            </Form.Item>
          </FormSection>

          <PermissionGuard permission={PERMISSIONS.SETTINGS_EDIT}>
            <Button type="primary" icon={<SaveOutlined />} loading={saveLoading} onClick={() => handleSave('billing', billingForm)}>
              Save Billing Settings
            </Button>
          </PermissionGuard>
        </Form>
      ),
    },
    {
      key: 'teams',
      label: 'Teams',
      children: (
        <Form form={teamsForm} layout="vertical" disabled={!canUpdate}>
          <FormSection
            title="Organizations"
            description="Shared customer accounts: one wallet, one set of cards, several people. Switching this off hides every team entry point; organizations that already exist keep working, because they hold money and deployments that cannot simply vanish."
          >
            <Form.Item name="enabled" label="Allow customers to create organizations" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Row gutter={16}>
              <Col xs={24} sm={8}>
                <Form.Item name="maxMembers" label="Members per organization" help="Counting invitations that have not been answered yet">
                  <InputNumber min={2} max={1000} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="maxTeamsPerUser" label="Organizations one person may own">
                  <InputNumber min={1} max={100} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="ownershipExpiryDays" label="Handover offer expires after (days)">
                  <InputNumber min={1} max={30} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </FormSection>

          <FormSection
            title="Invitations"
            description="Inviting somebody by email is how an ordinary customer joins an organization. The link is bound to the invited address, so it works for nobody else."
          >
            <Row gutter={16}>
              <Col xs={24} sm={8}>
                <Form.Item name="inviteExpiryDays" label="Invitation expires after (days)">
                  <InputNumber min={1} max={30} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="invitesPerDay" label="Invitations per organization per day" help="Stops a team being used to mail strangers">
                  <InputNumber min={1} max={500} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="maxPendingInvites" label="Invitations waiting for an answer">
                  <InputNumber min={1} max={1000} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </FormSection>

          <FormSection
            title="Join link"
            description="One link an organization can share in its own chat. Opening it never admits anybody — it asks, and an owner or admin decides, which is what makes a forwarded or forgotten link harmless."
          >
            <Form.Item name="joinLinksEnabled" label="Allow join links" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              name="joinLinkApproval"
              label="Approval"
              help="Requiring approval is what keeps a leaked link worthless. Letting each organization decide hands that choice to the customer."
            >
              <Select
                options={[
                  { value: 'always', label: 'Always required' },
                  { value: 'team', label: 'Each organization decides' },
                ]}
              />
            </Form.Item>
            <Row gutter={16}>
              <Col xs={24} sm={8}>
                <Form.Item name="joinLinkExpiryDays" label="Default expiry (days)">
                  <InputNumber min={1} max={365} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="joinLinkMaxExpiryDays" label="Longest an organization may choose (days)">
                  <InputNumber min={1} max={365} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="joinLinkMaxUses" label="Most people one link may admit">
                  <InputNumber min={1} max={1000} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </FormSection>

          <FormSection
            title="Finding your company"
            description={'A customer signing up with a work address can be shown an organization whose owner reads mail at the same domain — but only one that chose to be findable. Nobody can ask about a domain that is not their own, so this can never be used to discover which companies are customers here.'}
          >
            <Form.Item name="companyHintEnabled" label="Show it" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              name="companyHintMaxAccounts"
              label="Treat a domain as a mailbox provider above this many accounts"
              help="The guard no list can give you: a company's domain has its own staff here, a free mail provider has the world. Above this count the hint stays silent, whether or not the provider is one anybody has heard of."
            >
              <InputNumber min={1} max={10000} style={{ width: 240 }} />
            </Form.Item>
            <Form.Item
              name="publicEmailDomains"
              label="Public email providers"
              help="Never claimable as a company domain, and never a source of the hint above. One per line."
              getValueFromEvent={(e) => e.target.value.split('\n').map((d) => d.trim()).filter(Boolean)}
              getValueProps={(value) => ({ value: Array.isArray(value) ? value.join('\n') : value })}
            >
              <Input.TextArea rows={5} />
            </Form.Item>
          </FormSection>

          <FormSection
            title="Company domains (enterprise)"
            description="Off. When on, an organization can claim its domain by publishing a DNS record and let colleagues in automatically. Ordinary customers never need it — they join by invitation or join link — and automatic joining is the one path where nobody reviews who came in, which is why it asks for real proof of the domain."
          >
            <Form.Item name="domainJoinEnabled" label="Allow company domains" valuePropName="checked">
              <Switch />
            </Form.Item>
          </FormSection>

          <FormSection
            title="Team emails"
            description="Every team event reaches the bell inside the customer center. This decides which ones also reach an inbox — the wording is the same sentence, in each recipient's own language."
          >
            <Form.Item name="emailNotifications" label="Send team events by email" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              name="emailEvents"
              label="Which events"
              help="Invitations are always emailed — they go to somebody who may not have an account yet, so a bell notification would reach nobody."
            >
              <Select
                mode="multiple"
                allowClear
                style={{ maxWidth: 520 }}
                options={[
                  { value: 'joins', label: 'Joining — requests, approvals, refusals' },
                  { value: 'ownership', label: 'Ownership handovers' },
                  { value: 'limits', label: 'Spending limits reached or close' },
                  { value: 'closure', label: 'An organization being closed' },
                ]}
              />
            </Form.Item>
          </FormSection>

          <FormSection
            title="Seat fees"
            description="Charge organizations per member above the free seats. Billed a day at a time, so somebody who joins mid-month is paid for from that day and no day is given away. Whatever the wallet cannot cover becomes debt on the account, like any other charge."
          >
            <Form.Item name="seatFeeEnabled" label="Charge for seats" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item name="seatFeeMonthly" label="Monthly fee per paid seat">
                  <InputNumber min={0} step={1} precision={2} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="seatFeeFreeSeats" label="Seats included free" help="Members above this number are charged">
                  <InputNumber min={0} max={1000} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </FormSection>

          <PermissionGuard permission={PERMISSIONS.SETTINGS_EDIT}>
            <Button type="primary" icon={<SaveOutlined />} loading={saveLoading} onClick={() => handleSave('teams', teamsForm)}>
              Save Team Settings
            </Button>
          </PermissionGuard>
        </Form>
      ),
    },
    {
      key: 'features',
      label: 'Features',
      children: (
        <Form form={featuresForm} layout="vertical" disabled={!canUpdate}>
          <FormSection title="Customer-facing features" description="Toggle what appears on the marketing site and customer center.">
            <Form.Item name="enableCustomerSignup" label="Enable Customer Signup" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="enableLogin" label="Enable Login Button (Marketing Site)" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              name="enableModelCatalog"
              label="Enable Model Catalog"
              help="Customers can browse available AI models and pricing"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="enableDeployments"
              label="Enable Deployments"
              help="Customers can request and manage model deployments"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="enablePlayground"
              label="Enable Playground"
              help="In-app chat against a deployed model (coming in a later phase)"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item name="enableCustomRoles" label="Enable Custom Roles" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="enableActivityLogs" label="Enable Activity Logs" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </FormSection>
          <PermissionGuard permission={PERMISSIONS.SETTINGS_EDIT}>
            <Button type="primary" icon={<SaveOutlined />} loading={saveLoading} onClick={() => handleSave('features', featuresForm)}>
              Save Feature Settings
            </Button>
          </PermissionGuard>
        </Form>
      ),
    },
    {
      key: 'languages',
      label: 'Languages',
      children: (
        <Form form={languagesForm} layout="vertical" disabled={!canUpdate}>
          <FormSection
            title="Languages customers can choose"
            description="English is always available and cannot be switched off — every untranslated line falls back to it."
          >
            <Form.Item
              name="enabled"
              label="Available languages"
              help="A language switcher appears in the customer center and on the sign-in page once more than one is on. Each customer's choice is saved to their account, so it follows them to any device."
            >
              <Select
                mode="multiple"
                placeholder="Choose the languages this platform offers"
                style={{ width: '100%', maxWidth: 520 }}
                optionFilterProp="label"
                options={availableLanguages.map((l) => ({
                  value: l.code,
                  label: `${l.englishName} · ${l.nativeName}${l.dir === 'rtl' ? ' · RTL' : ''}`,
                  // English is the fallback for every missing key, so a platform
                  // without it would render blanks rather than English. The
                  // server enforces this as well; disabling it here just stops
                  // an admin discovering it by having their change ignored.
                  disabled: l.code === 'en',
                }))}
              />
            </Form.Item>

            <Form.Item
              name="default"
              label="Default language"
              help="What a customer sees before they have chosen anything."
            >
              <Select
                style={{ width: 300 }}
                options={availableLanguages
                  .filter((l) => enabledLanguages.includes(l.code))
                  .map((l) => ({ value: l.code, label: `${l.englishName} · ${l.nativeName}` }))}
              />
            </Form.Item>

            <Form.Item
              name="firstVisitPromptEnabled"
              label="Ask new customers to pick a language on first sign-in"
              // Said plainly rather than left as a silent no-op: the prompt is
              // wired end to end, but it only appears once the platform can tell
              // which country someone is in, which needs a CDN country header or
              // a geo lookup that is not configured yet.
              help="This has no effect until country detection is set up. Until then the switcher is the only way customers change language."
              valuePropName="checked"
              style={{ marginBottom: 0 }}
            >
              <Switch />
            </Form.Item>
          </FormSection>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Some text stays in English for now"
            description="Deployment questionnaire wording, model and machine descriptions, and invoice PDFs are authored separately and are not translated yet. Customers using another language will still see those parts in English."
          />

          <PermissionGuard permission={PERMISSIONS.SETTINGS_EDIT}>
            <Button type="primary" icon={<SaveOutlined />} loading={saveLoading} onClick={() => handleSave('languages', languagesForm)}>
              Save Language Settings
            </Button>
          </PermissionGuard>
        </Form>
      ),
    },
  ];

  if (isSuperAdmin) {
    tabItems.splice(4, 0, {
      key: 'maintenance',
      label: 'Maintenance',
      children: (
        <Form form={maintenanceForm} layout="vertical" disabled={!canUpdate}>
          <FormSection title="Maintenance mode" description="Take the customer-facing app offline for planned work.">
            <Form.Item name="enabled" label="Maintenance Mode" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="message" label="Maintenance Message">
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item name="allowAdminAccess" label="Allow Admin Access During Maintenance" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </FormSection>
          <PermissionGuard permission={PERMISSIONS.SETTINGS_EDIT}>
            <Button type="primary" icon={<SaveOutlined />} loading={saveLoading} onClick={() => handleSave('maintenance', maintenanceForm)}>
              Save Maintenance Settings
            </Button>
          </PermissionGuard>
        </Form>
      ),
    });
  }

  // The left panel's own grouping — separate from `tabItems`, which stays the
  // single source of truth for each section's actual content. Keeping the two
  // apart means a typo here can misfile a section in the list but can never
  // touch what that section saves.
  const menuGroups = [
    {
      key: 'g-general', type: 'group', label: 'General',
      children: [
        { key: 'customer', icon: <UserOutlined />, label: 'Customer' },
        { key: 'notifications', icon: <BellOutlined />, label: 'Notifications' },
        { key: 'email-templates', icon: <FileTextOutlined />, label: 'Email Templates' },
        { key: 'languages', icon: <GlobalOutlined />, label: 'Languages' },
        isSuperAdmin && { key: 'maintenance', icon: <ToolOutlined />, label: 'Maintenance' },
      ].filter(Boolean),
    },
    {
      key: 'g-security', type: 'group', label: 'Security',
      children: [
        { key: 'security', icon: <SafetyOutlined />, label: 'Security' },
        { key: 'email-blocking', icon: <MailOutlined />, label: 'Email Blocking' },
      ],
    },
    {
      key: 'g-billing', type: 'group', label: 'Billing',
      children: [
        { key: 'billing', icon: <DollarOutlined />, label: 'Billing' },
        { key: 'teams', icon: <ApartmentOutlined />, label: 'Teams' },
        { key: 'features', icon: <ThunderboltOutlined />, label: 'Features' },
      ],
    },
  ];

  const activeSection = tabItems.find((t) => t.key === activeKey) || tabItems[0];

  return (
    <div>
      <PageHeader
        title="Settings"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Settings' }]}
      />
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ ...adminCardStyle(isDark), width: 232, flexShrink: 0, padding: '6px 0', overflow: 'hidden' }}>
          <Menu
            mode="inline"
            theme={isDark ? 'dark' : 'light'}
            selectedKeys={[activeSection.key]}
            items={menuGroups}
            onClick={({ key }) => setActiveKey(key)}
            style={{ background: 'transparent', borderInlineEnd: 'none' }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0, minHeight: 440 }}>
          {/* A floor, not a target: Maintenance (one short FormSection) and
              Billing (six long ones) are never going to be the same height,
              and forcing that would either crush Billing or pad Maintenance
              with fake empty space. What actually read as inconsistent was
              the short tabs looking like a stub — a tiny card followed by a
              wall of bare page. 440px is roughly the height of this page's
              own middle-of-the-road tabs (Customer, Security), so the short
              ones now match the page's typical shape instead of standing out
              as the exception; longer tabs already clear it on their own. */}
          {/* Every section's <Form> stays mounted the whole time — only the
              active one is shown, via CSS, and the rest sit at `display:none`.
              This has to be display-toggling rather than "only render the
              active section": `fetchSettings` below calls `xForm.
              setFieldsValue(...)` for all seven forms in one effect on load,
              and antd's Form only accepts that call once its `<Form>` element
              has actually mounted and connected to the instance — a section
              that was still unrendered at that moment silently dropped every
              value fetchSettings gave it, which is why switching to a tab you
              hadn't visited yet showed it as freshly empty instead of what was
              actually saved. */}
          <Spin spinning={loading}>
            {tabItems.map((t) => (
              <div key={t.key} style={{ display: t.key === activeSection.key ? 'block' : 'none' }}>
                {t.children}
              </div>
            ))}
          </Spin>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
