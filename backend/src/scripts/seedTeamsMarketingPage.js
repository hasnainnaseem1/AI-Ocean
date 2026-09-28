/**
 * The public "For teams" page.
 *
 * Seeded as an ordinary MarketingPage with ordinary blocks, which is the whole
 * point: once it exists the operator edits it from the Admin Center like every
 * other page, and nothing about it is written into the marketing site's code.
 *
 * Idempotent. Run again and it leaves an existing page alone rather than
 * overwriting whatever the operator has since written — pass `--replace` to
 * rebuild its blocks from this file deliberately.
 *
 *   node -r dotenv/config src/scripts/seedTeamsMarketingPage.js [--replace]
 *
 * The copy describes only what the product actually does. Every claim here is
 * something a customer can go and use today: the roles, the spend limits, the
 * two ways in, the history, the handover.
 */
const prisma = require('../lib/prismaClient');

const SLUG = 'teams';

const blocks = [
  {
    order: 0,
    type: 'hero',
    title: 'One account your whole team can work in',
    subtitle: 'Shared models and machines, one bill, and roles that decide who can spend and who can only build.',
    buttonText: 'Create an organization',
    buttonLink: '/signup',
    secondaryButtonText: 'See pricing',
    secondaryButtonLink: '/pricing',
    settings: { gridBackground: true },
    items: [],
  },
  {
    order: 1,
    type: 'features',
    title: 'What an organization gives you',
    subtitle: 'Your personal account stays exactly as it is. An organization sits beside it, with its own money and its own people.',
    items: [
      {
        icon: 'credit-card',
        title: 'One wallet, one set of cards, one bill',
        description: 'Everything the team deploys is billed to the organization, not to whoever happened to click deploy. Nobody has to expense anything.',
      },
      {
        icon: 'users',
        title: 'Five roles, drawn around money',
        description: 'Owner and Admin run the account. Billing handles the money and nothing else. Developers deploy and never see a figure. Viewers can look.',
      },
      {
        icon: 'trending-down',
        title: 'A monthly limit per developer',
        description: 'Give somebody the ability to deploy without giving them the whole wallet. At their limit they cannot start anything new — and nothing already running is stopped.',
      },
      {
        icon: 'activity',
        title: 'A history you can read',
        description: 'Who invited whom, who changed a role or a limit, who joined and who left — in plain sentences, in your own language.',
      },
      {
        icon: 'refresh-cw',
        title: 'Handing it over',
        description: 'Ownership moves only when the new owner accepts it. The account keeps its money and its machines; the outgoing owner stays on as an admin.',
      },
      {
        icon: 'shield',
        title: 'Your own account, untouched',
        description: 'Switch between your personal account and any organization you belong to. Their money never mixes, in either direction.',
      },
    ],
  },
  {
    order: 2,
    type: 'steps',
    title: 'Getting your people in',
    subtitle: 'Two ways, and both end with somebody deciding — never with a link quietly letting strangers in.',
    items: [
      {
        icon: 'mail',
        title: 'Invite by email',
        description: 'Paste one address or twenty, pick the role, send. The link works only for the address it was sent to, expires, and can be withdrawn.',
      },
      {
        icon: 'git-branch',
        title: 'Or share one join link',
        description: 'Drop it in your own company chat. Opening it does not admit anybody — it asks, and an owner or admin says yes.',
      },
      {
        icon: 'check',
        title: 'They pick a role and get to work',
        description: 'A developer can deploy from day one, inside whatever monthly limit you set. A viewer can look without touching anything.',
      },
    ],
  },
  {
    /*
     * A comparison block is a table: `settings.columns` are its headings and
     * each item is a row of `features` cells, where yes/no render as marks.
     * The rows below are the permission table the server actually enforces —
     * kept in step with services/team/permissions.js, not written twice from
     * memory.
     */
    order: 3,
    type: 'comparison',
    title: 'Who can do what',
    subtitle: 'Enforced on the server, not just hidden in the interface.',
    settings: { columns: ['', 'Owner', 'Admin', 'Billing', 'Developer', 'Viewer'] },
    items: [
      { title: 'See what is deployed', features: ['yes', 'yes', 'yes', 'yes', 'yes'] },
      { title: 'Deploy, pause and resume', features: ['yes', 'yes', 'no', 'Up to a limit', 'no'] },
      { title: 'Terminate a deployment', features: ['yes', 'yes', 'no', 'Their own', 'no'] },
      { title: 'See API keys', features: ['yes', 'yes', 'no', 'yes', 'no'] },
      { title: 'See the money — balance, invoices, spend', features: ['yes', 'yes', 'yes', 'no', 'no'] },
      { title: 'Top up and manage cards', features: ['yes', 'yes', 'yes', 'no', 'no'] },
      { title: 'Invite, remove and re-role members', features: ['yes', 'yes', 'no', 'no', 'no'] },
      { title: 'Set a monthly spending limit', features: ['yes', 'yes', 'no', 'no', 'no'] },
      { title: 'Read the activity log', features: ['yes', 'yes', 'no', 'no', 'no'] },
      { title: 'Hand the organization over, or close it', features: ['yes', 'no', 'no', 'no', 'no'] },
    ],
  },
  {
    order: 4,
    type: 'faq',
    title: 'Questions teams ask',
    items: [
      {
        title: 'Do we need a company email address?',
        description: 'No. Anyone can be invited with any address — a work domain, Gmail, anything. A freelancer and four collaborators on five different providers is an ordinary organization here.',
      },
      {
        title: 'What happens to my own account?',
        description: 'Nothing. You keep it, with its own balance and its own deployments, and switch between it and any organization from the account switcher.',
      },
      {
        title: 'Can a developer spend without limit?',
        description: 'Only if you let them. An owner or admin can set a monthly ceiling per developer; at it they cannot start or resume anything, and you are told when they are close.',
      },
      {
        title: 'Somebody left the company. What happens to their machines?',
        description: 'Remove them and their access ends with the next request. The deployments they created keep running and stay with the organization, because the organization is what pays for them.',
      },
      {
        title: 'Can we close an organization?',
        description: 'The owner can, once everything is terminated and nothing is owed. The billing history is kept — closing an account never erases what it spent.',
      },
    ],
  },
  {
    order: 5,
    type: 'cta',
    title: 'Start with your own account, add your team when you need to',
    subtitle: 'Signing up asks one question: is this just you, or a team? Either answer can change later.',
    buttonText: 'Get started',
    buttonLink: '/signup',
    items: [],
  },
];

const run = async () => {
  const replace = process.argv.includes('--replace');

  const existing = await prisma.marketingPage.findUnique({
    where: { slug: SLUG }, select: { id: true, title: true },
  });

  if (existing && !replace) {
    console.log(`"${existing.title}" (/${SLUG}) already exists — left alone. Use --replace to rebuild its blocks.`);
    await prisma.$disconnect();
    return;
  }

  /*
   * The page sits after "use cases" and before "pricing": somebody reading
   * about what the platform does meets teams before they meet a price list.
   * Everything from there on shifts one place along, once.
   */
  const NAV_ORDER = 4;
  if (!existing) {
    await prisma.marketingPage.updateMany({
      where: { navigationOrder: { gte: NAV_ORDER, lt: 90 } },
      data: { navigationOrder: { increment: 1 } },
    });
  }

  const data = {
    title: 'For teams',
    slug: SLUG,
    description: 'Shared accounts for companies: one bill, roles that decide who can spend, and a monthly limit per developer.',
    metaTitle: 'For teams — one account your whole team can work in',
    metaDescription: 'Shared models and machines on one bill, five roles drawn around money, monthly spending limits per developer, and two safe ways to let colleagues in.',
    status: 'published',
    showInNavigation: true,
    navigationOrder: NAV_ORDER,
  };

  if (existing) {
    await prisma.marketingPageBlock.deleteMany({ where: { pageId: existing.id } });
    await prisma.marketingPage.update({ where: { id: existing.id }, data });
    await prisma.marketingPageBlock.createMany({
      data: blocks.map((b) => ({ ...b, pageId: existing.id })),
    });
    console.log(`Rebuilt /${SLUG} with ${blocks.length} blocks.`);
  } else {
    const page = await prisma.marketingPage.create({ data });
    await prisma.marketingPageBlock.createMany({
      data: blocks.map((b) => ({ ...b, pageId: page.id })),
    });
    console.log(`Created /${SLUG} with ${blocks.length} blocks, in the navigation at position ${NAV_ORDER}.`);
  }

  await prisma.$disconnect();
};

run().catch(async (error) => {
  console.error('Could not seed the teams page:', error.message);
  await prisma.$disconnect();
  process.exit(1);
});
