/**
 * Marketing Pages — pages on the public marketing site, built from ordered
 * content blocks. Ported to Prisma as part of the Admin domain.
 *
 * Two rules that used to live in save hooks are enforced here instead:
 *  - auto-slug from title if not provided
 *  - "only one homepage" — setting `isHomePage` on a page unsets it on every
 *    other page, done inside the same `$transaction` as the write itself so
 *    the two can never disagree partway through.
 *
 * Blocks are a child table (`MarketingPageBlock`) but have no stable identity
 * of their own worth diffing — like Deployment's requirements/history
 * arrays, every write that includes a `blocks` array simply replaces the
 * full set.
 */
const prisma = require('../../lib/prismaClient');
const { byPublicId, byPublicIds } = require('../../utils/helpers/publicId');




const slugify = (title) => String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const BLOCK_FIELDS = [
  'type', 'title', 'subtitle', 'content', 'buttonText', 'buttonLink',
  'secondaryButtonText', 'secondaryButtonLink', 'backgroundImage', 'backgroundColor', 'textColor',
];

const toBlockDoc = (row) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  subtitle: row.subtitle,
  content: row.content,
  buttonText: row.buttonText,
  buttonLink: row.buttonLink,
  secondaryButtonText: row.secondaryButtonText,
  secondaryButtonLink: row.secondaryButtonLink,
  backgroundImage: row.backgroundImage,
  backgroundColor: row.backgroundColor,
  textColor: row.textColor,
  items: row.items || [],
  order: row.order,
  visible: row.visible,
  settings: row.settings || {},
});

const toDoc = (row, editorId) => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  description: row.description,
  metaTitle: row.metaTitle,
  metaDescription: row.metaDescription,
  metaKeywords: row.metaKeywords,
  ogImage: row.ogImage,
  canonicalUrl: row.canonicalUrl,
  noIndex: row.noIndex,
  status: row.status,
  isHomePage: row.isHomePage,
  showInNavigation: row.showInNavigation,
  navigationOrder: row.navigationOrder,
  navigationLabel: row.navigationLabel,
  blocks: (row.blocks || []).map(toBlockDoc),
  customCSS: row.customCSS,
  lastEditedBy: editorId || null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const INCLUDE = { blocks: { orderBy: { order: 'asc' } }, lastEditedBy: { select: { id: true, name: true } } };
const wrap = (row) => ({ ...toDoc(row, row.lastEditedBy?.id), lastEditedBy: row.lastEditedBy ? { name: row.lastEditedBy.name } : null });

const list = async ({ status, search } = {}) => {
  const where = {};
  if (status) where.status = status;
  if (search) where.title = { contains: search, mode: 'insensitive' };

  const rows = await prisma.marketingPage.findMany({
    where,
    orderBy: [{ navigationOrder: 'asc' }, { updatedAt: 'desc' }],
    select: {
      id: true, title: true, slug: true, status: true, isHomePage: true,
      showInNavigation: true, navigationOrder: true, updatedAt: true,
      lastEditedBy: { select: { name: true } },
    },
  });

  return rows.map(({ lastEditedBy, ...rest }) => ({ ...rest, lastEditedBy: lastEditedBy ? { name: lastEditedBy.name } : null,
  }));
};

const findById = async (id) => {
  const row = await prisma.marketingPage.findUnique({ where: byPublicId(id), include: INCLUDE });
  return row ? wrap(row) : null;
};

const findBySlug = async (slug, { publishedOnly = true } = {}) => {
  const row = await prisma.marketingPage.findUnique({
    where: { slug },
    include: INCLUDE,
  });
  if (!row) return null;
  if (publishedOnly && row.status !== 'published') return null;
  return wrap(row);
};

const listForNavigation = async () => {
  const rows = await prisma.marketingPage.findMany({
    where: { showInNavigation: true, status: 'published' },
    orderBy: { navigationOrder: 'asc' },
    select: {
      id: true, title: true, slug: true, navigationOrder: true, navigationLabel: true, isHomePage: true,
    },
  });
  return rows.map((row) => row);
};

/** public/marketing.routes.js's `GET /pages` — minimal data for client-side routing. */
const listPublishedForRouting = async () => {
  const rows = await prisma.marketingPage.findMany({
    where: { status: 'published' },
    select: {
      id: true, title: true, slug: true, isHomePage: true, metaTitle: true, metaDescription: true, navigationOrder: true,
    },
    orderBy: { navigationOrder: 'asc' },
  });
  return rows.map((row) => row);
};

/** public/seo.routes.js's sitemap.xml — published pages, minimal fields. */
const listPublished = async () => {
  const rows = await prisma.marketingPage.findMany({
    where: { status: 'published' },
    select: {
      id: true, slug: true, isHomePage: true, updatedAt: true, noIndex: true, navigationOrder: true,
    },
    orderBy: { navigationOrder: 'asc' },
  });
  return rows.map((row) => row);
};

/** public/marketing.routes.js's `GET /pages/home`. */
const findHomepage = async () => {
  const row = await prisma.marketingPage.findFirst({ where: { isHomePage: true, status: 'published' }, include: INCLUDE });
  return row ? wrap(row) : null;
};

/** public/seo.routes.js's robots.txt — slugs of published pages marked noIndex. */
const listNoIndexSlugs = async () => {
  const rows = await prisma.marketingPage.findMany({ where: { noIndex: true, status: 'published' }, select: { slug: true } });
  return rows.map((r) => r.slug);
};

/*
 * Every write replaces the full set of blocks, so a block has no identity
 * worth carrying across a save — and the id the client sends is not usable as
 * one anyway: the editor gives a newly added block a placeholder like
 * `new_1788…`, and this used to store that string verbatim as the block's id.
 * Minting a fresh id for every block on every write is both simpler and the
 * only version that cannot store a placeholder or collide with an existing
 * block's id (which is what made "clone page" throw before).
 */
const blocksCreateInput = (blocks = []) => blocks.map((b, i) => ({
  order: i,
  type: b.type,
  ...Object.fromEntries(BLOCK_FIELDS.filter((f) => f !== 'type').map((f) => [f, b[f] || ''])),
  items: b.items || [],
  visible: b.visible !== false,
  settings: b.settings || {},
}));

/** Unset `isHomePage` on every other page — part of the same transaction as the actual write. */
const unsetOtherHomepages = (exceptPgId) => prisma.marketingPage.updateMany({
  where: { isHomePage: true, ...(exceptPgId ? { id: { not: exceptPgId } } : {}) },
  data: { isHomePage: false },
});

const create = async (fields) => {
  const {
    title, slug, description, metaTitle, metaDescription, metaKeywords, ogImage, canonicalUrl, noIndex,
    status, isHomePage, showInNavigation, navigationOrder, navigationLabel, blocks, customCSS, lastEditedBy,
  } = fields;

  const finalSlug = slug || slugify(title);
  const existing = await prisma.marketingPage.findUnique({ where: { slug: finalSlug } });
  if (existing) {
    const err = new Error('A page with this slug already exists');
    err.status = 400;
    throw err;
  }

  const editorPg = lastEditedBy
    ? await prisma.user.findUnique({ where: byPublicId(lastEditedBy), select: { id: true } })
    : null;

  const ops = [];
  if (isHomePage) ops.push(unsetOtherHomepages(null));
  ops.push(prisma.marketingPage.create({
    data: {

      title,
      slug: finalSlug,
      description: description || '',
      metaTitle: metaTitle || '',
      metaDescription: metaDescription || '',
      metaKeywords: metaKeywords || '',
      ogImage: ogImage || '',
      canonicalUrl: canonicalUrl || '',
      noIndex: !!noIndex,
      status: status || 'draft',
      isHomePage: !!isHomePage,
      showInNavigation: showInNavigation !== false,
      navigationOrder: navigationOrder || 0,
      navigationLabel: navigationLabel || '',
      customCSS: customCSS || '',
      lastEditedById: editorPg?.id || null,
      blocks: { create: blocksCreateInput(blocks) },
    },
    include: INCLUDE,
  }));

  const results = await prisma.$transaction(ops);
  const row = results[results.length - 1];
  const doc = wrap(row);
  return doc;
};

const update = async (id, fields) => {
  const existing = await prisma.marketingPage.findUnique({ where: byPublicId(id) });
  if (!existing) return null;

  const {
    title, slug, description, metaTitle, metaDescription, metaKeywords, ogImage, canonicalUrl, noIndex,
    status, isHomePage, showInNavigation, navigationOrder, navigationLabel, blocks, customCSS, lastEditedBy,
  } = fields;

  if (slug !== undefined && slug !== existing.slug) {
    const conflict = await prisma.marketingPage.findUnique({ where: { slug } });
    if (conflict && conflict.id !== existing.id) {
      const err = new Error('A page with this slug already exists');
      err.status = 400;
      throw err;
    }
  }

  const editorPg = lastEditedBy
    ? await prisma.user.findUnique({ where: byPublicId(lastEditedBy), select: { id: true } })
    : null;

  const data = {};
  if (title !== undefined) data.title = title;
  if (slug !== undefined) data.slug = slug;
  if (description !== undefined) data.description = description;
  if (metaTitle !== undefined) data.metaTitle = metaTitle;
  if (metaDescription !== undefined) data.metaDescription = metaDescription;
  if (metaKeywords !== undefined) data.metaKeywords = metaKeywords;
  if (ogImage !== undefined) data.ogImage = ogImage;
  if (canonicalUrl !== undefined) data.canonicalUrl = canonicalUrl;
  if (noIndex !== undefined) data.noIndex = noIndex;
  if (status !== undefined) data.status = status;
  if (isHomePage !== undefined) data.isHomePage = isHomePage;
  if (showInNavigation !== undefined) data.showInNavigation = showInNavigation;
  if (navigationOrder !== undefined) data.navigationOrder = navigationOrder;
  if (navigationLabel !== undefined) data.navigationLabel = navigationLabel;
  if (customCSS !== undefined) data.customCSS = customCSS;
  if (editorPg) data.lastEditedById = editorPg.id;

  const ops = [];
  if (isHomePage) ops.push(unsetOtherHomepages(existing.id));
  if (blocks !== undefined) ops.push(prisma.marketingPageBlock.deleteMany({ where: { pageId: existing.id } }));
  ops.push(prisma.marketingPage.update({
    where: { id: existing.id },
    data: {
      ...data,
      ...(blocks !== undefined ? { blocks: { create: blocksCreateInput(blocks) } } : {}),
    },
    include: INCLUDE,
  }));

  const results = await prisma.$transaction(ops);
  const row = results[results.length - 1];
  const doc = wrap(row);
  return doc;
};

const updateStatus = (id, status, lastEditedBy) => update(id, { status, lastEditedBy });

const deleteOne = async (id) => {
  const existing = await prisma.marketingPage.findUnique({ where: byPublicId(id) });
  if (!existing) return null;

  if (existing.isHomePage) {
    const err = new Error('Cannot delete the homepage. Set another page as homepage first.');
    err.status = 400;
    throw err;
  }

  await prisma.marketingPage.delete({ where: { id: existing.id } });
  return existing;
};

const bulkDelete = async (ids) => {
  const rows = await prisma.marketingPage.findMany({ where: byPublicIds(ids), select: { id: true, isHomePage: true } });
  if (rows.some((r) => r.isHomePage)) {
    const err = new Error('Cannot delete the home page. Remove it from selection.');
    err.status = 400;
    throw err;
  }
  if (!rows.length) return 0;

  await prisma.marketingPage.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return rows.length;
};

const clone = async (id, lastEditedBy) => {
  const original = await findById(id);
  if (!original) return null;

  return create({
    title: `${original.title} (Copy)`,
    slug: `${original.slug}-copy-${Date.now()}`,
    description: original.description,
    metaTitle: original.metaTitle,
    metaDescription: original.metaDescription,
    metaKeywords: original.metaKeywords,
    status: 'draft',
    isHomePage: false,
    showInNavigation: false,
    navigationOrder: 99,
    navigationLabel: original.navigationLabel ? `${original.navigationLabel} (Copy)` : '',
    // Fresh ids for the clone's own blocks — `id` is globally
    // unique, and the original page's block rows are still alive, so reusing
    // their ids here would collide.
    blocks: (original.blocks || []).map(({ _id, ...block }) => block),
    customCSS: original.customCSS || '',
    lastEditedBy,
  });
};

/** `pages`: [{ id (legacy), navigationOrder }] */
const reorder = async (pages) => {
  await prisma.$transaction(pages.map((p) => prisma.marketingPage.updateMany({
    where: byPublicId(p.id),
    data: { navigationOrder: p.navigationOrder },
  })));
};

module.exports = {
  list,
  findById,
  findBySlug,
  findHomepage,
  listForNavigation,
  listPublished,
  listPublishedForRouting,
  listNoIndexSlugs,
  create,
  update,
  updateStatus,
  deleteOne,
  bulkDelete,
  clone,
  reorder,
};
