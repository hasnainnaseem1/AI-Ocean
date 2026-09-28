import React, { useState, useEffect } from 'react';
import { useSite } from '../context/SiteContext';
import config from '../config';
import { ChevronDown, ChevronUp, Mail, Send, CheckCircle, Check, X, Copy } from 'lucide-react';
import { getIcon } from './icons';
import SmartLink from './SmartLink';
import useCatalogData from '../hooks/useCatalogData';
import { ModelCatalogBlock, GpuPricingBlock, UseCasesBlock, MachineCardsBlock } from './CatalogBlocks';
import ShowcaseBlock from './ShowcaseBlock';
import HeroCanvas from './HeroCanvas';
import Reveal from './Reveal';

/**
 * Renders the ordered content blocks an admin composed in the admin center.
 *
 * Every visual decision here comes from the CSS custom properties SiteContext
 * injects, which mirror the customer center's theme/colors.js — so a visitor
 * who signs up lands in an app that looks like the site that sold it to them.
 * Nothing in this file hardcodes a brand colour.
 */

/* ─── Shared shells ────────────────────────────────────────────
 * Ten blocks used to restate the same section padding, container width and
 * background-resolution logic. They now share these two, so changing the
 * rhythm of the page is one edit rather than ten.
 */
const Section = ({ block, tint = false, width = 'max-w-[1088px]', children }) => (
  <section
    className="py-16 md:py-24"
    style={{
      background: block.backgroundColor || (tint ? 'var(--surface-alt)' : 'var(--surface-page)'),
      color: block.textColor || undefined,
      backgroundImage: block.backgroundImage ? `url(${block.backgroundImage})` : undefined,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }}
  >
    <div className={`${width} mx-auto px-4 sm:px-6 lg:px-8`}>{children}</div>
  </section>
);

const SectionHeader = ({ block, align = 'center' }) => {
  if (!block.title) return null;
  // When an admin sets a text colour the whole section inherits it, so the
  // token classes must step aside rather than fight the choice.
  const ink = block.textColor ? '' : 'mkt-ink';
  const muted = block.textColor ? 'opacity-75' : 'mkt-muted';
  return (
    <Reveal className={`mb-14 ${align === 'center' ? 'text-center max-w-3xl mx-auto' : 'max-w-3xl'}`}>
      <h2 className={`text-3xl md:text-[40px] font-bold tracking-tight leading-[1.15] ${ink}`}>
        {block.title}
      </h2>
      {block.subtitle && (
        <p className={`text-lg mt-4 leading-relaxed ${muted}`}>{block.subtitle}</p>
      )}
    </Reveal>
  );
};

/** Feature flags decide whether a signup/login CTA is shown at all. */
const shouldShowAuthLink = (href, site) => {
  if (!href) return true;
  if (href.includes('/signup') && site?.enableCustomerSignup === false) return false;
  if (href.includes('/login') && site?.enableLogin === false) return false;
  return true;
};

/** The pair of CTA buttons that hero and cta blocks both offer. */
const BlockActions = ({ block, site, center = true }) => {
  const primaryHref = block.buttonLink || `${config.customerCenterUrl}/signup`;
  const secondaryHref = block.secondaryButtonLink || '';
  const showPrimary = block.buttonText && shouldShowAuthLink(primaryHref, site);
  const showSecondary = block.secondaryButtonText && shouldShowAuthLink(secondaryHref, site);
  if (!showPrimary && !showSecondary) return null;

  return (
    <div className={`flex flex-col sm:flex-row gap-3 ${center ? 'justify-center' : ''}`}>
      {showPrimary && (
        <SmartLink
          href={primaryHref}
          className="mkt-btn mkt-btn-primary px-7 py-3.5 text-[15px] text-center"
        >
          {block.buttonText}
        </SmartLink>
      )}
      {showSecondary && (
        <SmartLink
          href={secondaryHref}
          className="mkt-btn mkt-btn-ghost px-7 py-3.5 text-[15px] text-center"
        >
          {block.secondaryButtonText}
        </SmartLink>
      )}
    </div>
  );
};

/* ─── HERO ─────────────────────────────────────────────────── */
const HERO_ROTATE_MS = 4800;

const HeroBlock = ({ block }) => {
  const { site } = useSite();
  const ink = block.textColor ? '' : 'mkt-ink';
  const muted = block.textColor ? 'opacity-75' : 'mkt-muted';

  // The base title/subtitle is always variant 0 — SEO and non-JS fallbacks
  // stay tied to what an admin set as "the" headline. Any items an admin
  // adds become additional headlines that cycle in after it, the way
  // DigitalOcean's hero rotates between several pitches on the same page
  // instead of picking just one.
  const variants = [
    { title: block.title || site.siteName, subtitle: block.subtitle },
    ...(block.items || [])
      .filter((item) => item.title)
      .map((item) => ({ title: item.title, subtitle: item.description })),
  ];
  const [active, setActive] = useState(0);
  // 'entering' plays the arriving text in; 'leaving' plays the current text
  // out first, so a rotation reads as one piece of text stepping aside for
  // the next rather than the new one simply snapping into being.
  const [phase, setPhase] = useState('entering');

  useEffect(() => {
    if (variants.length < 2) return undefined;
    const holdTimer = setTimeout(() => {
      setPhase('leaving');
      const leaveTimer = setTimeout(() => {
        setActive((a) => (a + 1) % variants.length);
        setPhase('entering');
      }, 280);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      return () => clearTimeout(leaveTimer);
    }, HERO_ROTATE_MS);
    return () => clearTimeout(holdTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, variants.length]);

  const current = variants[active];
  const phaseClass = phase === 'leaving' ? 'hero-text-leaving' : 'hero-text-entering';

  return (
    <section
      className="relative overflow-hidden"
      style={{
        background: block.backgroundColor || 'var(--surface-page)',
        color: block.textColor || undefined,
        borderBottom: '1px solid var(--surface-border)',
      }}
    >
      {/* An atmospheric wash behind the headline. On a dark ground a flat fill
          reads as a slab; this is what gives the top of the page depth. An
          admin-supplied background image replaces it. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={block.backgroundImage
          ? {
              backgroundImage: `url(${block.backgroundImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              opacity: 0.5,
            }
          : { backgroundImage: 'var(--brand-glow)' }}
      />
      {/* Optional admin toggle — an animated wireframe-grid horizon, in the
          site's own accent colour, standing in for a background video. Off
          by default; only makes sense when there is no admin background
          image already doing this section's atmosphere. */}
      {block.settings?.gridBackground && !block.backgroundImage && (
        <HeroCanvas signature={block.settings?.heroStyle === 'signature'} />
      )}
      <div className="relative max-w-[1088px] mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-32">
        <div className="text-center max-w-4xl mx-auto">
          {block.content && (
            <span
              className="inline-block mb-6 px-3.5 py-1.5 text-[13px] font-semibold rounded-full"
              style={{
                background: 'var(--tint-pill)',
                color: 'var(--color-primary)',
              }}
            >
              {block.content}
            </span>
          )}
          {/* Plain ink, not gradient-clipped text: the old gradient heading cut
              off descenders on any headline that wrapped to a second line.
              Keyed by `active` so each rotation replays the slide-and-fade
              instead of snapping straight to the new words. A reserved
              min-height keeps the button row's position stable across
              rotations — without it, a longer variant pushed the buttons
              further down the page (and off-screen on shorter windows) than
              a shorter one did. */}
          <div className="min-h-[88px] md:min-h-[136px]">
            <h1
              key={`title-${active}`}
              className={`text-[40px] md:text-[62px] font-bold tracking-[-0.03em] leading-[1.08] ${phaseClass} ${ink}`}
            >
              {current.title}
            </h1>
          </div>
          {current.subtitle && (
            <div className="min-h-[88px] md:min-h-[98px] mt-6">
              <p
                key={`subtitle-${active}`}
                className={`text-lg md:text-xl max-w-2xl mx-auto leading-relaxed ${phaseClass} ${muted}`}
                style={phase === 'entering' ? { animationDelay: '60ms' } : undefined}
              >
                {current.subtitle}
              </p>
            </div>
          )}
          {variants.length > 1 && (
            <div className="flex items-center justify-center gap-2 mt-7" aria-hidden="true">
              {variants.map((_, idx) => (
                <span
                  key={idx}
                  className="h-1.5 rounded-full transition-all duration-300"
                  style={{
                    width: idx === active ? 20 : 6,
                    background: idx === active ? 'var(--color-primary)' : 'var(--surface-border)',
                  }}
                />
              ))}
            </div>
          )}
          <div className="mt-9">
            <BlockActions block={block} site={site} />
          </div>
        </div>
      </div>
    </section>
  );
};

/* ─── FEATURES ─────────────────────────────────────────────── */
const FeaturesBlock = ({ block }) => (
  <Section block={block} tint={block.settings?.tint}>
    <SectionHeader block={block} />
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {(block.items || []).map((item, idx) => (
        <Reveal key={idx} delay={Math.min(idx * 70, 350)} className="mkt-card mkt-card-hover p-7">
          <div className="mkt-tile w-12 h-12 flex items-center justify-center mb-5">
            {getIcon(item.icon, 'w-[22px] h-[22px]')}
          </div>
          <h3 className="text-[17px] font-bold mkt-ink mb-2.5">{item.title}</h3>
          <p className="mkt-muted leading-relaxed text-[15px]">{item.description}</p>
          {item.image && <img src={item.image} alt={item.title} className="mt-5 rounded-xl w-full" />}
          {item.link && (
            <SmartLink
              href={item.link}
              className="inline-flex items-center gap-1.5 mt-4 text-[14px] font-semibold"
              style={{ color: 'var(--color-primary)' }}
            >
              Learn more →
            </SmartLink>
          )}
        </Reveal>
      ))}
    </div>
  </Section>
);

/* ─── STEPS (how it works) ─────────────────────────────────── */
const StepsBlock = ({ block }) => (
  <Section block={block} tint={block.settings?.tint}>
    <SectionHeader block={block} />
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {(block.items || []).map((item, idx) => (
        <Reveal key={idx} delay={Math.min(idx * 90, 360)} className="relative">
          {/* The connector is decoration, not information — it stops before the
              last card so the sequence reads as ending, not continuing.
              The offsets assume this grid's gap-6 (24px) and the 48px circle:
              `-50%` carries the line across the gap to the next column, so it
              reaches the following circle instead of stopping at this cell's
              own edge and floating in mid-air. */}
          {idx < (block.items || []).length - 1 && (
            <div
              className="hidden lg:block absolute top-6 left-[calc(50%+28px)] right-[calc(-50%+4px)] h-px"
              style={{ background: 'var(--surface-border)' }}
            />
          )}
          <div className="relative text-center">
            <div
              className="w-12 h-12 mx-auto mb-5 flex items-center justify-center font-bold text-[17px] rounded-full relative z-10"
              style={{ background: 'var(--color-primary)', color: '#0B0E18' }}
            >
              {idx + 1}
            </div>
            <h3 className="text-[17px] font-bold mkt-ink mb-2.5">{item.title}</h3>
            <p className="mkt-muted leading-relaxed text-[15px]">{item.description}</p>
          </div>
        </Reveal>
      ))}
    </div>
  </Section>
);

/* ─── SPLIT (alternating text / visual) ──────────────────────
 * With images, this alternates text and picture down the page.
 *
 * Without them it does NOT hold the empty half open. An earlier version
 * rendered a 4:3 placeholder panel containing a copy of the icon already shown
 * beside the heading — which on a real page meant three ~440px near-empty grey
 * boxes stacked down the screen, each repeating a mark from a few pixels away.
 * It read as unfinished. So when no item in the block carries an image, the
 * block falls back to a narrower single column of substantial entries, which
 * is what this content actually is.
 */
const SplitItemBody = ({ item }) => (
  <>
    <h3 className="text-2xl md:text-[30px] font-bold mkt-ink tracking-tight leading-tight mb-4">
      {item.title}
    </h3>
    <p className="mkt-muted text-[16px] leading-relaxed whitespace-pre-line">{item.description}</p>
    {item.link && (
      <SmartLink
        href={item.link}
        className="inline-flex items-center gap-1.5 mt-6 font-semibold text-[15px]"
        style={{ color: 'var(--color-primary)' }}
      >
        Learn more →
      </SmartLink>
    )}
  </>
);

const SplitBlock = ({ block }) => {
  const items = block.items || [];
  const hasAnyImage = items.some((i) => i.image);

  if (!hasAnyImage) {
    return (
      <Section block={block} tint={block.settings?.tint} width="max-w-3xl">
        <SectionHeader block={block} align="center" />
        <div className="space-y-12">
          {items.map((item, idx) => (
            <Reveal
              key={idx}
              delay={Math.min(idx * 80, 320)}
              className="flex flex-col sm:flex-row gap-6"
              style={idx > 0 ? { borderTop: '1px solid var(--surface-border)', paddingTop: 48 } : undefined}
            >
              {item.icon && (
                <div className="mkt-tile w-12 h-12 flex items-center justify-center shrink-0">
                  {getIcon(item.icon, 'w-[22px] h-[22px]')}
                </div>
              )}
              <div className="min-w-0">
                <SplitItemBody item={item} />
              </div>
            </Reveal>
          ))}
        </div>
      </Section>
    );
  }

  return (
    <Section block={block} tint={block.settings?.tint}>
      <SectionHeader block={block} />
      <div className="space-y-20">
        {items.map((item, idx) => {
          const flip = idx % 2 === 1;
          return (
            <Reveal key={idx} className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              <div className={flip ? 'lg:order-2' : ''}>
                {item.icon && (
                  <div className="mkt-tile w-12 h-12 flex items-center justify-center mb-5">
                    {getIcon(item.icon, 'w-[22px] h-[22px]')}
                  </div>
                )}
                <SplitItemBody item={item} />
              </div>
              <div className={flip ? 'lg:order-1' : ''}>
                {item.image ? (
                  <img src={item.image} alt={item.title} className="w-full rounded-2xl mkt-card" />
                ) : (
                  /* Only reachable when SOME item has an image and this one
                     does not — a thin rule keeps the row balanced without
                     pretending there is a picture. */
                  <div className="h-px w-full" style={{ background: 'var(--surface-border)' }} />
                )}
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
};

/* ─── CODE SAMPLE ──────────────────────────────────────────── */
const CodeSampleBlock = ({ block }) => {
  const samples = block.items || [];
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  if (!samples.length) return null;

  const current = samples[Math.min(active, samples.length - 1)];

  const copy = () => {
    navigator.clipboard?.writeText(current.description || '').then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1600); },
      () => {}
    );
  };

  return (
    <Section block={block} tint={block.settings?.tint} width="max-w-5xl">
      <SectionHeader block={block} />
      <Reveal className="rounded-2xl overflow-hidden" style={{ background: '#12162A', border: '1px solid #242942' }}>
        <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid #242942' }}>
          <div className="flex gap-1 overflow-x-auto">
            {samples.map((s, i) => (
              <button
                key={i}
                onClick={() => setActive(i)}
                className="px-3.5 py-2 text-[13px] font-medium rounded-lg whitespace-nowrap transition-colors"
                style={i === active
                  ? { background: 'rgba(255,255,255,0.10)', color: '#fff' }
                  : { color: '#8A90AB' }}
              >
                {s.title || `Example ${i + 1}`}
              </button>
            ))}
          </div>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-lg shrink-0"
            style={{ color: copied ? '#4FCB8C' : '#8A90AB' }}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="p-6 overflow-x-auto text-[13.5px] leading-relaxed" style={{ color: '#E6E8EC' }}>
          <code style={{ fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            {current.description}
          </code>
        </pre>
      </Reveal>
    </Section>
  );
};

/* ─── LOGOS / SUPPORTED MODELS STRIP ─────────────────────────
 * With `settings.source = 'models'` the names come from the live catalogue
 * rather than from items an admin typed. That matters here more than anywhere:
 * a hand-typed strip of model names is exactly the thing that keeps advertising
 * a model months after it was removed from the catalogue.
 */
const LogosBlock = ({ block }) => {
  const live = useCatalogData(
    block.settings?.source === 'models' ? '/api/v1/public/catalog/models' : null,
    (j) => j.models
  );

  const items = block.settings?.source === 'models'
    ? (live || []).map((m) => ({ title: m.name, image: m.logoUrl || '' }))
    : (block.items || []);

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const handler = (e) => setReduceMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (!items.length) return null;

  const renderItem = (item, idx) =>
    item.image ? (
      <img key={idx} src={item.image} alt={item.title} className="h-7 w-auto opacity-60 shrink-0" />
    ) : (
      <span key={idx} className="text-[17px] font-semibold mkt-muted opacity-80 whitespace-nowrap shrink-0">
        {item.title}
      </span>
    );

  // A static wrap is what you actually want for a short, fixed list — a
  // marquee with only a couple of names either loops with an awkward gap or
  // has to be stretched to fill the row. It becomes the better fit once the
  // catalogue is long enough to need it, which is exactly when the old
  // wrapped layout also started running to a second and third line.
  const useMarquee = !reduceMotion && items.length >= 6;

  return (
    <section
      className="py-14 overflow-hidden"
      style={{
        background: block.backgroundColor || 'var(--surface-page)',
        borderBottom: '1px solid var(--surface-border)',
      }}
    >
      {block.title && (
        <div className="max-w-[1088px] mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal as="p" className="text-center text-[12px] font-bold uppercase tracking-[0.09em] mkt-faint mb-8">
            {block.title}
          </Reveal>
        </div>
      )}
      {useMarquee ? (
        <div
          className="relative"
          style={{
            maskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)',
            WebkitMaskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)',
          }}
        >
          <div className="marquee-track flex items-center gap-x-14 w-max">
            {[...items, ...items].map((item, idx) => renderItem(item, idx))}
          </div>
        </div>
      ) : (
        <div className="max-w-[1088px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
            {items.map((item, idx) => renderItem(item, idx))}
          </div>
        </div>
      )}
    </section>
  );
};

/* ─── COMPARISON TABLE ─────────────────────────────────────── */
const ComparisonBlock = ({ block }) => {
  const columns = block.settings?.columns || [];
  const rows = block.items || [];
  if (!rows.length) return null;

  // A bare "yes"/"no" cell reads better as a mark than as a word.
  const renderCell = (value) => {
    const v = String(value ?? '').trim().toLowerCase();
    if (['yes', 'true', '✓', 'y'].includes(v)) return <Check className="w-[18px] h-[18px] mx-auto" style={{ color: '#22A565' }} />;
    if (['no', 'false', '✗', 'x', 'n', '-'].includes(v)) return <X className="w-[18px] h-[18px] mx-auto" style={{ color: '#C2C7DA' }} />;
    return <span className="mkt-ink text-[14.5px]">{value}</span>;
  };

  return (
    <Section block={block} tint={block.settings?.tint} width="max-w-5xl">
      <SectionHeader block={block} />
      <Reveal className="mkt-card overflow-x-auto">
        <table className="w-full text-left" style={{ borderCollapse: 'collapse', minWidth: 520 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--surface-border)' }}>
              <th className="px-6 py-4 text-[13px] font-bold uppercase tracking-wide mkt-muted">
                {columns[0] || ''}
              </th>
              {columns.slice(1).map((c, i) => (
                <th
                  key={i}
                  className="px-6 py-4 text-[13px] font-bold uppercase tracking-wide text-center"
                  style={i === 0 ? { color: 'var(--color-primary)' } : { color: 'var(--surface-ink-muted)' }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ borderBottom: ri < rows.length - 1 ? '1px solid var(--surface-border)' : 'none' }}>
                <td className="px-6 py-4 mkt-ink font-medium text-[15px]">{row.title}</td>
                {(row.features || []).map((cell, ci) => (
                  <td key={ci} className="px-6 py-4 text-center">{renderCell(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Reveal>
    </Section>
  );
};

/* ─── PRICING ──────────────────────────────────────────────── */
const PricingBlock = ({ block }) => {
  const { site } = useSite();
  return (
    <Section block={block} tint={block.settings?.tint !== false}>
      <SectionHeader block={block} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
        {(block.items || []).map((plan, idx) => {
          const planHref = plan.link || `${config.customerCenterUrl}/signup`;
          return (
            // items-stretch + flex column: the old grid left the shorter cards
            // with dead space under their buttons instead of aligning them.
            <Reveal
              key={idx}
              delay={Math.min(idx * 80, 320)}
              className="mkt-card p-7 flex flex-col relative"
              style={plan.highlighted
                ? { borderColor: 'var(--color-primary)', boxShadow: 'var(--surface-shadow-lg)' }
                : undefined}
            >
              {plan.highlighted && (
                <div
                  className="absolute -top-3 left-7 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide"
                  style={{ background: 'var(--color-primary)', color: '#0B0E18' }}
                >
                  Popular
                </div>
              )}
              <h3 className="text-[17px] font-bold mkt-ink mb-3">{plan.title}</h3>
              <div className="text-[34px] font-bold mkt-ink tracking-tight mb-1">{plan.price || 'Free'}</div>
              {plan.description && <p className="mkt-muted text-[14.5px] mb-6 leading-relaxed">{plan.description}</p>}
              <ul className="space-y-3 mb-8">
                {(plan.features || []).map((feature, fidx) => (
                  <li key={fidx} className="flex items-start gap-2.5">
                    <Check className="w-[17px] h-[17px] mt-0.5 shrink-0" style={{ color: 'var(--color-primary)' }} />
                    <span className="mkt-muted text-[14.5px] leading-relaxed">{feature}</span>
                  </li>
                ))}
              </ul>
              {shouldShowAuthLink(planHref, site) && (
                <SmartLink
                  href={planHref}
                  className="mkt-btn block w-full text-center py-3 mt-auto text-[15px]"
                  style={plan.highlighted
                    ? { background: 'var(--color-primary)', color: '#0B0E18' }
                    : { border: '1px solid var(--surface-border)', color: 'var(--surface-ink)' }}
                >
                  Get started
                </SmartLink>
              )}
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
};

/* ─── CTA ──────────────────────────────────────────────────── */
const CtaBlock = ({ block }) => {
  const { site } = useSite();
  return (
    <section className="py-16 md:py-24" style={{ background: block.backgroundColor || 'var(--surface-page)' }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* A lifted panel lit from below rather than a solid gradient slab: on a
            dark page a saturated block fights the ground, while a glow reads as
            the page brightening toward its final call. */}
        <Reveal
          className="relative overflow-hidden rounded-3xl px-8 py-14 md:px-16 md:py-16 text-center"
          style={{ background: 'var(--surface-alt)', boxShadow: 'inset 0 0 0 1.5px var(--surface-border)' }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                'radial-gradient(ellipse 70% 90% at 50% 115%, rgba(var(--color-primary-rgb), 0.30), transparent 70%)',
            }}
          />
          <div className="relative">
            <h2 className="text-3xl md:text-[40px] font-bold mkt-ink tracking-tight leading-[1.15]">
              {block.title}
            </h2>
            {block.subtitle && (
              <p className="text-lg mt-4 max-w-2xl mx-auto leading-relaxed mkt-muted">{block.subtitle}</p>
            )}
            <div className="mt-9">
              <BlockActions block={block} site={site} />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
};

/* ─── FAQ ──────────────────────────────────────────────────── */
const FaqBlock = ({ block }) => {
  const [openIndex, setOpenIndex] = useState(null);
  return (
    <Section block={block} tint={block.settings?.tint} width="max-w-3xl">
      <SectionHeader block={block} />
      <div className="space-y-3">
        {(block.items || []).map((item, idx) => {
          const open = openIndex === idx;
          return (
            <Reveal key={idx} delay={Math.min(idx * 50, 250)} className="mkt-card overflow-hidden">
              <button
                className="w-full flex justify-between items-center gap-4 p-5 text-left"
                onClick={() => setOpenIndex(open ? null : idx)}
                aria-expanded={open}
              >
                <span className="text-[16px] font-semibold mkt-ink">{item.title}</span>
                {open
                  ? <ChevronUp className="w-[18px] h-[18px] shrink-0 mkt-muted" />
                  : <ChevronDown className="w-[18px] h-[18px] shrink-0 mkt-muted" />}
              </button>
              {open && (
                <div className="px-5 pb-5 mkt-muted leading-relaxed text-[15px] whitespace-pre-line">
                  {item.description}
                </div>
              )}
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
};

/* ─── TEXT ─────────────────────────────────────────────────── */
const TextBlock = ({ block }) => (
  <Section block={block} tint={block.settings?.tint} width="max-w-3xl">
    <Reveal>
      {block.title && (
        <h2 className="text-3xl md:text-[36px] font-bold mkt-ink tracking-tight mb-4">{block.title}</h2>
      )}
      {block.subtitle && <p className="text-lg mkt-muted mb-8 leading-relaxed">{block.subtitle}</p>}
      {block.content && (
        <div className="prose prose-lg max-w-none mkt-muted leading-relaxed whitespace-pre-line">
          {block.content}
        </div>
      )}
    </Reveal>
  </Section>
);

/* ─── CONTACT ──────────────────────────────────────────────── */
const ContactBlock = ({ block }) => {
  const { site } = useSite();
  const [formData, setFormData] = useState({ name: '', email: '', subject: '', message: '' });
  const [submitted, setSubmitted] = useState(false);

  const inputStyle = {
    border: '1px solid var(--surface-border)',
    borderRadius: 10,
    background: 'var(--surface-page)',
    color: 'var(--surface-ink)',
  };

  return (
    <Section block={block} tint={block.settings?.tint !== false}>
      <SectionHeader block={block} />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        <Reveal className="mkt-card p-8 lg:col-span-3">
          {submitted ? (
            <div className="text-center py-14">
              <CheckCircle className="w-14 h-14 mx-auto mb-4" style={{ color: '#22A565' }} />
              <h3 className="text-xl font-bold mkt-ink mb-2">Message sent</h3>
              <p className="mkt-muted">We&apos;ll get back to you shortly.</p>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-[13.5px] font-semibold mkt-ink mb-2">Name</label>
                  <input type="text" required className="w-full px-4 py-3 outline-none" style={inputStyle}
                    value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
                </div>
                <div>
                  <label className="block text-[13.5px] font-semibold mkt-ink mb-2">Email</label>
                  <input type="email" required className="w-full px-4 py-3 outline-none" style={inputStyle}
                    value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-[13.5px] font-semibold mkt-ink mb-2">Subject</label>
                <input type="text" className="w-full px-4 py-3 outline-none" style={inputStyle}
                  value={formData.subject} onChange={(e) => setFormData({ ...formData, subject: e.target.value })} />
              </div>
              <div>
                <label className="block text-[13.5px] font-semibold mkt-ink mb-2">Message</label>
                <textarea rows={5} required className="w-full px-4 py-3 outline-none resize-none" style={inputStyle}
                  value={formData.message} onChange={(e) => setFormData({ ...formData, message: e.target.value })} />
              </div>
              <button
                type="submit"
                className="mkt-btn w-full py-3.5 flex items-center justify-center gap-2 text-[15px]"
                style={{ background: 'var(--color-primary)', color: '#0B0E18' }}
              >
                <Send className="w-[17px] h-[17px]" /> Send message
              </button>
            </form>
          )}
        </Reveal>

        <div className="lg:col-span-2 space-y-4">
          {block.content && (
            <Reveal delay={60} className="mkt-card p-6">
              <p className="mkt-muted leading-relaxed whitespace-pre-line text-[15px]">{block.content}</p>
            </Reveal>
          )}
          {/* The site-wide contact email is only shown when the admin has not
              already listed an email card of their own — the old version always
              rendered both, so the page showed two cards labelled "Email". */}
          {site.contactEmail && !(block.items || []).some((i) => /mail/i.test(i.icon || i.title || '')) && (
            <Reveal delay={110} className="mkt-card p-5 flex items-center gap-4">
              <div className="mkt-tile w-11 h-11 flex items-center justify-center shrink-0">
                <Mail className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="font-semibold mkt-ink text-[15px]">Email</h4>
                <a href={`mailto:${site.contactEmail}`} className="text-[14px] break-all" style={{ color: 'var(--color-primary)' }}>
                  {site.contactEmail}
                </a>
              </div>
            </Reveal>
          )}
          {(block.items || []).map((item, idx) => (
            <Reveal key={idx} delay={Math.min(110 + (idx + 1) * 50, 300)} className="mkt-card p-5 flex items-center gap-4">
              <div className="mkt-tile w-11 h-11 flex items-center justify-center shrink-0">
                {getIcon(item.icon, 'w-5 h-5')}
              </div>
              <div className="min-w-0">
                <h4 className="font-semibold mkt-ink text-[15px]">{item.title}</h4>
                <p className="mkt-muted text-[14px] break-words">{item.description}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
};

/* ─── STATS ────────────────────────────────────────────────── */
const StatsBlock = ({ block }) => {
  const items = block.items || [];
  if (!items.length) return null;
  return (
    <Section block={block} tint={block.settings?.tint !== false}>
      {block.title && (
        <Reveal as="h2" className="text-2xl md:text-[30px] font-bold mkt-ink tracking-tight text-center mb-12">
          {block.title}
        </Reveal>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {items.map((item, idx) => (
          <Reveal key={idx} delay={Math.min(idx * 70, 280)} className="mkt-card p-7 text-center">
            <div
              className="text-[34px] md:text-[40px] font-bold tracking-tight mb-1.5"
              style={{ color: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums' }}
            >
              {item.title}
            </div>
            <div className="mkt-muted text-[14.5px]">{item.description}</div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
};

/* ─── TESTIMONIALS ─────────────────────────────────────────── */
const TestimonialsBlock = ({ block }) => (
  <Section block={block} tint={block.settings?.tint}>
    <SectionHeader block={block} />
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {(block.items || []).map((item, idx) => (
        <Reveal key={idx} delay={Math.min(idx * 70, 350)} className="mkt-card p-7 flex flex-col">
          <p className="mkt-ink mb-6 leading-relaxed text-[15.5px] flex-1">“{item.description}”</p>
          <div className="flex items-center gap-3">
            {item.image ? (
              <img src={item.image} alt={item.title} className="w-11 h-11 rounded-full object-cover" />
            ) : (
              <div className="mkt-tile w-11 h-11 rounded-full flex items-center justify-center font-bold">
                {(item.title || '?')[0]}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-semibold mkt-ink text-[14.5px]">{item.title}</div>
              {item.icon && <div className="text-[13px] mkt-muted">{item.icon}</div>}
            </div>
          </div>
        </Reveal>
      ))}
    </div>
  </Section>
);

/* ─── CUSTOM HTML ──────────────────────────────────────────── */
const CustomBlock = ({ block }) => (
  <section style={{ background: block.backgroundColor || undefined, color: block.textColor || undefined }}>
    <div dangerouslySetInnerHTML={{ __html: block.content || '' }} />
  </section>
);

/* ─── REGISTRY ─────────────────────────────────────────────── */
const blockComponents = {
  hero: HeroBlock,
  features: FeaturesBlock,
  pricing: PricingBlock,
  cta: CtaBlock,
  faq: FaqBlock,
  text: TextBlock,
  contact: ContactBlock,
  stats: StatsBlock,
  testimonials: TestimonialsBlock,
  custom: CustomBlock,
  steps: StepsBlock,
  split: SplitBlock,
  code_sample: CodeSampleBlock,
  logos: LogosBlock,
  comparison: ComparisonBlock,
  product_showcase: ShowcaseBlock,
  // Rendered from live catalogue data rather than hand-entered content
  model_catalog: ModelCatalogBlock,
  gpu_pricing: GpuPricingBlock,
  use_cases: UseCasesBlock,
  machine_cards: MachineCardsBlock,
};

const BlockRenderer = ({ blocks = [] }) => (
  <>
    {blocks.map((block, idx) => {
      const Component = blockComponents[block.type];
      if (!Component) return null;
      // `visible` is the admin's per-block on/off switch; it was defined in the
      // schema but never honoured here, so hidden blocks still rendered.
      if (block.visible === false) return null;
      return <Component key={block.id || idx} block={block} />;
    })}
  </>
);

export default BlockRenderer;
