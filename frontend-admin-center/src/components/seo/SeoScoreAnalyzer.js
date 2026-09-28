import React, { useMemo } from 'react';
import { Card, Progress, Tag, Typography, Space, Divider, List } from 'antd';
import {
  CheckCircleOutlined, WarningOutlined, CloseCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { useTheme } from '../../contexts/ThemeContext';
import { STATUS_COLORS, TILE } from '../../theme/colors';

const { Text, Title } = Typography;

/**
 * SeoScoreAnalyzer — Real-time SEO content audit panel.
 *
 * Props:
 *   title       - string  (meta title / SEO title)
 *   description - string  (meta description / SEO description)
 *   slug        - string  (URL slug)
 *   content     - string  (main body content, can be HTML)
 *   keywords    - string  (comma-separated keywords)
 *   ogImage     - string  (OG image URL)
 *   canonicalUrl- string  (canonical URL)
 *   focusKeyword- string  (optional primary focus keyword)
 */
const SeoScoreAnalyzer = ({
  title = '',
  description = '',
  slug = '',
  content = '',
  keywords = '',
  ogImage = '',
  canonicalUrl = '',
  focusKeyword = '',
}) => {
  const analysis = useMemo(() => {
    const checks = [];

    // Strip HTML from content for text analysis
    const plainContent = content.replace(/<[^>]*>/g, '').trim();
    const wordCount = plainContent ? plainContent.split(/\s+/).length : 0;

    // ── Title checks ──
    const titleLen = title.length;
    if (titleLen === 0) {
      checks.push({ id: 'title-missing', label: 'Meta title is missing', status: 'error', weight: 15 });
    } else if (titleLen < 30) {
      checks.push({ id: 'title-short', label: `Title is too short (${titleLen} chars) — aim for 50-60`, status: 'warning', weight: 10 });
    } else if (titleLen > 60) {
      checks.push({ id: 'title-long', label: `Title is too long (${titleLen} chars) — max 60`, status: 'warning', weight: 5 });
    } else {
      checks.push({ id: 'title-good', label: `Title length is ideal (${titleLen} chars)`, status: 'success', weight: 15 });
    }

    // ── Description checks ──
    const descLen = description.length;
    if (descLen === 0) {
      checks.push({ id: 'desc-missing', label: 'Meta description is missing', status: 'error', weight: 12 });
    } else if (descLen < 120) {
      checks.push({ id: 'desc-short', label: `Description is short (${descLen} chars) — aim for 150-160`, status: 'warning', weight: 8 });
    } else if (descLen > 160) {
      checks.push({ id: 'desc-long', label: `Description is too long (${descLen} chars) — max 160`, status: 'warning', weight: 5 });
    } else {
      checks.push({ id: 'desc-good', label: `Description length is ideal (${descLen} chars)`, status: 'success', weight: 12 });
    }

    // ── Slug checks ──
    if (!slug) {
      checks.push({ id: 'slug-missing', label: 'URL slug is missing', status: 'error', weight: 8 });
    } else if (/[A-Z]/.test(slug)) {
      checks.push({ id: 'slug-uppercase', label: 'Slug contains uppercase letters', status: 'warning', weight: 4 });
    } else if (slug.length > 75) {
      checks.push({ id: 'slug-long', label: 'Slug is very long — keep under 75 chars', status: 'warning', weight: 3 });
    } else if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      checks.push({ id: 'slug-good', label: 'URL slug is SEO-friendly', status: 'success', weight: 8 });
    } else {
      checks.push({ id: 'slug-ok', label: 'Slug is usable but could be cleaner', status: 'info', weight: 6 });
    }

    // ── Content length ──
    if (wordCount === 0) {
      checks.push({ id: 'content-empty', label: 'No content detected', status: 'error', weight: 15 });
    } else if (wordCount < 100) {
      checks.push({ id: 'content-thin', label: `Content is very thin (${wordCount} words) — aim for 300+`, status: 'warning', weight: 10 });
    } else if (wordCount < 300) {
      checks.push({ id: 'content-short', label: `Content is a bit short (${wordCount} words) — aim for 600+`, status: 'warning', weight: 8 });
    } else {
      checks.push({ id: 'content-good', label: `Good content length (${wordCount} words)`, status: 'success', weight: 15 });
    }

    // ── OG Image ──
    if (ogImage) {
      checks.push({ id: 'og-image', label: 'OG image is set', status: 'success', weight: 8 });
    } else {
      checks.push({ id: 'og-image-missing', label: 'OG image is not set — uses default', status: 'warning', weight: 5 });
    }

    // ── Canonical URL ──
    if (canonicalUrl) {
      checks.push({ id: 'canonical', label: 'Canonical URL is set', status: 'success', weight: 5 });
    } else {
      checks.push({ id: 'canonical-info', label: 'No canonical URL — auto-generated URL will be used', status: 'info', weight: 3 });
    }

    // ── Keywords ──
    const keywordList = keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : [];
    if (keywordList.length === 0) {
      checks.push({ id: 'keywords-missing', label: 'No keywords specified', status: 'warning', weight: 5 });
    } else if (keywordList.length > 10) {
      checks.push({ id: 'keywords-many', label: 'Too many keywords — focus on 3-5', status: 'warning', weight: 3 });
    } else {
      checks.push({ id: 'keywords-good', label: `${keywordList.length} keyword(s) set`, status: 'success', weight: 5 });
    }

    // ── Focus keyword in title ──
    if (focusKeyword && title) {
      if (title.toLowerCase().includes(focusKeyword.toLowerCase())) {
        checks.push({ id: 'fk-title', label: 'Focus keyword appears in title', status: 'success', weight: 8 });
      } else {
        checks.push({ id: 'fk-title-missing', label: 'Focus keyword not found in title', status: 'warning', weight: 5 });
      }
    }

    // ── Focus keyword in description ──
    if (focusKeyword && description) {
      if (description.toLowerCase().includes(focusKeyword.toLowerCase())) {
        checks.push({ id: 'fk-desc', label: 'Focus keyword appears in description', status: 'success', weight: 5 });
      } else {
        checks.push({ id: 'fk-desc-missing', label: 'Focus keyword not found in description', status: 'warning', weight: 3 });
      }
    }

    // ── Focus keyword in slug ──
    if (focusKeyword && slug) {
      const fkSlug = focusKeyword.toLowerCase().replace(/\s+/g, '-');
      if (slug.toLowerCase().includes(fkSlug)) {
        checks.push({ id: 'fk-slug', label: 'Focus keyword appears in URL slug', status: 'success', weight: 5 });
      } else {
        checks.push({ id: 'fk-slug-missing', label: 'Focus keyword not found in URL slug', status: 'info', weight: 2 });
      }
    }

    // ── Focus keyword in content ──
    if (focusKeyword && plainContent) {
      const fkLower = focusKeyword.toLowerCase();
      const contentLower = plainContent.toLowerCase();
      const occurrences = contentLower.split(fkLower).length - 1;
      if (occurrences === 0) {
        checks.push({ id: 'fk-content', label: 'Focus keyword not found in content', status: 'error', weight: 8 });
      } else {
        const density = ((occurrences / wordCount) * 100).toFixed(1);
        if (density > 3) {
          checks.push({ id: 'fk-density-high', label: `Keyword density is too high (${density}%)`, status: 'warning', weight: 5 });
        } else {
          checks.push({ id: 'fk-content-good', label: `Focus keyword appears ${occurrences}x (${density}% density)`, status: 'success', weight: 8 });
        }
      }
    }

    // ── H1 in content ──
    if (content) {
      const h1Count = (content.match(/<h1[\s>]/gi) || []).length;
      if (h1Count === 0) {
        checks.push({ id: 'h1-missing', label: 'No H1 heading found in content', status: 'info', weight: 3 });
      } else if (h1Count > 1) {
        checks.push({ id: 'h1-multi', label: `Multiple H1 tags found (${h1Count}) — use only one`, status: 'warning', weight: 3 });
      } else {
        checks.push({ id: 'h1-good', label: 'Content has one H1 heading', status: 'success', weight: 5 });
      }
    }

    // ── Internal links in content ──
    if (content) {
      const linkCount = (content.match(/<a\s/gi) || []).length;
      if (linkCount === 0 && wordCount > 100) {
        checks.push({ id: 'links-missing', label: 'No links found in content', status: 'info', weight: 2 });
      } else if (linkCount > 0) {
        checks.push({ id: 'links-good', label: `Content has ${linkCount} link(s)`, status: 'success', weight: 3 });
      }
    }

    // ── Image alt text ──
    if (content) {
      const imgs = content.match(/<img[^>]*>/gi) || [];
      const noAlt = imgs.filter(img => !img.includes('alt=')).length;
      if (imgs.length > 0 && noAlt > 0) {
        checks.push({ id: 'img-alt', label: `${noAlt} image(s) missing alt text`, status: 'warning', weight: 3 });
      } else if (imgs.length > 0) {
        checks.push({ id: 'img-alt-good', label: 'All images have alt text', status: 'success', weight: 3 });
      }
    }

    // Calculate score
    const maxWeight = checks.reduce((sum, c) => sum + c.weight, 0);
    const earnedWeight = checks
      .filter(c => c.status === 'success')
      .reduce((sum, c) => sum + c.weight, 0);
    // Info items count as partial
    const infoWeight = checks
      .filter(c => c.status === 'info')
      .reduce((sum, c) => sum + c.weight * 0.5, 0);

    const score = maxWeight > 0 ? Math.round(((earnedWeight + infoWeight) / maxWeight) * 100) : 0;

    return { checks, score, wordCount };
  }, [title, description, slug, content, keywords, ogImage, canonicalUrl, focusKeyword]);

  const { isDark } = useTheme();
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];
  const warning = STATUS_COLORS.warning[isDark ? 'dark' : 'light'];
  const error = STATUS_COLORS.error[isDark ? 'dark' : 'light'];
  const info = TILE.blue.fg(isDark);

  const getScoreColor = (score) => {
    if (score >= 80) return success;
    if (score >= 50) return warning;
    return error;
  };

  const getScoreLabel = (score) => {
    if (score >= 80) return 'Good';
    if (score >= 50) return 'Needs Work';
    return 'Poor';
  };

  const statusIcons = {
    success: <CheckCircleOutlined style={{ color: success }} />,
    warning: <WarningOutlined style={{ color: warning }} />,
    error: <CloseCircleOutlined style={{ color: error }} />,
    info: <InfoCircleOutlined style={{ color: info }} />,
  };

  const errors = analysis.checks.filter(c => c.status === 'error');
  const warnings = analysis.checks.filter(c => c.status === 'warning');
  const successes = analysis.checks.filter(c => c.status === 'success');

  return (
    <Card
      size="small"
      title={
        <Space>
          <span>SEO Score</span>
          <Tag color={getScoreColor(analysis.score)} style={{ marginLeft: 8 }}>
            {analysis.score}/100 — {getScoreLabel(analysis.score)}
          </Tag>
        </Space>
      }
    >
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <Progress
          type="circle"
          percent={analysis.score}
          size={80}
          strokeColor={getScoreColor(analysis.score)}
          format={(p) => `${p}`}
        />
        <div style={{ marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {analysis.wordCount} words
            {focusKeyword ? ` · Focus: "${focusKeyword}"` : ''}
          </Text>
        </div>
      </div>

      <Divider style={{ margin: '8px 0' }} />

      {/* Issues */}
      {errors.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Text strong style={{ color: error, fontSize: 12 }}>Issues ({errors.length})</Text>
          <List
            size="small"
            dataSource={errors}
            renderItem={(item) => (
              <List.Item style={{ padding: '4px 0', border: 'none' }}>
                <Space size={6}>
                  {statusIcons.error}
                  <Text style={{ fontSize: 12 }}>{item.label}</Text>
                </Space>
              </List.Item>
            )}
          />
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Text strong style={{ color: warning, fontSize: 12 }}>Warnings ({warnings.length})</Text>
          <List
            size="small"
            dataSource={warnings}
            renderItem={(item) => (
              <List.Item style={{ padding: '4px 0', border: 'none' }}>
                <Space size={6}>
                  {statusIcons.warning}
                  <Text style={{ fontSize: 12 }}>{item.label}</Text>
                </Space>
              </List.Item>
            )}
          />
        </div>
      )}

      {/* Passed */}
      {successes.length > 0 && (
        <div>
          <Text strong style={{ color: success, fontSize: 12 }}>Passed ({successes.length})</Text>
          <List
            size="small"
            dataSource={successes}
            renderItem={(item) => (
              <List.Item style={{ padding: '4px 0', border: 'none' }}>
                <Space size={6}>
                  {statusIcons.success}
                  <Text style={{ fontSize: 12 }}>{item.label}</Text>
                </Space>
              </List.Item>
            )}
          />
        </div>
      )}
    </Card>
  );
};

export default SeoScoreAnalyzer;
