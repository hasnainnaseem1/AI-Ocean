import React, { useEffect, useState } from 'react';
import { getIcon } from './icons';
import Reveal from './Reveal';

/**
 * An auto-advancing, click-to-jump tabbed tour — the product's own screens,
 * not a description of them. Each item's `image` is a real screenshot (an
 * admin uploads it like any other block image); the tab list on the left
 * doubles as a table of contents and a per-tab progress indicator, the way a
 * story viewer or DigitalOcean's homepage "layers" selector works.
 *
 * Kept in its own file, like CatalogBlocks.js, because it carries local
 * timer state BlockRenderer's mostly-stateless blocks don't need.
 */
const AUTO_ADVANCE_MS = 5000;

const SectionHeader = ({ block }) =>
  block.title ? (
    <Reveal className="text-center mb-14 max-w-3xl mx-auto">
      <h2 className="text-3xl md:text-[40px] font-bold mkt-ink tracking-tight leading-[1.15]">
        {block.title}
      </h2>
      {block.subtitle && <p className="text-lg mkt-muted mt-4 leading-relaxed">{block.subtitle}</p>}
    </Reveal>
  ) : null;

const ShowcaseBlock = ({ block }) => {
  const items = block.items || [];
  const [active, setActive] = useState(0);

  // Re-arms on every change to `active`, whether that came from the timer
  // itself or a manual tab click — so clicking a tab always gives the visitor
  // a full AUTO_ADVANCE_MS before it moves on again, not a partial one.
  useEffect(() => {
    if (items.length < 2) return undefined;
    const timer = setTimeout(() => setActive((a) => (a + 1) % items.length), AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [active, items.length]);

  if (items.length === 0) return null;
  const current = items[active];

  return (
    <section
      className="py-16 md:py-24"
      style={{
        background: block.backgroundColor || (block.settings?.tint ? 'var(--surface-alt)' : 'var(--surface-page)'),
        color: block.textColor || undefined,
      }}
    >
      <div className="max-w-[1088px] mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader block={block} />

        <Reveal className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-8 lg:gap-12 items-center">
          {/* Tabs */}
          <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible -mx-4 px-4 lg:mx-0 lg:px-0 pb-2 lg:pb-0">
            {items.map((item, idx) => {
              const isActive = idx === active;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActive(idx)}
                  className="text-left shrink-0 lg:shrink w-[260px] lg:w-auto p-4 rounded-xl transition-colors"
                  style={{
                    background: isActive ? 'var(--surface-card)' : 'transparent',
                    boxShadow: isActive ? 'inset 0 0 0 1px var(--surface-border)' : 'none',
                  }}
                >
                  <div className="flex items-center gap-3 mb-1.5">
                    {item.icon && (
                      <div className="mkt-tile w-8 h-8 flex items-center justify-center shrink-0">
                        {getIcon(item.icon, 'w-4 h-4')}
                      </div>
                    )}
                    <h3 className={`text-[15px] font-bold leading-snug ${isActive ? 'mkt-ink' : 'mkt-muted'}`}>
                      {item.title}
                    </h3>
                  </div>
                  {item.description && (
                    <p className="text-[13.5px] mkt-muted leading-relaxed hidden lg:block pl-11">
                      {item.description}
                    </p>
                  )}
                  <div
                    className="h-[2px] rounded-full mt-3 overflow-hidden"
                    style={{ background: 'var(--surface-border)' }}
                  >
                    {isActive && (
                      <div
                        key={active}
                        className="showcase-progress-fill h-full"
                        style={{ background: 'var(--color-primary)', animationDuration: `${AUTO_ADVANCE_MS}ms` }}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Screenshot panel — a light window-chrome frame around the image,
              since these are real screens and a bare edge-to-edge screenshot
              on a dark page reads as a stray rectangle rather than "an app". */}
          <div className="mkt-card p-3 md:p-4">
            <div className="flex items-center gap-1.5 px-2 pb-3">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FF5F57' }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FEBC2E' }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#28C840' }} />
            </div>
            {/*
              A fixed frame height, not "however tall each screenshot is" —
              the four captures were cropped from different parts of the
              product (an 8-option question list, a 4-card recommendation
              grid, a compact summary card), so their natural heights vary a
              lot. Left alone, the whole panel resized every time a tab
              changed, which read as the layout jumping around rather than
              one steady window showing different screens. object-contain
              keeps every screenshot's own proportions intact — nothing is
              stretched or cropped — it just centres within the same box.
            */}
            <div
              className="rounded-lg overflow-hidden h-[420px] md:h-[520px]"
              style={{ background: '#F4F6FB' }}
            >
              {current.image ? (
                <img
                  key={active}
                  src={current.image}
                  alt={current.title || ''}
                  className="w-full h-full object-contain object-top block showcase-fade"
                />
              ) : (
                <div className="aspect-[16/10]" />
              )}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
};

export default ShowcaseBlock;
