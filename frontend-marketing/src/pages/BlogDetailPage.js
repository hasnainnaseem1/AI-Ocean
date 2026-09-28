import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Clock, Eye, ArrowLeft, Calendar, User, Tag, BookOpen, Share2, ChevronRight } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { useSite } from '../context/SiteContext';
import { updatePageSeo, setArticleSchema, setBreadcrumbSchema, clearPageSchemas } from '../utils/seoHelpers';
import config from '../config';

function BlogDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { site, seo } = useSite();
  const [post, setPost] = useState(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const primaryColor = site.primaryColor || '#7089F5';

  useEffect(() => {
    fetchPost();
    window.scrollTo(0, 0);
    return () => clearPageSchemas();
  }, [slug]);

  const fetchPost = async () => {
    setLoading(true);
    setNotFound(false);
    clearPageSchemas();
    try {
      const res = await fetch(`${config.apiUrl}/api/v1/public/blog/posts/${slug}`);
      const data = await res.json();
      if (data.success) {
        setPost(data.post);
        setRelated(data.related || []);

        const p = data.post;
        const postUrl = `${window.location.origin}/blog/${p.slug}`;
        const ogImage = p.ogImage || p.featuredImage || seo.defaultOgImage || '';

        // Full SEO meta injection
        updatePageSeo({
          title: `${p.seoTitle || p.title} — ${site.siteName || 'Blog'}`,
          description: p.seoDescription || p.excerpt || '',
          keywords: (p.tags || []).join(', '),
          ogImage,
          ogType: 'article',
          canonicalUrl: p.canonicalUrl || postUrl,
          noIndex: p.noIndex || false,
          siteName: site.siteName || '',
          url: postUrl,
          twitterHandle: seo.socialLinks?.twitter || '',
        });

        // Article structured data
        setArticleSchema({
          title: p.title,
          description: p.seoDescription || p.excerpt || '',
          url: postUrl,
          image: ogImage,
          author: p.author?.name || 'Admin',
          publishedAt: p.publishedAt || p.createdAt,
          modifiedAt: p.updatedAt,
          siteName: site.siteName || '',
          siteUrl: window.location.origin,
        });

        // Breadcrumb structured data
        setBreadcrumbSchema([
          { name: 'Home', url: window.location.origin },
          { name: 'Blog', url: `${window.location.origin}/blog` },
          { name: p.title, url: postUrl },
        ]);
      } else {
        setNotFound(true);
      }
    } catch (err) {
      console.error('Failed to fetch post:', err);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({ title: post.title, url: window.location.href });
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert('Link copied to clipboard!');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="max-w-4xl mx-auto px-4 pt-28 pb-16 animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4" />
          <div className="h-12 bg-gray-200 rounded w-full mb-4" />
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-8" />
          <div className="h-80 bg-gray-200 rounded-xl mb-8" />
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded w-full" />
            <div className="h-4 bg-gray-200 rounded w-5/6" />
            <div className="h-4 bg-gray-200 rounded w-4/6" />
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="max-w-4xl mx-auto px-4 pt-28 pb-16 text-center">
          <BookOpen className="w-20 h-20 text-gray-300 mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-gray-800 mb-4">Post Not Found</h1>
          <p className="text-gray-500 mb-8">The article you're looking for doesn't exist or has been removed.</p>
          <Link
            to="/blog"
            className="inline-flex items-center gap-2 text-white px-6 py-3 rounded-full font-medium transition hover:opacity-90"
            style={{ backgroundColor: primaryColor }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Blog
          </Link>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      {/* Breadcrumb */}
      <div className="pt-20 bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <nav className="flex items-center gap-2 text-sm text-gray-500">
            <Link to="/" className="hover:text-gray-800 transition">Home</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <Link to="/blog" className="hover:text-gray-800 transition">Blog</Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-gray-800 truncate max-w-xs">{post.title}</span>
          </nav>
        </div>
      </div>

      {/* Article */}
      <article className="max-w-4xl mx-auto px-4 pt-8 pb-16">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <Link
              to={`/blog?category=${post.category}`}
              className="text-sm font-medium px-3 py-1 rounded-full"
              style={{ backgroundColor: `${primaryColor}15`, color: primaryColor }}
            >
              {post.category}
            </Link>
            {post.isFeatured && (
              <span className="text-sm font-medium px-3 py-1 rounded-full bg-yellow-100 text-yellow-700">
                Featured
              </span>
            )}
          </div>

          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-6 leading-tight">
            {post.title}
          </h1>

          {post.excerpt && (
            <p className="text-xl text-gray-500 mb-6 leading-relaxed">
              {post.excerpt}
            </p>
          )}

          {/* Meta */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 pb-6 border-b">
            <span className="flex items-center gap-1.5">
              <User className="w-4 h-4" />
              {post.authorName}
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {formatDate(post.publishedAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              {post.readTime || 1} min read
            </span>
            <span className="flex items-center gap-1.5">
              <Eye className="w-4 h-4" />
              {post.views || 0} views
            </span>
            <button
              onClick={handleShare}
              className="ml-auto flex items-center gap-1.5 hover:text-gray-800 transition"
            >
              <Share2 className="w-4 h-4" />
              Share
            </button>
          </div>
        </header>

        {/* Featured Image */}
        {post.featuredImage && (
          <div className="mb-10 rounded-2xl overflow-hidden shadow-lg">
            <img
              src={post.featuredImage}
              alt={post.title}
              className="w-full h-auto max-h-[500px] object-cover"
            />
          </div>
        )}

        {/* Content */}
        <div
          className="prose prose-lg max-w-none mb-12
            prose-headings:text-gray-900 prose-headings:font-bold
            prose-p:text-gray-700 prose-p:leading-relaxed
            prose-a:text-purple-600 prose-a:no-underline hover:prose-a:underline
            prose-img:rounded-xl prose-img:shadow-md
            prose-blockquote:border-l-4 prose-blockquote:text-gray-600 prose-blockquote:italic
            prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded
            prose-pre:bg-gray-900 prose-pre:text-gray-100"
          style={{ '--tw-prose-links': primaryColor, borderColor: primaryColor }}
          dangerouslySetInnerHTML={{ __html: post.content }}
        />

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 py-6 border-t border-b">
            <Tag className="w-4 h-4 text-gray-400" />
            {post.tags.map((tag) => (
              <Link
                key={tag}
                to={`/blog?tag=${tag}`}
                className="text-sm px-3 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                {tag}
              </Link>
            ))}
          </div>
        )}

        {/* Back to Blog */}
        <div className="mt-8">
          <Link
            to="/blog"
            className="inline-flex items-center gap-2 text-sm font-medium transition"
            style={{ color: primaryColor }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to all articles
          </Link>
        </div>
      </article>

      {/* Related Posts */}
      {related.length > 0 && (
        <section className="bg-white border-t py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-8">Related Articles</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {related.map((r) => (
                <Link
                  key={r.id}
                  to={`/blog/${r.slug}`}
                  className="bg-gray-50 rounded-xl overflow-hidden hover:shadow-md transition group block"
                >
                  <div className="h-40 overflow-hidden bg-gray-100">
                    {r.featuredImage ? (
                      <img
                        src={r.featuredImage}
                        alt={r.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div
                        className="w-full h-full flex items-center justify-center"
                        style={{ background: `linear-gradient(135deg, ${primaryColor}15, ${primaryColor}30)` }}
                      >
                        <BookOpen className="w-10 h-10" style={{ color: primaryColor }} />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 group-hover:text-purple-600 transition line-clamp-2 mb-2">
                      {r.title}
                    </h3>
                    <p className="text-sm text-gray-500 line-clamp-2">{r.excerpt}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mt-3">
                      <Clock className="w-3 h-3" />
                      <span>{r.readTime || 1} min read</span>
                      <span>·</span>
                      <span>{formatDate(r.publishedAt)}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <Footer />
    </div>
  );
}

export default BlogDetailPage;
