import React, { useState, useEffect } from 'react';
import {
  Card, Form, Input, Button, Switch, message, Row, Col, Divider, Typography, Alert, Space, Upload,
} from 'antd';
import {
  SaveOutlined, GoogleOutlined, GlobalOutlined, ShareAltOutlined, UploadOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import PermissionGuard from '../../components/guards/PermissionGuard';
import { usePermission } from '../../hooks/usePermission';
import seoApi from '../../api/seoApi';
import uploadApi from '../../api/uploadApi';
import { PERMISSIONS } from '../../utils/permissions';
import { useTheme } from '../../contexts/ThemeContext';
import { STATUS_COLORS, muted, hairline } from '../../theme/colors';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

const SeoSettingsPage = () => {
  const { hasPermission } = usePermission();
  const { isDark } = useTheme();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const canUpdate = hasPermission(PERMISSIONS.SETTINGS_EDIT);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const data = await seoApi.getSettings();
      if (data.success) {
        const s = data.seoSettings || {};
        form.setFieldsValue({
          googleAnalyticsId: s.googleAnalyticsId || '',
          googleSearchConsoleVerification: s.googleSearchConsoleVerification || '',
          bingVerification: s.bingVerification || '',
          defaultOgImage: s.defaultOgImage || '',
          enableSitemap: s.enableSitemap !== false,
          enableSchemaMarkup: s.enableSchemaMarkup !== false,
          robotsTxtCustom: s.robotsTxtCustom || '',
          customHeadScripts: s.customHeadScripts || '',
          twitter: s.socialLinks?.twitter || '',
          facebook: s.socialLinks?.facebook || '',
          linkedin: s.socialLinks?.linkedin || '',
          instagram: s.socialLinks?.instagram || '',
          youtube: s.socialLinks?.youtube || '',
        });
      }
    } catch (err) {
      message.error('Failed to load SEO settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      const payload = {
        googleAnalyticsId: values.googleAnalyticsId,
        googleSearchConsoleVerification: values.googleSearchConsoleVerification,
        bingVerification: values.bingVerification,
        defaultOgImage: values.defaultOgImage,
        enableSitemap: values.enableSitemap,
        enableSchemaMarkup: values.enableSchemaMarkup,
        robotsTxtCustom: values.robotsTxtCustom,
        customHeadScripts: values.customHeadScripts,
        socialLinks: {
          twitter: values.twitter,
          facebook: values.facebook,
          linkedin: values.linkedin,
          instagram: values.instagram,
          youtube: values.youtube,
        },
      };

      await seoApi.updateSettings(payload);
      message.success('SEO settings saved successfully');
    } catch (err) {
      if (err.errorFields) return;
      message.error(err.response?.data?.message || 'Failed to save SEO settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="SEO Settings"
        breadcrumbs={[
          { label: 'Home', path: '/' },
          { label: 'Website' },
          { label: 'SEO Settings' },
        ]}
      />

      <Form form={form} layout="vertical" disabled={!canUpdate}>
        <Row gutter={24}>
          {/* Left Column */}
          <Col xs={24} lg={14}>
            {/* Analytics & Verification */}
            <Card title="Analytics & Search Console" loading={loading}>
              <Alert
                message="Connect your analytics and search engine verification codes to track site performance."
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />

              <Form.Item
                name="googleAnalyticsId"
                label="Google Analytics Measurement ID"
                help="Format: G-XXXXXXXXXX (GA4)"
              >
                <Input placeholder="G-XXXXXXXXXX" prefix={<GoogleOutlined />} />
              </Form.Item>

              <Form.Item
                name="googleSearchConsoleVerification"
                label="Google Search Console Verification"
                help="The content value from the meta tag provided by Google Search Console"
              >
                <Input placeholder="Verification code" />
              </Form.Item>

              <Form.Item
                name="bingVerification"
                label="Bing Webmaster Verification"
                help="The content value from the meta tag provided by Bing Webmaster Tools"
              >
                <Input placeholder="Verification code" />
              </Form.Item>
            </Card>

            {/* Robots.txt & Sitemap */}
            <Card title="Sitemap & Robots.txt" style={{ marginTop: 16 }} loading={loading}>
              <Form.Item
                name="enableSitemap"
                label="Enable Auto-Generated Sitemap"
                valuePropName="checked"
                help="Automatically generates /sitemap.xml from published pages and blog posts"
              >
                <Switch />
              </Form.Item>

              <Form.Item
                name="robotsTxtCustom"
                label="Custom robots.txt"
                help="Leave empty to use the auto-generated robots.txt. Custom content will completely replace the default."
              >
                <TextArea
                  rows={8}
                  placeholder={`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /login\nDisallow: /signup\n\nSitemap: https://yourdomain.com/sitemap.xml`}
                  style={{ fontFamily: 'monospace', fontSize: 13 }}
                />
              </Form.Item>
            </Card>

            {/* Custom Head Scripts */}
            <Card title="Custom Head Scripts" style={{ marginTop: 16 }} loading={loading}>
              <Alert
                message="Add custom scripts, meta tags, or tracking codes to be injected into the <head> of every page."
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
              />
              <Form.Item
                name="customHeadScripts"
                label="Custom HTML / Scripts"
                help="Supports <script>, <meta>, <link>, and other HTML tags. Be careful with this field."
              >
                <TextArea
                  rows={8}
                  placeholder={`<!-- Example: Facebook Pixel -->\n<script>...</script>\n\n<!-- Example: Custom meta tag -->\n<meta name="custom" content="value" />`}
                  style={{ fontFamily: 'monospace', fontSize: 13 }}
                />
              </Form.Item>
            </Card>
          </Col>

          {/* Right Column */}
          <Col xs={24} lg={10}>
            {/* Default OG Image */}
            <Card title="Default Open Graph Image" loading={loading}>
              <Paragraph type="secondary">
                This image is used as the default share image when a page or blog post doesn't have its own OG image set.
              </Paragraph>
              <Form.Item name="defaultOgImage" label="Default OG Image URL">
                <Input placeholder="https://yourdomain.com/og-default.jpg" addonAfter={
                  <Upload showUploadList={false} accept="image/*" beforeUpload={async (file) => {
                    try {
                      const res = await uploadApi.upload('og-images', file);
                      if (res.success) { form.setFieldsValue({ defaultOgImage: res.file.url }); message.success('Image uploaded'); }
                    } catch { message.error('Upload failed'); }
                    return false;
                  }}>
                    <Button size="small" icon={<UploadOutlined />} type="link">Upload</Button>
                  </Upload>
                } />
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {({ getFieldValue }) => {
                  const url = getFieldValue('defaultOgImage');
                  return url ? (
                    <div style={{ border: `1px solid ${hairline(isDark)}`, borderRadius: 8, overflow: 'hidden', marginTop: 8 }}>
                      <img src={url} alt="OG Preview" style={{ width: '100%', display: 'block' }} />
                      <div style={{ padding: '8px 12px', background: STATUS_COLORS.neutral.bg(isDark), fontSize: 12, color: muted(isDark) }}>
                        Recommended: 1200 x 630 pixels
                      </div>
                    </div>
                  ) : null;
                }}
              </Form.Item>
            </Card>

            {/* Schema / Structured Data */}
            <Card title="Structured Data" style={{ marginTop: 16 }} loading={loading}>
              <Form.Item
                name="enableSchemaMarkup"
                label="Enable Schema Markup (JSON-LD)"
                valuePropName="checked"
                help="Adds Organization, WebSite, Article, and BreadcrumbList schemas automatically"
              >
                <Switch />
              </Form.Item>
            </Card>

            {/* Social Profiles */}
            <Card title="Social Profiles" style={{ marginTop: 16 }} loading={loading}>
              <Paragraph type="secondary">
                Used in Organization schema markup and Open Graph tags for social sharing.
              </Paragraph>
              <Form.Item name="twitter" label="Twitter / X Handle">
                <Input placeholder="@yourhandle" />
              </Form.Item>
              <Form.Item name="facebook" label="Facebook URL">
                <Input placeholder="https://facebook.com/yourpage" />
              </Form.Item>
              <Form.Item name="linkedin" label="LinkedIn URL">
                <Input placeholder="https://linkedin.com/company/yourcompany" />
              </Form.Item>
              <Form.Item name="instagram" label="Instagram URL">
                <Input placeholder="https://instagram.com/yourhandle" />
              </Form.Item>
              <Form.Item name="youtube" label="YouTube URL">
                <Input placeholder="https://youtube.com/@yourchannel" />
              </Form.Item>
            </Card>
          </Col>
        </Row>

        <div style={{ marginTop: 24, textAlign: 'right' }}>
          <PermissionGuard permission={PERMISSIONS.SETTINGS_EDIT}>
            <Button
              type="primary"
              size="large"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={handleSave}
            >
              Save SEO Settings
            </Button>
          </PermissionGuard>
        </div>
      </Form>
    </div>
  );
};

export default SeoSettingsPage;
