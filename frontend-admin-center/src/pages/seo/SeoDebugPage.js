import React, { useState } from 'react';
import {
  Card, Input, Button, Typography, Row, Col, Tag, Alert, Descriptions, Space, Divider, Empty, message,
} from 'antd';
import {
  SearchOutlined, CheckCircleOutlined, CloseCircleOutlined, WarningOutlined,
  GlobalOutlined, FileSearchOutlined, LinkOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import seoApi from '../../api/seoApi';
import { useTheme } from '../../contexts/ThemeContext';
import { STATUS_COLORS, hairline } from '../../theme/colors';

const { Text, Title, Paragraph } = Typography;

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
const MARKETING_URL = process.env.REACT_APP_MARKETING_URL || 'http://localhost:3000';

const scoreTier = (score) => (score >= 80 ? 'success' : score >= 50 ? 'warning' : 'error');

const SeoDebugPage = () => {
  const [url, setUrl] = useState(MARKETING_URL);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [sitemapData, setSitemapData] = useState(null);
  const [robotsData, setRobotsData] = useState(null);
  const [redirectTest, setRedirectTest] = useState({ path: '', result: null });
  const { isDark } = useTheme();
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];
  const warning = STATUS_COLORS.warning[isDark ? 'dark' : 'light'];
  const error = STATUS_COLORS.error[isDark ? 'dark' : 'light'];

  const fetchAndParse = async () => {
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch(url);
      const html = await response.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Extract meta tags
      const metas = {};
      doc.querySelectorAll('meta').forEach(m => {
        const name = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv');
        if (name) metas[name] = m.getAttribute('content');
      });

      // Extract title
      const title = doc.querySelector('title')?.textContent || '';

      // Extract link tags
      const links = {};
      doc.querySelectorAll('link').forEach(l => {
        const rel = l.getAttribute('rel');
        if (rel) links[rel] = l.getAttribute('href');
      });

      // Extract JSON-LD
      const jsonLd = [];
      doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try { jsonLd.push(JSON.parse(s.textContent)); } catch { }
      });

      // Score the SEO
      const issues = [];
      const passes = [];

      if (title) passes.push('Page title is set');
      else issues.push('Missing page title');

      if (title && title.length >= 30 && title.length <= 60) passes.push(`Title length is optimal (${title.length} chars)`);
      else if (title) issues.push(`Title length ${title.length} chars (recommended: 30-60)`);

      if (metas.description) passes.push('Meta description is set');
      else issues.push('Missing meta description');

      if (metas.description && metas.description.length >= 120 && metas.description.length <= 160) passes.push(`Description length optimal (${metas.description.length} chars)`);
      else if (metas.description) issues.push(`Description length ${metas.description.length} chars (recommended: 120-160)`);

      if (metas['og:title']) passes.push('OG Title is set');
      else issues.push('Missing og:title');

      if (metas['og:description']) passes.push('OG Description is set');
      else issues.push('Missing og:description');

      if (metas['og:image']) passes.push('OG Image is set');
      else issues.push('Missing og:image — set a Default OG Image in SEO Settings');

      if (metas['og:url']) passes.push('OG URL is set');
      else issues.push('Missing og:url');

      if (metas['twitter:card']) passes.push('Twitter card is set');
      else issues.push('Missing twitter:card');

      if (links.canonical) passes.push('Canonical URL is set');
      else issues.push('Missing canonical link');

      if (jsonLd.length > 0) passes.push(`${jsonLd.length} JSON-LD schema(s) found`);
      else issues.push('No structured data (JSON-LD) found');

      if (metas['theme-color']) passes.push('Theme color is set');

      const score = Math.round((passes.length / (passes.length + issues.length)) * 100);

      setResult({ title, metas, links, jsonLd, issues, passes, score, status: response.status });
    } catch (err) {
      message.error('Failed to fetch page: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchSitemap = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/public/seo/sitemap.xml`);
      const text = await res.text();
      setSitemapData(text);
    } catch {
      message.error('Failed to fetch sitemap');
    }
  };

  const fetchRobots = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/public/seo/robots.txt`);
      const text = await res.text();
      setRobotsData(text);
    } catch {
      message.error('Failed to fetch robots.txt');
    }
  };

  const testRedirect = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/public/seo/check-redirect?path=${encodeURIComponent(redirectTest.path)}`);
      const data = await res.json();
      setRedirectTest(prev => ({ ...prev, result: data }));
    } catch {
      message.error('Failed to test redirect');
    }
  };

  return (
    <div>
      <PageHeader
        title="SEO Debug & Test"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Website' }, { label: 'SEO Debug' }]}
      />

      <Alert
        message="SEO Debug Tool"
        description="Test and verify that your SEO meta tags, structured data, OG images, sitemaps, and redirects are working correctly — even on localhost."
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      {/* Page SEO Analyzer */}
      <Card title={<><FileSearchOutlined /> Page SEO Analyzer</>} style={{ marginBottom: 16 }}>
        <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter page URL to analyze..."
            prefix={<GlobalOutlined />}
            onPressEnter={fetchAndParse}
          />
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={fetchAndParse}>
            Analyze
          </Button>
        </Space.Compact>

        <Space wrap style={{ marginBottom: 12 }}>
          <Button size="small" onClick={() => setUrl(MARKETING_URL)}>Homepage</Button>
          <Button size="small" onClick={() => setUrl(`${MARKETING_URL}/blog`)}>Blog</Button>
          <Button size="small" onClick={() => setUrl(`${MARKETING_URL}/features`)}>Features</Button>
          <Button size="small" onClick={() => setUrl(`${MARKETING_URL}/pricing`)}>Pricing</Button>
          <Button size="small" onClick={() => setUrl(`${MARKETING_URL}/contact`)}>Contact</Button>
        </Space>

        {result && (
          <>
            <Divider />
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={4}>
                <div style={{
                  textAlign: 'center', padding: 16, borderRadius: 12,
                  background: STATUS_COLORS[scoreTier(result.score)].bg(isDark),
                  border: `1px solid ${hairline(isDark)}`,
                }}>
                  <div style={{ fontSize: 36, fontWeight: 700, color: STATUS_COLORS[scoreTier(result.score)][isDark ? 'dark' : 'light'] }}>
                    {result.score}
                  </div>
                  <Text type="secondary">SEO Score</Text>
                </div>
              </Col>
              <Col span={20}>
                <Descriptions bordered size="small" column={1}>
                  <Descriptions.Item label="Page Title">{result.title || <Text type="danger">Missing</Text>}</Descriptions.Item>
                  <Descriptions.Item label="Meta Description">{result.metas?.description || <Text type="danger">Missing</Text>}</Descriptions.Item>
                  <Descriptions.Item label="OG Title">{result.metas?.['og:title'] || <Text type="warning">Not set</Text>}</Descriptions.Item>
                  <Descriptions.Item label="OG Description">{result.metas?.['og:description'] || <Text type="warning">Not set</Text>}</Descriptions.Item>
                  <Descriptions.Item label="OG Image">
                    {result.metas?.['og:image'] ? (
                      <Space>
                        <a href={result.metas['og:image']} target="_blank" rel="noopener noreferrer">{result.metas['og:image']}</a>
                      </Space>
                    ) : <Text type="warning">Not set</Text>}
                  </Descriptions.Item>
                  <Descriptions.Item label="Canonical">{result.links?.canonical || <Text type="warning">Not set</Text>}</Descriptions.Item>
                  <Descriptions.Item label="Theme Color">{result.metas?.['theme-color'] || '—'}</Descriptions.Item>
                </Descriptions>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Card size="small" title={<><CheckCircleOutlined style={{ color: success }} /> Passes ({result.passes.length})</>}>
                  {result.passes.map((p, i) => (
                    <div key={i} style={{ padding: '4px 0' }}>
                      <CheckCircleOutlined style={{ color: success, marginRight: 8 }} />{p}
                    </div>
                  ))}
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" title={<><WarningOutlined style={{ color: warning }} /> Issues ({result.issues.length})</>}>
                  {result.issues.map((issue, i) => (
                    <div key={i} style={{ padding: '4px 0' }}>
                      <CloseCircleOutlined style={{ color: error, marginRight: 8 }} />{issue}
                    </div>
                  ))}
                  {result.issues.length === 0 && <Text type="success">No issues found!</Text>}
                </Card>
              </Col>
            </Row>

            {result.jsonLd.length > 0 && (
              <Card size="small" title="Structured Data (JSON-LD)" style={{ marginTop: 16 }}>
                <pre style={{ maxHeight: 300, overflow: 'auto', background: STATUS_COLORS.neutral.bg(isDark), padding: 12, borderRadius: 8, fontSize: 12 }}>
                  {JSON.stringify(result.jsonLd, null, 2)}
                </pre>
              </Card>
            )}

            <Card size="small" title="All Meta Tags" style={{ marginTop: 16 }}>
              <Descriptions bordered size="small" column={1}>
                {Object.entries(result.metas).map(([key, val]) => (
                  <Descriptions.Item key={key} label={key}>{val}</Descriptions.Item>
                ))}
              </Descriptions>
            </Card>
          </>
        )}
      </Card>

      <Row gutter={16}>
        {/* Sitemap */}
        <Col xs={24} lg={12}>
          <Card
            title={<><GlobalOutlined /> Sitemap</>}
            style={{ marginBottom: 16 }}
            extra={<Button size="small" onClick={fetchSitemap}>Load Sitemap</Button>}
          >
            {sitemapData ? (
              <pre style={{ maxHeight: 400, overflow: 'auto', background: STATUS_COLORS.neutral.bg(isDark), padding: 12, borderRadius: 8, fontSize: 11, whiteSpace: 'pre-wrap' }}>
                {sitemapData}
              </pre>
            ) : (
              <Empty description="Click 'Load Sitemap' to fetch and preview your sitemap.xml" />
            )}
          </Card>
        </Col>

        {/* Robots.txt */}
        <Col xs={24} lg={12}>
          <Card
            title={<><FileSearchOutlined /> robots.txt</>}
            style={{ marginBottom: 16 }}
            extra={<Button size="small" onClick={fetchRobots}>Load robots.txt</Button>}
          >
            {robotsData ? (
              <pre style={{ maxHeight: 400, overflow: 'auto', background: STATUS_COLORS.neutral.bg(isDark), padding: 12, borderRadius: 8, fontSize: 11 }}>
                {robotsData}
              </pre>
            ) : (
              <Empty description="Click 'Load robots.txt' to fetch and preview" />
            )}
          </Card>
        </Col>
      </Row>

      {/* Redirect Tester */}
      <Card title={<><LinkOutlined /> Redirect Tester</>}>
        <Paragraph type="secondary">
          Test if a URL path has an active redirect configured. Enter the source path (e.g., /old-page) to check.
        </Paragraph>
        <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
          <Input
            value={redirectTest.path}
            onChange={(e) => setRedirectTest({ path: e.target.value, result: null })}
            placeholder="/old-page-path"
            onPressEnter={testRedirect}
          />
          <Button type="primary" onClick={testRedirect}>Test Redirect</Button>
        </Space.Compact>

        {redirectTest.result && (
          <Card size="small">
            {redirectTest.result.success && redirectTest.result.redirect ? (
              <Descriptions bordered size="small" column={1}>
                <Descriptions.Item label="Status">
                  <Tag color="green">Redirect Found</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="From">{redirectTest.path}</Descriptions.Item>
                <Descriptions.Item label="To">{redirectTest.result.redirect.toPath}</Descriptions.Item>
                <Descriptions.Item label="Status Code">
                  <Tag color="blue">{redirectTest.result.redirect.statusCode}</Tag>
                </Descriptions.Item>
              </Descriptions>
            ) : (
              <Alert message="No redirect found for this path" type="warning" showIcon />
            )}
          </Card>
        )}
      </Card>
    </div>
  );
};

export default SeoDebugPage;
