/**
 * Which language to *offer* someone in a given country.
 *
 * Used for exactly one thing: deciding what the first-run prompt suggests. It
 * never switches the UI on its own — a country is a guess about a person, and a
 * wrong guess drops someone into a script they cannot read. The customer still
 * has to say yes, and English is always the other option.
 *
 * A country that is not listed gets no prompt at all. That is the intended
 * behaviour and not a gap to fill in: most of the world reads English on
 * technical products perfectly happily, and the switcher is always there. Only
 * add a country here when its mapping is genuinely unambiguous.
 *
 * Codes are ISO 3166-1 alpha-2, matching what a CDN country header sends.
 */
const COUNTRY_LANGUAGE = {
  // Urdu
  PK: 'ur',

  // Hindi
  IN: 'hi',

  // Arabic
  SA: 'ar',
  AE: 'ar',
  EG: 'ar',
  QA: 'ar',
  KW: 'ar',
  BH: 'ar',
  OM: 'ar',
  JO: 'ar',
  IQ: 'ar',
  LY: 'ar',
  MA: 'ar',
  TN: 'ar',
  DZ: 'ar',
  YE: 'ar',
  SY: 'ar',
  LB: 'ar',
  SD: 'ar',

  // Spanish. Spain and Latin America, minus Brazil (Portuguese) — a language
  // this product does not ship yet, so Brazil is deliberately absent rather
  // than mapped to something close.
  ES: 'es',
  MX: 'es',
  AR: 'es',
  CO: 'es',
  CL: 'es',
  PE: 'es',
  VE: 'es',
  EC: 'es',
  GT: 'es',
  CU: 'es',
  BO: 'es',
  DO: 'es',
  HN: 'es',
  PY: 'es',
  SV: 'es',
  NI: 'es',
  CR: 'es',
  PA: 'es',
  UY: 'es',

  // Simplified Chinese. Taiwan, Hong Kong and Macau read Traditional, which is
  // a different catalogue — left out until it exists, rather than offered a
  // script they would find wrong.
  CN: 'zh-CN',
  SG: 'zh-CN',
};

/** The language to suggest for a country code, or null if we would not guess. */
export const languageForCountry = (country) => {
  if (!country || typeof country !== 'string') return null;
  return COUNTRY_LANGUAGE[country.trim().toUpperCase()] || null;
};

export default COUNTRY_LANGUAGE;
