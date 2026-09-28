import React from 'react';
import { Cpu, Zap, ArrowRight, Check } from 'lucide-react';
import { useSite } from '../context/SiteContext';
import { getIcon } from './icons';
import SmartLink from './SmartLink';
import Reveal from './Reveal';
import useCatalogData from '../hooks/useCatalogData';
import config from '../config';

/**
 * Marketing blocks that render live data from the catalogue.
 *
 * All three fetch from the public API, so what the marketing site claims is
 * always what the admin actually configured — no model list, price or use case
 * is retyped into page content where it could drift. They render nothing when
 * the API is unreachable or the list is empty, so a page never shows a broken
 * or half-filled section.
 */

const MODALITY_LABELS = {
  chat: 'Chat',
  completion: 'Completion',
  code: 'Code',
  vision: 'Vision',
  image_generation: 'Image generation',
  embedding: 'Embeddings',
  audio: 'Audio',
};

const SectionHeader = ({ block }) =>
  block.title ? (
    <Reveal className="text-center mb-14 max-w-3xl mx-auto">
      <h2 className="text-3xl md:text-[40px] font-bold mkt-ink tracking-tight leading-[1.15]">
        {block.title}
      </h2>
      {block.subtitle && <p className="text-lg mkt-muted mt-4 leading-relaxed">{block.subtitle}</p>}
    </Reveal>
  ) : null;

const CtaLink = ({ href, children }) => (
  <SmartLink
    href={href}
    className="mkt-btn inline-flex items-center gap-2 px-7 py-3.5 text-[15px]"
    style={{ background: 'var(--color-primary)', color: '#0B0E18' }}
  >
    {children} <ArrowRight className="w-[18px] h-[18px]" />
  </SmartLink>
);

/* ─── MODEL CATALOG ────────────────────────────────────────────
 * The models a customer can deploy, with the cheapest hourly rate each runs at.
 * settings.limit caps how many show; settings.featuredOnly narrows the list.
 */
export const ModelCatalogBlock = ({ block }) => {
  const { site } = useSite();
  const all = useCatalogData('/api/v1/public/catalog/models', (j) => j.models);

  if (!all || all.length === 0) return null;

  let models = all;
  if (block.settings?.featuredOnly) models = models.filter((m) => m.isFeatured);
  if (block.settings?.limit) models = models.slice(0, Number(block.settings.limit));
  if (!models.length) return null;

  const showSignup = site?.enableCustomerSignup !== false;

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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {models.map((model, idx) => (
            <Reveal key={model.id} delay={Math.min(idx * 70, 350)} className="mkt-card mkt-card-hover p-7 flex flex-col">
              <div className="flex items-start justify-between gap-3 mb-3.5">
                <span
                  className="inline-block px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide"
                  style={{ background: 'var(--tint-pill)', color: 'var(--color-primary)' }}
                >
                  {model.family}
                </span>
                {model.status === 'coming_soon' && (
                  <span
                    className="inline-block px-2.5 py-1 rounded-md text-[11px] font-semibold"
                    style={{ background: 'var(--surface-alt)', color: 'var(--surface-ink-muted)' }}
                  >
                    Coming soon
                  </span>
                )}
              </div>

              <h3 className="text-[19px] font-bold mkt-ink mb-2">{model.name}</h3>
              <p className="mkt-muted mb-5 flex-grow text-[15px] leading-relaxed">{model.shortDescription}</p>

              <div className="flex flex-wrap gap-1.5 mb-5">
                {(model.modalities || []).map((m) => (
                  <span
                    key={m}
                    className="text-[12px] px-2.5 py-1 rounded-md mkt-muted"
                    style={{ background: 'var(--surface-alt)' }}
                  >
                    {MODALITY_LABELS[m] || m}
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-4 text-[13.5px] mkt-muted mb-5">
                {model.parameterSize && (
                  <span className="flex items-center gap-1.5"><Cpu className="w-4 h-4" /> {model.parameterSize}</span>
                )}
                {model.contextLength > 0 && <span>{(model.contextLength / 1000).toFixed(0)}K context</span>}
              </div>

              <div
                className="flex items-end justify-between pt-5"
                style={{ borderTop: '1px solid var(--surface-border)' }}
              >
                <div>
                  <div className="text-[12px] mkt-muted">from</div>
                  <div
                    className="text-[26px] font-bold tracking-tight"
                    style={{ color: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {model.startingPricePerHour !== null ? `$${model.startingPricePerHour.toFixed(2)}` : '—'}
                    <span className="text-[14px] font-normal mkt-muted">/hr</span>
                  </div>
                </div>
                {showSignup && (
                  <a
                    href={`${config.customerCenterUrl}/signup`}
                    className="mkt-btn inline-flex items-center gap-1.5 px-4 py-2.5 text-[14px]"
                    style={{ background: 'var(--color-primary)', color: '#0B0E18' }}
                  >
                    Deploy <ArrowRight className="w-4 h-4" />
                  </a>
                )}
              </div>
            </Reveal>
          ))}
        </div>

        {block.buttonText && block.buttonLink && (
          <div className="text-center mt-12">
            <CtaLink href={block.buttonLink}>{block.buttonText}</CtaLink>
          </div>
        )}
      </div>
    </section>
  );
};

/* ─── USE CASES ────────────────────────────────────────────────
 * The same vocabulary the deployment questionnaire uses, so "what can you
 * build here" is answered by the catalogue itself rather than by a list
 * someone typed onto a page and forgot to update.
 */
export const UseCasesBlock = ({ block }) => {
  const all = useCatalogData('/api/v1/public/catalog/use-cases', (j) => j.useCases);

  if (!all || all.length === 0) return null;

  let useCases = all;
  if (block.settings?.limit) useCases = useCases.slice(0, Number(block.settings.limit));

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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {useCases.map((uc, idx) => (
            /* flex column + mt-auto on the footer line: descriptions differ in
               length, and without this the availability line sits wherever the
               text ends, so the row's lines never align. */
            <Reveal key={uc.key} delay={Math.min(idx * 70, 350)} className="mkt-card mkt-card-hover p-7 flex flex-col">
              <div className="mkt-tile w-12 h-12 flex items-center justify-center mb-5">
                {getIcon(uc.icon || 'sparkles', 'w-[22px] h-[22px]')}
              </div>
              <h3 className="text-[17px] font-bold mkt-ink mb-2.5">{uc.label}</h3>
              {uc.description && (
                <p className="mkt-muted leading-relaxed text-[15px] mb-4 flex-1">{uc.description}</p>
              )}
              <div
                className="text-[13px] font-semibold mt-auto pt-1"
                style={{ color: uc.modelCount > 0 ? 'var(--color-primary)' : 'var(--surface-ink-muted)' }}
              >
                {uc.modelCount > 0
                  ? `${uc.modelCount} ${uc.modelCount === 1 ? 'model' : 'models'} available`
                  : 'Coming soon'}
              </div>
            </Reveal>
          ))}
        </div>

        {block.buttonText && block.buttonLink && (
          <div className="text-center mt-12">
            <CtaLink href={block.buttonLink}>{block.buttonText}</CtaLink>
          </div>
        )}
      </div>
    </section>
  );
};

/* ─── MACHINE PRICING ──────────────────────────────────────────
 * Two prices per machine: running, and the smaller amount charged while a
 * deployment is paused and only its disk is still held. Both come from the
 * server so this table can never quote a rate we do not bill.
 */
export const GpuPricingBlock = ({ block }) => {
  const { site } = useSite();
  const tiers = useCatalogData('/api/v1/public/catalog/tiers', (j) => j.tiers);

  if (!tiers || tiers.length === 0) return null;

  const showSignup = site?.enableCustomerSignup !== false;

  /*
   * "Pause any time to stop charges" used to sit here as a hardcoded claim. It
   * stopped being true the moment a paused deployment kept its disk, and a
   * pricing page that overstates what pausing saves is the kind of thing people
   * find out from a bill. The notes are now admin-editable (block items), with
   * these accurate lines as the fallback.
   */
  const notes = (block.items || []).length
    ? block.items.map((i) => i.title)
    : [
        'Compute billed by the hour, only while running',
        'Pause any time — you keep your disk and pay only for that',
        'Dedicated machines, no noisy neighbours',
      ];

  const th = 'px-6 py-4 text-[12px] font-bold uppercase tracking-wide mkt-muted';

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

        <Reveal className="mkt-card overflow-hidden">
          <div className="overflow-x-auto">
            {/* A full specification table, in the shape someone comparing
                machines actually reads: identity, then what is inside it, then
                the three prices. Every column is a field on the tier record —
                nothing here is transcribed. */}
            <table className="w-full text-left" style={{ minWidth: 1360 }}>
              <thead style={{ background: 'var(--surface-alt)' }}>
                <tr style={{ borderBottom: '1px solid var(--surface-border)' }}>
                  <th className={th}>Machine</th>
                  <th className={th}>GPU</th>
                  <th className={`${th} text-right`}>GPU memory</th>
                  <th className={`${th} text-right`}>vCPUs</th>
                  <th className={`${th} text-right`}>RAM</th>
                  <th className={`${th} text-right`}>Storage</th>
                  <th className={`${th} text-right`}>Network</th>
                  <th className={`${th} text-right`}>Per hour</th>
                  <th className={`${th} text-right`}>Per month</th>
                  <th className={`${th} text-right`}>Paused</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((tier, i) => {
                  const num = 'px-5 py-5 text-right text-[14.5px] mkt-muted';
                  return (
                    <tr
                      key={tier.id}
                      style={{ borderBottom: i < tiers.length - 1 ? '1px solid var(--surface-border)' : 'none' }}
                    >
                      <td className="px-5 py-5">
                        <div className="font-semibold mkt-ink text-[15px]">{tier.name}</div>
                        {tier.category && (
                          <div className="text-[13px] mkt-faint mt-0.5">{tier.category.name}</div>
                        )}
                      </td>
                      {/* Only claim an accelerator when the machine has one —
                          the catalogue also holds CPU and memory machines. */}
                      <td className="px-5 py-5 text-[14.5px]">
                        {tier.gpuCount > 0 ? (
                          <span className="flex items-center gap-1.5 mkt-ink">
                            <Zap className="w-3.5 h-3.5" style={{ color: 'var(--color-primary)' }} />
                            {tier.gpuCount}× {tier.gpuModel}
                          </span>
                        ) : (
                          <span className="mkt-faint">—</span>
                        )}
                      </td>
                      <td className={num} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {tier.vramGb > 0 ? `${tier.vramGb} GB` : '—'}
                      </td>
                      <td className={num} style={{ fontVariantNumeric: 'tabular-nums' }}>{tier.vcpu}</td>
                      <td className={num} style={{ fontVariantNumeric: 'tabular-nums' }}>{tier.ramGb} GB</td>
                      <td className={num} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {tier.storageGb > 0 ? `${tier.storageGb} GB` : '—'}
                        {tier.storageGb > 0 && tier.storageType && (
                          <div className="text-[12.5px] mkt-faint">{tier.storageType}</div>
                        )}
                      </td>
                      <td className={num} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {tier.networkGbps > 0 ? `${tier.networkGbps} Gbps` : '—'}
                      </td>
                      <td className="px-5 py-5 text-right">
                        <span
                          className="text-[17px] font-bold"
                          style={{ color: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums' }}
                        >
                          ${tier.pricePerHour.toFixed(2)}
                        </span>
                      </td>
                      <td className={num} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        ${Math.round(tier.pricePerHour * 730).toLocaleString()}
                      </td>
                      <td className="px-5 py-5 text-right text-[14.5px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {tier.stoppedPricePerHour > 0 ? (
                          <>
                            <div className="mkt-ink">${tier.stoppedPricePerHour.toFixed(2)}</div>
                            <div className="text-[12.5px] mkt-faint">disk only</div>
                          </>
                        ) : (
                          <span className="mkt-faint">Free</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Reveal>

        <Reveal delay={80} className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[14.5px] mkt-muted">
          {notes.map((note, i) => (
            <span key={i} className="flex items-center gap-2">
              <Check className="w-4 h-4" style={{ color: '#22A565' }} /> {note}
            </span>
          ))}
        </Reveal>

        {showSignup && (
          <div className="text-center mt-10">
            <CtaLink href={block.buttonLink || `${config.customerCenterUrl}/signup`}>
              {block.buttonText || 'Get started'}
            </CtaLink>
          </div>
        )}
      </div>
    </section>
  );
};

/* ─── MACHINE CARDS ────────────────────────────────────────────
 * The machine line-up as cards rather than a table row: what each one is FOR,
 * before what it costs. A spec table answers "which is bigger"; it does not
 * answer "which should I pick", which is the question someone arrives with.
 *
 * Everything here — the name, the use-case line, every spec and both prices —
 * comes from the tier record an admin edits under AI Infrastructure → Tiers.
 */
export const MachineCardsBlock = ({ block }) => {
  const { site } = useSite();
  const all = useCatalogData('/api/v1/public/catalog/tiers', (j) => j.tiers);

  if (!all || all.length === 0) return null;

  let tiers = all;
  if (block.settings?.limit) tiers = tiers.slice(0, Number(block.settings.limit));

  const showSignup = site?.enableCustomerSignup !== false;

  const Spec = ({ label, value }) => (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[13px] mkt-faint">{label}</span>
      <span className="text-[13.5px] mkt-ink" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );

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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tiers.map((tier, idx) => (
            <Reveal key={tier.id} delay={Math.min(idx * 70, 350)} className="mkt-card mkt-card-hover p-7 flex flex-col">
              {tier.category && (
                <span
                  className="inline-block self-start px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide mb-3.5"
                  style={{ background: 'var(--tint-pill)', color: 'var(--color-primary)' }}
                >
                  {tier.category.name}
                </span>
              )}

              <h3 className="text-[19px] font-bold mkt-ink mb-2">{tier.name}</h3>

              {tier.description && (
                <p className="mkt-muted text-[14.5px] leading-relaxed mb-5">
                  <span className="mkt-ink font-semibold">Best for: </span>{tier.description}
                </p>
              )}

              <div className="mt-auto pt-1" style={{ borderTop: '1px solid var(--surface-border)' }}>
                {/* Only claim an accelerator when the machine actually has one —
                    the catalogue includes CPU and memory-optimised machines. */}
                {tier.gpuCount > 0 && (
                  <Spec label="GPU" value={`${tier.gpuCount}× ${tier.gpuModel}`} />
                )}
                {tier.vramGb > 0 && <Spec label="GPU memory" value={`${tier.vramGb} GB`} />}
                <Spec label="vCPUs" value={tier.vcpu} />
                <Spec label="RAM" value={`${tier.ramGb} GB`} />
                {tier.storageGb > 0 && (
                  <Spec label="Storage" value={`${tier.storageGb} GB ${tier.storageType || ''}`.trim()} />
                )}
                {tier.networkGbps > 0 && <Spec label="Network" value={`${tier.networkGbps} Gbps`} />}
              </div>

              <div
                className="flex items-end justify-between pt-5 mt-4"
                style={{ borderTop: '1px solid var(--surface-border)' }}
              >
                <div>
                  <div className="text-[12px] mkt-faint">from</div>
                  <div
                    className="text-[26px] font-bold tracking-tight"
                    style={{ color: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    ${tier.pricePerHour.toFixed(2)}
                    <span className="text-[14px] font-normal mkt-muted">/hr</span>
                  </div>
                </div>
                {showSignup && (
                  <a
                    href={`${config.customerCenterUrl}/signup`}
                    className="mkt-btn mkt-btn-ghost px-4 py-2.5 text-[14px]"
                  >
                    Deploy
                  </a>
                )}
              </div>
            </Reveal>
          ))}
        </div>

        {block.buttonText && block.buttonLink && (
          <div className="text-center mt-12">
            <CtaLink href={block.buttonLink}>{block.buttonText}</CtaLink>
          </div>
        )}
      </div>
    </section>
  );
};
