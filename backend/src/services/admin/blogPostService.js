/**
 * Blog Posts — admin-authored articles for the public marketing site. Ported
 * to Prisma as part of the Admin domain. The old original schema's two
 * `pre('validate')`/`pre('save')` hooks (auto-slug from title, auto-computed
 * `readTime`, stamping `publishedAt` the first time status becomes
 * 'published') have no Prisma equivalent, so they're reproduced here as
 * plain functions applied before every write.
 *
 * There is no full-text index on title/content/tags — nothing in
 * the app actually issued a `$text` search against it (both the admin and
 * public routes filter with a plain `$regex`), so there's no Postgres
 * full-text equivalent to build; `contains` (ILIKE) matches existing
 * behavior exactly.
 */
const prisma = require('../../lib/prismaClient');
const { paginate } = require('../../utils/helpers/pagination');
const { byPublicId, byPublicIds } = require('../../utils/helpers/publicId');




const slugify = (title) => String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const computeReadTime = (content) => {
  if (!content) return 0;
  const plainText = content.replace(/<[^>]+>/g, '');
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 200));
};

const toDoc = (row, authorId) => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  excerpt: row.excerpt,
  content: row.content,
  featuredImage: row.featuredImage,
  author: authorId || null,
  authorName: row.authorName,
  category: row.category,
  tags: row.tags || [],
  status: row.status,
  publishedAt: row.publishedAt,
  views: row.views,
  isFeatured: row.isFeatured,
  seoTitle: row.seoTitle,
  seoDescription: row.seoDescription,
  ogImage: row.ogImage,
  canonicalUrl: row.canonicalUrl,
  noIndex: row.noIndex,
  readTime: row.readTime,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const wrap = (row) => toDoc(row, row.author?.id);
const INCLUDE = { author: { select: { id: true } } };

const ADMIN_SELECT = [
  'title', 'slug', 'status', 'category', 'tags', 'publishedAt', 'views', 'isFeatured',
  'featuredImage', 'excerpt', 'updatedAt', 'authorName', 'createdAt',
];

const list = async ({
  status, category, search, page = 1, limit = 20, dateFrom, dateTo, sortField, sortOrder,
} = {}) => {
  const where = {};
  if (status) {
    const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) where.status = statuses[0];
    else if (statuses.length > 1) where.status = { in: statuses };
  }
  if (category) {
    const cats = category.split(',').map((c) => c.trim()).filter(Boolean);
    if (cats.length === 1) where.category = cats[0];
    else if (cats.length > 1) where.category = { in: cats };
  }
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { tags: { has: search } },
    ];
  }

  const orderBy = sortField ? { [sortField]: sortOrder === 'ascend' ? 'asc' : 'desc' } : { updatedAt: 'desc' };
  const { skip, take } = paginate({ page, limit });

  const [rows, total] = await Promise.all([
    prisma.blogPost.findMany({
      where,
      orderBy,
      skip,
      take,
      select: { id: true, ...Object.fromEntries(ADMIN_SELECT.map((f) => [f, true])) },
    }),
    prisma.blogPost.count({ where }),
  ]);

  const posts = rows.map((row) => row);
  return { posts, total };
};

const stats = async () => {
  const [total, published, draft, archived, viewsAgg] = await Promise.all([
    prisma.blogPost.count(),
    prisma.blogPost.count({ where: { status: 'published' } }),
    prisma.blogPost.count({ where: { status: 'draft' } }),
    prisma.blogPost.count({ where: { status: 'archived' } }),
    prisma.blogPost.aggregate({ _sum: { views: true } }),
  ]);
  return { total, published, draft, archived, totalViews: viewsAgg._sum.views || 0 };
};

const distinctCategories = async () => {
  const rows = await prisma.blogPost.findMany({ distinct: ['category'], select: { category: true } });
  return rows.map((r) => r.category).filter(Boolean);
};

const findById = async (id) => {
  const row = await prisma.blogPost.findUnique({ where: byPublicId(id), include: INCLUDE });
  return row ? wrap(row) : null;
};

const findBySlug = async (slug) => {
  const row = await prisma.blogPost.findUnique({ where: { slug }, include: INCLUDE });
  return row ? wrap(row) : null;
};

const create = async ({
  title, slug, excerpt, content, featuredImage, author, authorName, category, tags, status, isFeatured, seoTitle, seoDescription,
}) => {
  const finalSlug = slug || slugify(title);

  const existing = await prisma.blogPost.findUnique({ where: { slug: finalSlug } });
  if (existing) {
    const err = new Error('A post with this slug already exists');
    err.status = 400;
    throw err;
  }

  const authorPg = author ? await prisma.user.findUnique({ where: byPublicId(author), select: { id: true } }) : null;
  const finalStatus = status || 'draft';

  const row = await prisma.blogPost.create({
    data: {

      title,
      slug: finalSlug,
      excerpt: excerpt || '',
      content: content || '',
      featuredImage: featuredImage || '',
      authorId: authorPg?.id || null,
      authorName: authorName || 'Admin',
      category: category || 'General',
      tags: tags || [],
      status: finalStatus,
      publishedAt: finalStatus === 'published' ? new Date() : null,
      isFeatured: !!isFeatured,
      seoTitle: seoTitle || '',
      seoDescription: seoDescription || '',
      readTime: computeReadTime(content),
    },
  });

  const doc = toDoc(row, author || null);
  return doc;
};

const update = async (id, fields) => {
  const existing = await prisma.blogPost.findUnique({ where: byPublicId(id) });
  if (!existing) return null;

  const {
    title, slug, excerpt, content, featuredImage, category, tags, status, isFeatured, authorName, seoTitle, seoDescription,
  } = fields;

  if (slug !== undefined && slug !== existing.slug) {
    const conflict = await prisma.blogPost.findUnique({ where: { slug } });
    if (conflict && conflict.id !== existing.id) {
      const err = new Error('A post with this slug already exists');
      err.status = 400;
      throw err;
    }
  }

  const data = {};
  if (title !== undefined) data.title = title;
  if (slug !== undefined) data.slug = slug;
  if (excerpt !== undefined) data.excerpt = excerpt;
  if (content !== undefined) {
    data.content = content;
    data.readTime = computeReadTime(content);
  }
  if (featuredImage !== undefined) data.featuredImage = featuredImage;
  if (category !== undefined) data.category = category;
  if (tags !== undefined) data.tags = tags;
  if (status !== undefined) {
    data.status = status;
    if (status === 'published' && !existing.publishedAt) data.publishedAt = new Date();
  }
  if (isFeatured !== undefined) data.isFeatured = isFeatured;
  if (authorName !== undefined) data.authorName = authorName;
  if (seoTitle !== undefined) data.seoTitle = seoTitle;
  if (seoDescription !== undefined) data.seoDescription = seoDescription;

  const updated = await prisma.blogPost.update({ where: { id: existing.id }, data, include: INCLUDE });
  const doc = wrap(updated);
  return doc;
};

const updateStatus = (id, status) => update(id, { status });

const deleteOne = async (id) => {
  const existing = await prisma.blogPost.findUnique({ where: byPublicId(id) });
  if (!existing) return null;

  await prisma.blogPost.delete({ where: { id: existing.id } });
  return existing;
};

const bulkDelete = async (ids) => {
  const rows = await prisma.blogPost.findMany({ where: byPublicIds(ids), select: { id: true } });
  if (!rows.length) return 0;

  await prisma.blogPost.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return rows.length;
};

const PUBLIC_SELECT = [
  'title', 'slug', 'excerpt', 'featuredImage', 'category', 'tags', 'publishedAt', 'views', 'readTime', 'authorName', 'isFeatured',
];

/** public/blog.routes.js's `GET /posts` — published posts, searchable, sortable, paginated. */
const listPublished = async ({
  search, category, tag, sort = 'latest', page = 1, limit = 9,
} = {}) => {
  const where = { status: 'published' };
  if (category && category !== 'All') where.category = category;
  if (tag) where.tags = { has: tag };
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { excerpt: { contains: search, mode: 'insensitive' } },
      { tags: { has: search } },
    ];
  }
  if (sort === 'featured') where.isFeatured = true;

  const orderBy = sort === 'popular'
    ? [{ views: 'desc' }, { publishedAt: 'desc' }]
    : { publishedAt: 'desc' };

  const { skip, take } = paginate({ page, limit });
  const [rows, total] = await Promise.all([
    prisma.blogPost.findMany({
      where,
      orderBy,
      skip,
      take,
      select: { id: true, ...Object.fromEntries(PUBLIC_SELECT.map((f) => [f, true])) },
    }),
    prisma.blogPost.count({ where }),
  ]);

  return { posts: rows.map((row) => row), total };
};

/** public/blog.routes.js's `GET /popular`. */
const listPopular = async (limit = 5) => {
  const rows = await prisma.blogPost.findMany({
    where: { status: 'published' },
    orderBy: { views: 'desc' },
    take: limit,
    select: {
      id: true, title: true, slug: true, featuredImage: true, views: true, readTime: true, publishedAt: true,
    },
  });
  return rows.map((row) => row);
};

/** public/blog.routes.js's `GET /categories` — published post counts per category. */
const categoryCounts = async () => {
  const rows = await prisma.blogPost.groupBy({ by: ['category'], where: { status: 'published' }, _count: { _all: true } });
  return rows
    .map((r) => ({ name: r.category, count: r._count._all }))
    .sort((a, b) => b.count - a.count);
};

/** public/blog.routes.js's "related posts" — same category, excluding the current post. */
const listRelated = async (category, excludeId, limit = 3) => {
  const rows = await prisma.blogPost.findMany({
    where: { status: 'published', category, NOT: byPublicId(excludeId) },
    orderBy: { publishedAt: 'desc' },
    take: limit,
    select: {
      id: true, title: true, slug: true, excerpt: true, featuredImage: true, readTime: true, publishedAt: true,
    },
  });
  return rows.map((row) => row);
};

/** public/seo.routes.js's sitemap.xml — published posts, minimal fields. */
const listPublishedForSitemap = async () => {
  const rows = await prisma.blogPost.findMany({
    where: { status: 'published' },
    orderBy: { publishedAt: 'desc' },
    select: {
      id: true, slug: true, updatedAt: true, noIndex: true,
    },
  });
  return rows.map((row) => row);
};

/** public/seo.routes.js's robots.txt — slugs of published posts marked noIndex. */
const listNoIndexSlugs = async () => {
  const rows = await prisma.blogPost.findMany({ where: { noIndex: true, status: 'published' }, select: { slug: true } });
  return rows.map((r) => r.slug);
};

/** The public "view a post" endpoint's view-count bump. */
const incrementViews = async (slug) => {
  const existing = await prisma.blogPost.findFirst({ where: { slug, status: 'published' } });
  if (!existing) return null;

  const updated = await prisma.blogPost.update({
    where: { id: existing.id }, data: { views: { increment: 1 } }, include: INCLUDE,
  });
  return wrap(updated);
};

module.exports = {
  list,
  stats,
  distinctCategories,
  findById,
  findBySlug,
  create,
  update,
  updateStatus,
  deleteOne,
  bulkDelete,
  incrementViews,
  listPublished,
  listPopular,
  categoryCounts,
  listRelated,
  listPublishedForSitemap,
  listNoIndexSlugs,
};
