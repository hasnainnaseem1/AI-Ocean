/**
 * Seed Blog Posts — creates sample blog posts for demonstration.
 *
 * Usage:
 *   node src/scripts/seed/seedBlogPosts.js
 */
require('dotenv').config();
const { connect, prisma, finish, fail } = require('./seedHelpers');
const blogPostService = require('../../services/admin/blogPostService');

const samplePosts = [
  {
    title: '10 Tips to Grow Your Online Business in 2025',
    slug: '10-tips-grow-online-business-2025',
    excerpt: 'Discover the proven strategies that successful entrepreneurs use to scale their businesses in the digital age.',
    content: `<h2>Introduction</h2>
<p>Growing an online business requires a combination of strategy, persistence, and smart tools. In this article, we'll walk through 10 practical tips that you can apply today.</p>

<h2>1. Know Your Audience</h2>
<p>Understanding your target audience is the foundation of any successful business. Use analytics tools to study demographics, behavior, and preferences.</p>

<h2>2. Optimize Your Website</h2>
<p>A fast, mobile-responsive website is no longer optional — it's essential. Ensure your site loads in under 3 seconds and looks great on all devices.</p>

<h2>3. Invest in Content Marketing</h2>
<p>High-quality blog posts, videos, and social media content help establish authority and attract organic traffic. Consistency is key.</p>

<h2>4. Leverage Email Marketing</h2>
<p>Build an email list from day one. Email marketing consistently delivers the highest ROI of any digital marketing channel.</p>

<h2>5. Use Data-Driven Decisions</h2>
<p>Don't rely on gut feelings alone. Use analytics dashboards and A/B testing to make informed decisions about your strategy.</p>

<h2>6. Focus on Customer Retention</h2>
<p>Acquiring a new customer costs 5x more than retaining an existing one. Build loyalty programs and provide exceptional support.</p>

<h2>7. Automate Repetitive Tasks</h2>
<p>Use automation tools to handle email sequences, social media posting, and inventory management. Free up your time for strategic work.</p>

<h2>8. Build Strategic Partnerships</h2>
<p>Collaborate with complementary businesses to reach new audiences and create win-win situations.</p>

<h2>9. Stay Current with Trends</h2>
<p>The digital landscape changes rapidly. Stay updated with industry trends, algorithm changes, and emerging technologies.</p>

<h2>10. Measure and Iterate</h2>
<p>Set clear KPIs, measure your progress regularly, and be willing to pivot when something isn't working.</p>

<h2>Conclusion</h2>
<p>Growing an online business is a marathon, not a sprint. Apply these tips consistently and you'll see sustainable growth over time.</p>`,
    featuredImage: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=400&fit=crop',
    category: 'Business',
    tags: ['growth', 'strategy', 'tips', 'online-business'],
    status: 'published',
    publishedAt: new Date('2025-01-15'),
    views: 342,
    isFeatured: true,
    authorName: 'Admin',
  },
  {
    title: 'The Complete Guide to SEO in 2025',
    slug: 'complete-guide-seo-2025',
    excerpt: 'Everything you need to know about search engine optimization — from keywords to technical SEO and beyond.',
    content: `<h2>What is SEO?</h2>
<p>Search Engine Optimization (SEO) is the practice of optimizing your website to rank higher in search engine results pages (SERPs). It involves technical, on-page, and off-page strategies.</p>

<h2>Keyword Research</h2>
<p>Start by identifying the keywords your target audience is searching for. Use tools like Google Keyword Planner, Ahrefs, or SEMrush to find high-volume, low-competition keywords.</p>

<h2>On-Page SEO</h2>
<p>Optimize your title tags, meta descriptions, headers, and content. Ensure each page targets a primary keyword and includes related terms naturally.</p>

<h2>Technical SEO</h2>
<p>Ensure your site is crawlable, has a proper sitemap, uses HTTPS, loads quickly, and has clean URL structures. Core Web Vitals are now a ranking factor.</p>

<h2>Content Strategy</h2>
<p>Create comprehensive, valuable content that answers user questions. Long-form content typically ranks better, but quality always trumps quantity.</p>

<h2>Link Building</h2>
<p>Earn high-quality backlinks from authoritative websites. Guest posting, creating link-worthy resources, and digital PR are effective strategies.</p>

<h2>Measuring Success</h2>
<p>Track your organic traffic, keyword rankings, click-through rates, and conversions. Use Google Analytics and Search Console for insights.</p>`,
    featuredImage: 'https://images.unsplash.com/photo-1432888498266-38ffec3eaf0a?w=800&h=400&fit=crop',
    category: 'Marketing',
    tags: ['seo', 'marketing', 'search-engine', 'guide'],
    status: 'published',
    publishedAt: new Date('2025-01-20'),
    views: 567,
    isFeatured: true,
    authorName: 'Admin',
  },
  {
    title: 'Getting Started with React: A Beginner\'s Guide',
    slug: 'getting-started-react-beginners-guide',
    excerpt: 'A comprehensive introduction to React.js for developers who are just starting their journey.',
    content: `<h2>What is React?</h2>
<p>React is a JavaScript library for building user interfaces, created by Facebook. It uses a component-based architecture and a virtual DOM for efficient rendering.</p>

<h2>Setting Up Your Environment</h2>
<p>The easiest way to start is with Create React App:</p>
<pre><code>npx create-react-app my-app
cd my-app
npm start</code></pre>

<h2>Components</h2>
<p>Components are the building blocks of React applications. They can be functional or class-based, though modern React favors functional components with hooks.</p>

<h2>State and Props</h2>
<p>Props are read-only data passed from parent to child components. State is mutable data managed within a component using the useState hook.</p>

<h2>Hooks</h2>
<p>Hooks like useState, useEffect, and useContext let you use state and other React features in functional components.</p>

<h2>Next Steps</h2>
<p>Once you're comfortable with the basics, explore React Router for navigation, Redux or Context API for state management, and learn about performance optimization.</p>`,
    featuredImage: 'https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=800&h=400&fit=crop',
    category: 'Tutorial',
    tags: ['react', 'javascript', 'tutorial', 'frontend'],
    status: 'published',
    publishedAt: new Date('2025-02-10'),
    views: 891,
    isFeatured: false,
    authorName: 'Admin',
  },
  {
    title: '5 Must-Have Tools for Remote Teams',
    slug: '5-must-have-tools-remote-teams',
    excerpt: 'The essential tools that every remote team needs to stay productive, connected, and organized.',
    content: `<h2>Working Remote Effectively</h2>
<p>Remote work is here to stay. Having the right tools makes the difference between a productive team and a struggling one.</p>

<h2>1. Communication — Slack</h2>
<p>Real-time messaging with channels, threads, and integrations keeps your team connected without the chaos of email chains.</p>

<h2>2. Video Conferencing — Zoom</h2>
<p>Face-to-face meetings are still important. Zoom provides reliable video calls, screen sharing, and recording features.</p>

<h2>3. Project Management — Notion</h2>
<p>Notion combines notes, docs, wikis, and project tracking in one flexible workspace. It's perfect for documentation and planning.</p>

<h2>4. Design Collaboration — Figma</h2>
<p>Figma enables real-time design collaboration in the browser. No more emailing design files back and forth.</p>

<h2>5. Version Control — GitHub</h2>
<p>GitHub is essential for code collaboration, code review, and CI/CD pipelines. It keeps your codebase organized and your team aligned.</p>`,
    featuredImage: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=400&fit=crop',
    category: 'Technology',
    tags: ['remote-work', 'tools', 'productivity', 'team'],
    status: 'published',
    publishedAt: new Date('2025-02-15'),
    views: 445,
    isFeatured: false,
    authorName: 'Admin',
  },
  {
    title: 'Understanding Analytics: Making Data-Driven Decisions',
    slug: 'understanding-analytics-data-driven-decisions',
    excerpt: 'How to use analytics dashboards and data insights to make smarter business decisions.',
    content: `<h2>Why Analytics Matter</h2>
<p>In the age of big data, businesses that leverage analytics outperform those that don't. Data-driven companies are 23 times more likely to acquire customers.</p>

<h2>Key Metrics to Track</h2>
<p>Focus on metrics that directly impact your business goals: conversion rates, customer acquisition cost, lifetime value, and churn rate.</p>

<h2>Building Dashboards</h2>
<p>A good dashboard tells a story at a glance. Use charts, graphs, and KPIs that are relevant to your audience — whether it's executives or marketers.</p>

<h2>A/B Testing</h2>
<p>Don't guess — test. A/B testing lets you compare two versions of a page, email, or feature to see which performs better.</p>

<h2>Common Pitfalls</h2>
<p>Avoid vanity metrics, confirmation bias, and analysis paralysis. Focus on actionable insights that lead to concrete improvements.</p>`,
    featuredImage: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=400&fit=crop',
    category: 'Business',
    tags: ['analytics', 'data', 'decisions', 'metrics'],
    status: 'published',
    publishedAt: new Date('2025-03-01'),
    views: 178,
    isFeatured: false,
    authorName: 'Admin',
  },
  {
    title: 'Email Marketing Best Practices for 2025',
    slug: 'email-marketing-best-practices-2025',
    excerpt: 'Master email marketing with these proven best practices for higher open rates and conversions.',
    content: `<h2>Email is Not Dead</h2>
<p>Despite the rise of social media, email marketing remains the most effective digital marketing channel with an average ROI of $42 for every dollar spent.</p>

<h2>Building Your List</h2>
<p>Offer valuable lead magnets — ebooks, templates, free trials — in exchange for email sign-ups. Quality beats quantity.</p>

<h2>Writing Compelling Subject Lines</h2>
<p>Your subject line determines whether your email gets opened. Keep it short, create curiosity, and avoid spam trigger words.</p>

<h2>Personalization</h2>
<p>Go beyond "Hi {name}". Segment your list based on behavior, preferences, and purchase history to deliver relevant content.</p>

<h2>Automation</h2>
<p>Set up welcome sequences, abandoned cart emails, and re-engagement campaigns. Automation ensures the right message reaches the right person at the right time.</p>

<h2>Testing and Optimization</h2>
<p>Test subject lines, send times, content formats, and CTAs. Small improvements compound into significant results over time.</p>`,
    featuredImage: 'https://images.unsplash.com/photo-1596526131083-e8c633c948d2?w=800&h=400&fit=crop',
    category: 'Marketing',
    tags: ['email', 'marketing', 'automation', 'conversion'],
    status: 'published',
    publishedAt: new Date('2025-03-10'),
    views: 312,
    isFeatured: false,
    authorName: 'Admin',
  },
  {
    title: 'Coming Soon: New Features in Our Platform',
    slug: 'coming-soon-new-features',
    excerpt: 'A sneak peek at the exciting new features and improvements coming to our platform.',
    content: `<h2>What's Coming Next</h2>
<p>We've been working hard to bring you new features that will make your experience even better. Here's a sneak peek at what's coming.</p>

<h2>Stay Tuned</h2>
<p>We'll share more details soon. Subscribe to our newsletter to be the first to know when these features launch!</p>`,
    featuredImage: '',
    category: 'News',
    tags: ['announcement', 'features', 'update'],
    status: 'draft',
    views: 0,
    isFeatured: false,
    authorName: 'Admin',
  },
];

async function seedBlogPosts() {
  await connect();

  const existing = await prisma.blogPost.count();
  if (existing > 0) {
    console.log(`Found ${existing} existing blog posts. Skipping seed.`);
    console.log('To re-seed, delete the existing posts from Admin Center → Website → Blog first.');
    await finish();
    return;
  }

  // Through the service so each post gets its slug, readTime and publishedAt
  // derived the same way a post created in the Admin Center would.
  let created = 0;
  for (const post of samplePosts) {
    const row = await blogPostService.create(post);
    created += 1;
    console.log(`  [${String(row.status).toUpperCase()}] ${row.title} → /blog/${row.slug}`);
  }

  console.log(`
Successfully created ${created} blog posts.`);
  await finish();
}

seedBlogPosts().catch((err) => fail('Blog post seed', err));
