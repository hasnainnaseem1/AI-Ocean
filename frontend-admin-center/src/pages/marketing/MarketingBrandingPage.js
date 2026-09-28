import React, { useState, useEffect } from 'react';
import {
  Card, Form, Input, Button, message, Row, Col, Divider, Typography, Alert, Upload, Space, Switch,
} from 'antd';
import {
  SaveOutlined, GlobalOutlined, UploadOutlined, DeleteOutlined, PlusOutlined, LinkOutlined,
  TwitterOutlined, FacebookOutlined, LinkedinOutlined, InstagramOutlined, YoutubeOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import settingsApi from '../../api/settingsApi';
import seoApi from '../../api/seoApi';
import uploadApi from '../../api/uploadApi';
import { useTheme } from '../../contexts/ThemeContext';
import { STATUS_COLORS } from '../../theme/colors';

const { Text } = Typography;

const MarketingBrandingPage = () => {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(false);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [savingSocial, setSavingSocial] = useState(false);
  const [customLinks, setCustomLinks] = useState([]);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  const [generalForm] = Form.useForm();
  const [themeForm] = Form.useForm();
  const [socialForm] = Form.useForm();

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      try {
        const [settingsData, seoData] = await Promise.all([
          settingsApi.getSettings(),
          seoApi.getSettings(),
        ]);
        const s = settingsData.settings || {};
        const seo = seoData.seoSettings || seoData.seo || {};

        // General / SEO fields
        generalForm.setFieldsValue({
          siteName: s.siteName,
          siteDescription: s.siteDescription,
          contactEmail: s.contactEmail,
          supportEmail: s.supportEmail,
        });

        // Theme fields
        themeForm.setFieldsValue(s.themeSettings || {});

        // Social links (from SEO settings)
        const enabled = seo.socialLinksEnabled || {};
        socialForm.setFieldsValue({
          twitter: seo.socialLinks?.twitter || '',
          facebook: seo.socialLinks?.facebook || '',
          linkedin: seo.socialLinks?.linkedin || '',
          instagram: seo.socialLinks?.instagram || '',
          youtube: seo.socialLinks?.youtube || '',
          twitterEnabled: enabled.twitter !== false,
          facebookEnabled: enabled.facebook !== false,
          linkedinEnabled: enabled.linkedin !== false,
          instagramEnabled: enabled.instagram !== false,
          youtubeEnabled: enabled.youtube !== false,
        });

        // Custom social links
        setCustomLinks((seo.customSocialLinks || []).map((l, i) => ({ ...l, _key: Date.now() + i })));
      } catch {
        message.error('Failed to load branding settings');
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, [generalForm, themeForm, socialForm]);

  const handleSaveGeneral = async () => {
    try {
      const values = await generalForm.validateFields();
      setSavingGeneral(true);
      await settingsApi.updateGeneral(values);
      message.success('Site info saved');
    } catch (err) {
      if (err.errorFields) return;
      message.error('Failed to save');
    } finally {
      setSavingGeneral(false);
    }
  };

  const handleSaveTheme = async () => {
    try {
      const values = await themeForm.validateFields();
      setSavingTheme(true);
      await settingsApi.updateTheme(values);
      message.success('Theme & branding saved');
    } catch (err) {
      if (err.errorFields) return;
      message.error('Failed to save');
    } finally {
      setSavingTheme(false);
    }
  };

  const handleSaveSocial = async () => {
    try {
      const values = await socialForm.validateFields();
      setSavingSocial(true);
      // Save social links through the SEO settings endpoint
      await seoApi.updateSettings({
        socialLinks: {
          twitter: values.twitter || '',
          facebook: values.facebook || '',
          linkedin: values.linkedin || '',
          instagram: values.instagram || '',
          youtube: values.youtube || '',
        },
        socialLinksEnabled: {
          twitter: values.twitterEnabled !== false,
          facebook: values.facebookEnabled !== false,
          linkedin: values.linkedinEnabled !== false,
          instagram: values.instagramEnabled !== false,
          youtube: values.youtubeEnabled !== false,
        },
        customSocialLinks: customLinks
          .filter(({ name, url }) => name?.trim() || url?.trim())
          .map(({ _key, ...rest }) => rest),
      });
      message.success('Social links saved');
    } catch (err) {
      if (err.errorFields) return;
      message.error('Failed to save social links');
    } finally {
      setSavingSocial(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Branding"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Website' }, { label: 'Branding' }]}
      />

      <Alert
        message="These settings control the branding across your entire platform (marketing website, admin center, and customer center). Changes are reflected after the page refreshes."
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        icon={<GlobalOutlined />}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title="Site Information"
            loading={loading}
            extra={<Text type="secondary" style={{ fontSize: 12 }}>SEO & metadata</Text>}
          >
            <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
              Used for SEO meta tags, search engine indexing, and structured data. Not displayed directly on the site.
            </Text>
            <Form form={generalForm} layout="vertical">
              <Form.Item name="siteName" label="Site Name" rules={[{ required: true }]}>
                <Input placeholder="My Awesome SaaS" />
              </Form.Item>
              <Form.Item name="siteDescription" label="Site Description" help="Used in meta description & SEO. For visible description, use Application Description.">
                <Input.TextArea rows={3} placeholder="A brief description of your platform" />
              </Form.Item>
              <Form.Item name="contactEmail" label="Contact Email" rules={[{ type: 'email' }]}>
                <Input placeholder="hello@example.com" />
              </Form.Item>
              <Form.Item name="supportEmail" label="Support Email" rules={[{ type: 'email' }]}>
                <Input placeholder="support@example.com" />
              </Form.Item>
              <Button type="primary" icon={<SaveOutlined />} loading={savingGeneral} onClick={handleSaveGeneral}>
                Save Site Info
              </Button>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title="Application Identity"
            loading={loading}
            extra={<Text type="secondary" style={{ fontSize: 12 }}>Visible on site</Text>}
          >
            <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
              Shown on the marketing site header, footer, and across the platform. This is what visitors see.
            </Text>
            <Form form={themeForm} layout="vertical">
              <Form.Item name="appName" label="Application Name" help="Display name shown in the header and title bar">
                <Input placeholder="My Platform" />
              </Form.Item>
              <Form.Item name="appTagline" label="Application Tagline">
                <Input placeholder="Your Business Optimization Platform" />
              </Form.Item>
              <Form.Item name="appDescription" label="Application Description" help="Shown in the footer and hero sections of your marketing site">
                <Input.TextArea rows={2} placeholder="AI-powered business optimization platform" />
              </Form.Item>
              <Form.Item name="companyName" label="Company / Brand Name" help="Shown in the navbar, footer, and copyright notice">
                <Input placeholder="My Company" />
              </Form.Item>

              <Divider orientation="left" style={{ margin: '12px 0' }}>Visual Identity</Divider>

              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item name="primaryColor" label="Primary">
                    <Input type="color" style={{ width: 60, height: 36, padding: 4 }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="secondaryColor" label="Secondary">
                    <Input type="color" style={{ width: 60, height: 36, padding: 4 }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="accentColor" label="Accent">
                    <Input type="color" style={{ width: 60, height: 36, padding: 4 }} />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="logoUrl" label="Logo">
                <Input placeholder="https://example.com/logo.png" addonAfter={
                  <Upload
                    showUploadList={false}
                    accept="image/*"
                    beforeUpload={async (file) => {
                      try {
                        setUploadingLogo(true);
                        const res = await uploadApi.upload('logos', file);
                        if (res.success) {
                          themeForm.setFieldsValue({ logoUrl: res.file.url });
                          message.success('Logo uploaded');
                        }
                      } catch {
                        message.error('Upload failed');
                      } finally {
                        setUploadingLogo(false);
                      }
                      return false;
                    }}
                  >
                    <Button size="small" icon={<UploadOutlined />} loading={uploadingLogo} type="link">Upload</Button>
                  </Upload>
                } />
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {({ getFieldValue }) => {
                  const url = getFieldValue('logoUrl');
                  return url ? (
                    <div style={{ marginBottom: 12, padding: 8, background: STATUS_COLORS.neutral.bg(isDark), borderRadius: 8, textAlign: 'center' }}>
                      <img src={url} alt="Logo preview" style={{ maxHeight: 48 }} onError={(e) => { e.target.style.display = 'none'; }} />
                    </div>
                  ) : null;
                }}
              </Form.Item>
              <Form.Item name="faviconUrl" label="Favicon">
                <Input placeholder="https://example.com/favicon.ico" addonAfter={
                  <Upload
                    showUploadList={false}
                    accept="image/*,.ico"
                    beforeUpload={async (file) => {
                      try {
                        setUploadingFavicon(true);
                        const res = await uploadApi.upload('favicons', file);
                        if (res.success) {
                          themeForm.setFieldsValue({ faviconUrl: res.file.url });
                          message.success('Favicon uploaded');
                        }
                      } catch {
                        message.error('Upload failed');
                      } finally {
                        setUploadingFavicon(false);
                      }
                      return false;
                    }}
                  >
                    <Button size="small" icon={<UploadOutlined />} loading={uploadingFavicon} type="link">Upload</Button>
                  </Upload>
                } />
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {({ getFieldValue }) => {
                  const url = getFieldValue('faviconUrl');
                  return url ? (
                    <div style={{ marginBottom: 12, padding: 8, background: STATUS_COLORS.neutral.bg(isDark), borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <img src={url} alt="Favicon preview" style={{ width: 32, height: 32 }} onError={(e) => { e.target.style.display = 'none'; }} />
                      <Text type="secondary" style={{ fontSize: 12 }}>Favicon preview</Text>
                    </div>
                  ) : null;
                }}
              </Form.Item>

              <div style={{ marginTop: 12 }}>
                <Button type="primary" icon={<SaveOutlined />} loading={savingTheme} onClick={handleSaveTheme}>
                  Save Branding
                </Button>
              </div>
            </Form>
          </Card>
        </Col>
      </Row>

      {/* Social Links */}
      <Card
        title="Social Links"
        loading={loading}
        style={{ marginTop: 16 }}
        extra={<Text type="secondary" style={{ fontSize: 12 }}>Displayed in website footer</Text>}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
          Add your social media profiles. These will appear as icons in your marketing site footer and are also used for SEO schema markup.
        </Text>
        <Form form={socialForm} layout="vertical">
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item label={<span><TwitterOutlined style={{ marginRight: 6 }} />Twitter / X</span>}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Form.Item name="twitterEnabled" valuePropName="checked" noStyle>
                    <Switch checkedChildren="Enabled" unCheckedChildren="Disabled" />
                  </Form.Item>
                  <Form.Item name="twitter" noStyle>
                    <Input placeholder="https://twitter.com/yourhandle" />
                  </Form.Item>
                </Space>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item label={<span><FacebookOutlined style={{ marginRight: 6 }} />Facebook</span>}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Form.Item name="facebookEnabled" valuePropName="checked" noStyle>
                    <Switch checkedChildren="Enabled" unCheckedChildren="Disabled" />
                  </Form.Item>
                  <Form.Item name="facebook" noStyle>
                    <Input placeholder="https://facebook.com/yourpage" />
                  </Form.Item>
                </Space>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item label={<span><LinkedinOutlined style={{ marginRight: 6 }} />LinkedIn</span>}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Form.Item name="linkedinEnabled" valuePropName="checked" noStyle>
                    <Switch checkedChildren="Enabled" unCheckedChildren="Disabled" />
                  </Form.Item>
                  <Form.Item name="linkedin" noStyle>
                    <Input placeholder="https://linkedin.com/company/you" />
                  </Form.Item>
                </Space>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item label={<span><InstagramOutlined style={{ marginRight: 6 }} />Instagram</span>}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Form.Item name="instagramEnabled" valuePropName="checked" noStyle>
                    <Switch checkedChildren="Enabled" unCheckedChildren="Disabled" />
                  </Form.Item>
                  <Form.Item name="instagram" noStyle>
                    <Input placeholder="https://instagram.com/yourhandle" />
                  </Form.Item>
                </Space>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item label={<span><YoutubeOutlined style={{ marginRight: 6 }} />YouTube</span>}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Form.Item name="youtubeEnabled" valuePropName="checked" noStyle>
                    <Switch checkedChildren="Enabled" unCheckedChildren="Disabled" />
                  </Form.Item>
                  <Form.Item name="youtube" noStyle>
                    <Input placeholder="https://youtube.com/@yourchannel" />
                  </Form.Item>
                </Space>
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" icon={<SaveOutlined />} loading={savingSocial} onClick={handleSaveSocial}>
            Save Social Links
          </Button>
        </Form>

        <Divider orientation="left" style={{ marginTop: 24 }}>Custom Social Links</Divider>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
          Add custom social profiles with your own icon image. Upload a square icon (recommended 64×64px) for best results.
        </Text>

        {customLinks.map((link, index) => (
          <Card
            key={link._key}
            size="small"
            style={{ marginBottom: 12 }}
            extra={
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => setCustomLinks(prev => prev.filter((_, i) => i !== index))}
              />
            }
          >
            <Row gutter={[12, 8]} align="middle">
              <Col xs={24} sm={4}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Switch
                    checkedChildren="On"
                    unCheckedChildren="Off"
                    checked={link.enabled}
                    onChange={(checked) => setCustomLinks(prev => prev.map((l, i) => i === index ? { ...l, enabled: checked } : l))}
                  />
                  {link.iconUrl && (
                    <img src={link.iconUrl} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} onError={(e) => { e.target.style.display = 'none'; }} />
                  )}
                </div>
              </Col>
              <Col xs={24} sm={5}>
                <Input
                  placeholder="Label (e.g. TikTok)"
                  value={link.name}
                  onChange={(e) => setCustomLinks(prev => prev.map((l, i) => i === index ? { ...l, name: e.target.value } : l))}
                />
              </Col>
              <Col xs={24} sm={8}>
                <Input
                  placeholder="https://tiktok.com/@handle"
                  value={link.url}
                  prefix={<LinkOutlined />}
                  onChange={(e) => setCustomLinks(prev => prev.map((l, i) => i === index ? { ...l, url: e.target.value } : l))}
                />
              </Col>
              <Col xs={24} sm={7}>
                <Input
                  placeholder="Icon image URL"
                  value={link.iconUrl}
                  onChange={(e) => setCustomLinks(prev => prev.map((l, i) => i === index ? { ...l, iconUrl: e.target.value } : l))}
                  addonAfter={
                    <Upload
                      showUploadList={false}
                      accept="image/*"
                      beforeUpload={async (file) => {
                        try {
                          const res = await uploadApi.upload('social-icons', file);
                          if (res.success) {
                            setCustomLinks(prev => prev.map((l, i) => i === index ? { ...l, iconUrl: res.file.url } : l));
                            message.success('Icon uploaded');
                          }
                        } catch {
                          message.error('Upload failed');
                        }
                        return false;
                      }}
                    >
                      <Button size="small" icon={<UploadOutlined />} type="link">Upload</Button>
                    </Upload>
                  }
                />
              </Col>
            </Row>
          </Card>
        ))}

        <Button
          type="dashed"
          block
          icon={<PlusOutlined />}
          style={{ marginBottom: 16 }}
          onClick={() => setCustomLinks(prev => [...prev, { name: '', url: '', iconUrl: '', enabled: true, _key: Date.now() }])}
        >
          Add Custom Social Link
        </Button>

        <Button type="primary" icon={<SaveOutlined />} loading={savingSocial} onClick={handleSaveSocial}>
          Save All Social Links
        </Button>
      </Card>
    </div>
  );
};

export default MarketingBrandingPage;
