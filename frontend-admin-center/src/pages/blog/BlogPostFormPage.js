import React, { useState, useEffect } from 'react';
import {
  Card, Form, Input, Button, Select, Switch, message,
  Space, Typography, Row, Col, Divider, Tag, Upload
} from 'antd';
import { ArrowLeftOutlined, SaveOutlined, EyeOutlined, UploadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import blogApi from '../../api/blogApi';
import uploadApi from '../../api/uploadApi';
import SeoScoreAnalyzer from '../../components/seo/SeoScoreAnalyzer';

const { Title } = Typography;
const { TextArea } = Input;
const { Option } = Select;

const BlogPostFormPage = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState([]);
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  useEffect(() => {
    fetchCategories();
    if (isEdit) fetchPost();
  }, [id]);

  const fetchPost = async () => {
    setLoading(true);
    try {
      const res = await blogApi.getPost(id);
      if (res.success) {
        const post = res.post;
        form.setFieldsValue({
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          content: post.content,
          featuredImage: post.featuredImage,
          category: post.category,
          status: post.status,
          isFeatured: post.isFeatured,
          authorName: post.authorName,
          seoTitle: post.seoTitle,
          seoDescription: post.seoDescription,
          ogImage: post.ogImage || '',
          canonicalUrl: post.canonicalUrl || '',
          noIndex: post.noIndex || false,
        });
        setTags(post.tags || []);
      }
    } catch (err) {
      message.error('Failed to load post');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await blogApi.getCategories();
      if (res.success) setCategories(res.categories);
    } catch (err) {
      // silent
    }
  };

  const generateSlug = (title) => {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const handleTitleChange = (e) => {
    const title = e.target.value;
    if (!isEdit && !form.getFieldValue('slug')) {
      form.setFieldsValue({ slug: generateSlug(title) });
    }
  };

  const handleAddTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) {
      setTags([...tags, t]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tag) => {
    setTags(tags.filter(t => t !== tag));
  };

  const handleSubmit = async (values) => {
    setSaving(true);
    try {
      const data = { ...values, tags };
      if (isEdit) {
        await blogApi.updatePost(id, data);
        message.success('Post updated');
      } else {
        await blogApi.createPost(data);
        message.success('Post created');
      }
      navigate('/blog/posts');
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to save post');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/blog/posts')} style={{ marginRight: 12 }} />
        <Title level={3} style={{ margin: 0 }}>{isEdit ? 'Edit Post' : 'New Post'}</Title>
      </div>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          status: 'draft',
          category: 'General',
          isFeatured: false,
          authorName: 'Admin',
        }}
      >
        <Row gutter={24}>
          {/* Main Content */}
          <Col xs={24} lg={16}>
            <Card title="Post Content" loading={loading}>
              <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Title is required' }]}>
                <Input placeholder="Enter post title" size="large" onChange={handleTitleChange} />
              </Form.Item>

              <Form.Item name="slug" label="Slug" rules={[{ required: true, message: 'Slug is required' }]}>
                <Input placeholder="post-url-slug" addonBefore="/blog/" />
              </Form.Item>

              <Form.Item name="excerpt" label="Excerpt" help="Short description shown in blog listing (max 500 chars)">
                <TextArea rows={3} placeholder="Brief summary of the post..." maxLength={500} showCount />
              </Form.Item>

              <Form.Item name="content" label="Content" rules={[{ required: true, message: 'Content is required' }]}>
                <TextArea rows={16} placeholder="Write your blog post content here... (HTML supported)" />
              </Form.Item>
            </Card>

            <Card title="SEO" style={{ marginTop: 16 }}>
              <Form.Item name="seoTitle" label="SEO Title" help="Overrides the post title for search engines">
                <Input placeholder="SEO title (optional)" />
              </Form.Item>
              <Form.Item name="seoDescription" label="SEO Description">
                <TextArea rows={2} placeholder="Meta description for search engines (optional)" maxLength={160} showCount />
              </Form.Item>
              <Form.Item name="ogImage" label="OG Image URL" help="Custom image for social sharing (1200x630 recommended)">
                <Input placeholder="https://example.com/og-image.jpg" addonAfter={
                  <Upload showUploadList={false} accept="image/*" beforeUpload={async (file) => {
                    try {
                      const res = await uploadApi.upload('og-images', file);
                      if (res.success) { form.setFieldsValue({ ogImage: res.file.url }); message.success('OG Image uploaded'); }
                    } catch { message.error('Upload failed'); }
                    return false;
                  }}>
                    <Button size="small" icon={<UploadOutlined />} type="link">Upload</Button>
                  </Upload>
                } />
              </Form.Item>
              <Form.Item name="canonicalUrl" label="Canonical URL" help="Set only if this content exists elsewhere">
                <Input placeholder="https://example.com/original-post" />
              </Form.Item>
              <Form.Item name="noIndex" label="No Index" valuePropName="checked" help="Prevent search engines from indexing this post">
                <Switch />
              </Form.Item>
            </Card>
          </Col>

          {/* Sidebar */}
          <Col xs={24} lg={8}>
            {/* SEO Score Analyzer */}
            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) => (
                <div style={{ marginBottom: 16 }}>
                  <SeoScoreAnalyzer
                    title={getFieldValue('seoTitle') || getFieldValue('title') || ''}
                    description={getFieldValue('seoDescription') || getFieldValue('excerpt') || ''}
                    slug={getFieldValue('slug') || ''}
                    content={getFieldValue('content') || ''}
                    keywords={(tags || []).join(', ')}
                    ogImage={getFieldValue('ogImage') || getFieldValue('featuredImage') || ''}
                    canonicalUrl={getFieldValue('canonicalUrl') || ''}
                  />
                </div>
              )}
            </Form.Item>

            <Card title="Publish">
              <Form.Item name="status" label="Status">
                <Select>
                  <Option value="draft">Draft</Option>
                  <Option value="published">Published</Option>
                  <Option value="archived">Archived</Option>
                </Select>
              </Form.Item>

              <Form.Item name="isFeatured" label="Featured Post" valuePropName="checked">
                <Switch />
              </Form.Item>

              <Form.Item name="authorName" label="Author Name">
                <Input placeholder="Author name" />
              </Form.Item>

              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} block size="large">
                {isEdit ? 'Update Post' : 'Create Post'}
              </Button>
            </Card>

            <Card title="Featured Image" style={{ marginTop: 16 }}>
              <Form.Item name="featuredImage" help="Paste URL or upload an image">
                <Input placeholder="https://example.com/image.jpg" addonAfter={
                  <Upload showUploadList={false} accept="image/*" beforeUpload={async (file) => {
                    try {
                      const res = await uploadApi.upload('blog', file);
                      if (res.success) { form.setFieldsValue({ featuredImage: res.file.url }); message.success('Image uploaded'); }
                    } catch { message.error('Upload failed'); }
                    return false;
                  }}>
                    <Button size="small" icon={<UploadOutlined />} type="link">Upload</Button>
                  </Upload>
                } />
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {({ getFieldValue }) => {
                  const url = getFieldValue('featuredImage');
                  return url ? (
                    <img src={url} alt="Preview" style={{ width: '100%', borderRadius: 8, marginTop: 8 }} />
                  ) : null;
                }}
              </Form.Item>
            </Card>

            <Card title="Category & Tags" style={{ marginTop: 16 }}>
              <Form.Item name="category" label="Category">
                <Select
                  showSearch
                  allowClear
                  placeholder="Select or type category"
                  dropdownRender={(menu) => (
                    <>
                      {menu}
                    </>
                  )}
                >
                  {['General', 'Technology', 'Business', 'Marketing', 'Tutorial', 'News', 'Tips', ...categories]
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .map(c => (
                      <Option key={c} value={c}>{c}</Option>
                    ))}
                </Select>
              </Form.Item>

              <div style={{ marginBottom: 8 }}>
                <label style={{ fontWeight: 500 }}>Tags</label>
              </div>
              <Space style={{ marginBottom: 8 }} wrap>
                {tags.map(tag => (
                  <Tag key={tag} closable onClose={() => handleRemoveTag(tag)} color="blue">
                    {tag}
                  </Tag>
                ))}
              </Space>
              <Input
                placeholder="Add tag and press Enter"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onPressEnter={(e) => { e.preventDefault(); handleAddTag(); }}
                size="small"
              />
            </Card>
          </Col>
        </Row>
      </Form>
    </div>
  );
};

export default BlogPostFormPage;
