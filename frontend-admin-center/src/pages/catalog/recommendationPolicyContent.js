/**
 * What every recommendation-policy field means, in plain language.
 *
 * Kept out of the page component for two reasons: the page stays a renderer
 * rather than a wall of prose, and adding a knob to the engine means adding a
 * row here instead of hand-writing another form control.
 *
 * House style for this file — the person reading it runs the platform, they
 * do not necessarily write code:
 *
 *   what    — what the number actually means, no jargon
 *   raise   — what customers would notice if you turned it up
 *   lower   — what they would notice if you turned it down
 *   example — one concrete case, with real hardware and real prices
 */

/* ── Numeric settings, grouped as they appear on the page ───────────────── */

export const NUMERIC_GROUPS = [
  {
    key: 'ranking',
    label: 'Step 1 — Choosing which model to suggest',
    intro:
      'Used only when a customer starts from "New deployment" without picking a model first. '
      + 'Every model in your catalog is given a match score out of 100, and the highest few are '
      + 'shown as cards. These five weights decide what that score is made of.',
    note:
      'The weights are relative, not percentages. Entering 45 / 20 / 20 / 10 / 5 behaves exactly '
      + 'the same as 0.45 / 0.2 / 0.2 / 0.1 / 0.05 — only the proportions matter, so you can never '
      + 'break the scoring by having them not add up to 1.',
    fields: [
      {
        path: 'modelRanking.weights.useCase',
        label: 'How much "what it is good for" counts',
        what:
          'Each model has "Good for" tags you set on the model form (chat assistant, code '
          + 'generation, image generation, and so on), each rated Excellent, Good or Possible. '
          + 'This decides how strongly a matching tag pushes a model up the list.',
        raise: 'Purpose-built models win even when a cheaper or faster one exists.',
        lower: 'Tags matter less, and price and availability start deciding instead.',
        example:
          'A customer says "chat assistant". Llama 3.3 70B is tagged Excellent for chat, Mistral '
          + 'Small 3 is only Good. At the default weight Llama wins on fit even though Mistral is '
          + 'cheaper.',
      },
      {
        path: 'modelRanking.weights.capability',
        label: 'How much technical ability counts',
        what:
          'Whether the model can physically do the job: does it support the right kind of work '
          + '(chat, images, code) and can it read as much text at once as the customer asked for.',
        raise: 'Models that fall short on context length or capability drop much further.',
        lower: 'A model may be suggested even if it cannot quite handle the requested workload.',
        example:
          'A customer needs 128,000 tokens of context. A model that only handles 32,000 gets '
          + 'roughly a quarter of the context part of its score.',
      },
      {
        path: 'modelRanking.weights.budget',
        label: 'How much affordability counts',
        what: 'How strongly staying inside the customer\'s stated monthly budget pushes a model up.',
        raise: 'Cheap models are suggested first, even when a pricier one fits the job better.',
        lower: 'The best-fitting model is suggested regardless of what they said they would spend.',
        example:
          'Budget is $2,000/month. Mistral Small 3 runs at about $504 and Llama 3.3 70B at about '
          + '$2,840. Raising this makes Mistral the safer suggestion.',
      },
      {
        path: 'modelRanking.weights.availability',
        label: 'How much stock and status count',
        what:
          'Whether the model is actually available — its status (Available, Beta, Coming soon, '
          + 'Deprecated) and whether any hardware that can run it is in stock.',
        raise: 'Out-of-stock and beta models are pushed well down the list.',
        lower: 'A model may be suggested that the customer cannot deploy today.',
        example: 'Deliberately a tiebreaker by default, not a main factor.',
      },
      {
        path: 'modelRanking.weights.popularity',
        label: 'How much your Featured flag counts',
        what:
          'Your own thumb on the scale. Models marked Featured on the model form get this much '
          + 'of a nudge.',
        raise: 'Featured models surface more often regardless of fit.',
        lower: 'Featuring a model has almost no effect on what gets suggested.',
        example:
          'Kept small by default on purpose — a suggestion the customer can tell was chosen for '
          + 'your benefit rather than theirs damages trust in the whole journey.',
      },
      {
        path: 'modelRanking.capabilitySplit.modality',
        label: 'Within technical ability: can it do this kind of work',
        what:
          'The technical-ability score is split between two questions. This is the share for '
          + '"does it do the right kind of work at all" — an embeddings model cannot hold a '
          + 'conversation, no matter how good it is.',
        raise: 'Doing the right kind of work matters more than context length.',
        lower: 'Context length matters more than the kind of work.',
        example: 'This and the next field should add up to 1 (default 0.65 + 0.35).',
      },
      {
        path: 'modelRanking.capabilitySplit.context',
        label: 'Within technical ability: how much it can read at once',
        what:
          'The other share — how close the model gets to the context length the customer asked '
          + 'for.',
        raise: 'Long-context models are favoured more strongly.',
        lower: 'Falling short on context length is treated as a minor issue.',
        example: 'This and the previous field should add up to 1 (default 0.35 + 0.65).',
      },
      {
        path: 'modelRanking.budgetZeroAtMultiple',
        label: 'Budget score reaches zero at this multiple',
        what:
          'How far over budget a model has to be before it scores nothing at all for '
          + 'affordability. It fades out gradually rather than cutting off.',
        raise: 'Expensive models keep some affordability credit even when far over budget.',
        lower: 'Going over budget kills a model\'s score almost immediately.',
        example:
          'At the default of 2 and a $500 budget: $500/mo scores full marks, $750 scores half, '
          + '$1,000 or more scores nothing for affordability.',
      },
      {
        path: 'modelRanking.unbookableMultiplier',
        label: 'Penalty when no hardware is in stock',
        what:
          'A number between 0 and 1 that the availability score is multiplied by when nothing '
          + 'that can run the model is currently bookable.',
        raise: 'Out-of-stock models keep competing with in-stock ones.',
        lower: 'Out-of-stock models sink to the bottom.',
        example: 'At the default of 0.3 an out-of-stock model keeps under a third of its availability score.',
      },
    ],
  },

  {
    key: 'tiers',
    label: 'Step 2 — Choosing which GPU configuration to suggest',
    intro:
      'Runs every time, in both journeys. Each hardware configuration the model supports starts '
      + 'at the base score below, then gains and loses points. The highest score becomes the main '
      + 'recommendation, and the customer is also offered a cheaper option and one with more room '
      + 'to grow.',
    note:
      'Nothing is ever hidden from the customer. A configuration that is too small, too '
      + 'expensive or out of stock simply ranks last and explains why — it stays selectable, '
      + 'because the customer may know something about their workload that you do not.',
    fields: [
      {
        path: 'tierScoring.baseScore',
        label: 'Starting score',
        what: 'Every configuration begins here, before anything is added or taken away.',
        raise: 'Nothing meaningful — the ranking is relative, so this mostly shifts all scores together.',
        lower: 'Same. Leave this alone unless you want scores displayed on a different scale.',
        example: 'Default 100, so scores read naturally as "out of 100".',
      },
      {
        path: 'tierScoring.hoursPerMonth',
        label: 'Hours in a month',
        what:
          'Used to turn an hourly GPU price into the monthly figure customers see and compare '
          + 'against their budget.',
        raise: 'Quoted monthly costs go up, and more configurations look over budget.',
        lower: 'Quoted monthly costs go down.',
        example:
          '730 is a full month running non-stop (365 × 24 ÷ 12). Set it to about 170 if you would '
          + 'rather quote business-hours-only running.',
      },
      {
        path: 'tierScoring.vram.maxPenalty',
        label: 'Biggest penalty for not enough GPU memory',
        what:
          'The largest number of points a configuration can lose for having less video memory '
          + '(VRAM) than the workload needs. This is the single most important setting on the '
          + 'page — too little VRAM means the model will not load at all.',
        raise: 'Undersized configurations are ruled out more firmly.',
        lower: 'Undersized configurations can still win on price, and customers may hit failures.',
        example:
          'A workload needs 80 GB. An RTX 4090 with 24 GB is well under half, so it takes the '
          + 'full penalty and drops to the bottom.',
      },
      {
        path: 'tierScoring.vram.highSeverityBelowRatio',
        label: 'Memory shortfall becomes serious below',
        what:
          'A fraction between 0 and 1. Below this share of the required memory, the shortfall is '
          + 'reported to the customer as a serious problem rather than a moderate one.',
        raise: 'Customers are warned loudly about even small shortfalls.',
        lower: 'Only badly undersized configurations get a strong warning.',
        example: 'At the default of 0.75, having under three-quarters of the required memory is serious.',
      },
      {
        path: 'tierScoring.vram.overProvisionMaxPenalty',
        label: 'Biggest penalty for being oversized',
        what:
          'Points lost for offering far more GPU than the workload needs, so the journey does '
          + 'not read as an upsell.',
        raise: 'The engine sticks closely to what is actually needed.',
        lower: 'Larger, pricier configurations are suggested more readily.',
        example:
          'A workload needs 24 GB and the configuration has 160 GB — that is over six times more '
          + 'than required, and the customer would be paying for idle silicon.',
      },
      {
        path: 'tierScoring.budget.maxPenalty',
        label: 'Biggest penalty for being over budget',
        what: 'The most points a configuration can lose for costing more than the stated budget.',
        raise: 'The engine works harder to stay inside the budget, even on weaker hardware.',
        lower: 'Budget is treated as a preference rather than a limit.',
        example: 'Deliberately smaller than the memory penalty — a box that cannot run the model is worse than one that costs more.',
      },
      {
        path: 'tierScoring.budget.highSeverityAboveMultiple',
        label: 'Over budget becomes serious above',
        what:
          'How far past the budget a configuration must be before the customer sees it as a '
          + 'serious problem rather than a note.',
        raise: 'Only wildly expensive options are flagged strongly.',
        lower: 'Even slightly over budget gets a strong warning.',
        example: 'At the default of 1.5, a $750/mo option against a $500 budget is a serious problem.',
      },
      {
        path: 'tierScoring.budget.headroomReward',
        label: 'Reward for coming in comfortably under budget',
        what: 'A small bonus for configurations that leave the customer money to spare.',
        raise: 'Cheaper options are favoured whenever a budget was given.',
        lower: 'Coming in under budget earns nothing extra.',
        example: 'Kept small so it nudges rather than decides.',
      },
      {
        path: 'tierScoring.floors.gpuCountPenalty',
        label: 'Penalty for having too few GPUs',
        what:
          'Applied when an answer implies a minimum number of GPUs — usually very high request '
          + 'volumes — and the configuration has fewer.',
        raise: 'Multi-GPU configurations are pushed harder for busy workloads.',
        lower: 'Single-GPU configurations stay competitive even at high volume.',
        example: 'A customer expecting over 100,000 requests a day needs more than one GPU to keep queues short.',
      },
      {
        path: 'tierScoring.costEfficiencyWeight',
        label: 'How much value for money counts',
        what:
          'Rewards configurations that give more memory per dollar, compared against the other '
          + 'configurations that same model supports.',
        raise: 'The best-value option usually wins.',
        lower: 'Price is nearly ignored and raw capability decides.',
        example: 'Its effect is also scaled by how cost-sensitive the customer\'s own answers were.',
      },
      {
        path: 'tierScoring.latencyWeight',
        label: 'How much faster hardware counts',
        what:
          'Rewards quicker GPUs — but only when the customer actually asked for fast responses. '
          + 'If they did not mention speed, this does nothing.',
        raise: 'Customers who want low latency are pushed towards H100-class hardware.',
        lower: 'Speed requests have little effect on what is suggested.',
        example:
          'Speed is estimated from price per GB of memory, since faster cards cost more. You can '
          + 'override this per configuration with a Performance Index on the tier form.',
      },
      {
        path: 'tierScoring.stock.outOfStockPenalty',
        label: 'Penalty for being out of stock',
        what: 'Points lost when a configuration cannot be booked right now.',
        raise: 'Out-of-stock options effectively disappear to the bottom of the list.',
        lower: 'Customers may be shown something they cannot have today.',
        example: 'Large by default, but never large enough to remove the option entirely.',
      },
      {
        path: 'tierScoring.stock.limitedPenalty',
        label: 'Penalty for limited stock',
        what: 'A smaller penalty for configurations marked Limited rather than fully out of stock.',
        raise: 'Limited-stock options are avoided.',
        lower: 'Limited stock is treated as barely worth mentioning.',
        example: 'Small by default — the customer can still have it, they just may wait.',
      },
      {
        path: 'tierScoring.adminRecommendedBonus',
        label: 'Bonus for your own "Recommended" tick',
        what:
          'On the model form you can tick Recommended against specific hardware. This is how '
          + 'many points that tick is worth.',
        raise: 'Your pick wins outright, overriding what the customer\'s answers imply.',
        lower: 'Your tick becomes decoration and the answers decide entirely.',
        example:
          'Deliberately modest by default — enough to break a tie in your favour, not enough to '
          + 'sell someone the wrong box. Set it to 0 to ignore the tick completely.',
      },
    ],
  },

  {
    key: 'suitability',
    label: 'Step 3 — Warning when a model is a poor fit',
    intro:
      'After the hardware is chosen, the engine checks whether the model itself really suits '
      + 'what the customer described. If not, they see a warning panel and a list of '
      + 'better-fitting models to switch to.',
    note:
      'This never blocks anyone. The customer can always carry on with the model they chose — '
      + 'the panel says so explicitly. Problems are graded serious, moderate or minor, and these '
      + 'settings decide how many of each it takes to trigger a warning.',
    fields: [
      {
        path: 'suitability.verdict.poorAtHighCount',
        label: 'Serious problems needed to call it a poor fit',
        what:
          'How many serious problems (wrong kind of model, nowhere near the required context '
          + 'length, cheapest option still over budget, model not released yet) before the '
          + 'customer sees the strong "this may not be the right model" warning.',
        raise: 'Warnings become rarer and gentler.',
        lower: 'Customers are warned off models more readily.',
        example:
          'At the default of 1, a single serious problem is enough. Note that even below this '
          + 'threshold a serious problem still shows as a caution — it is never hidden.',
      },
      {
        path: 'suitability.verdict.cautionAtMediumCount',
        label: 'Moderate problems needed for a caution',
        what: 'How many moderate problems before the softer "a couple of things worth knowing" panel appears.',
        raise: 'Fewer soft warnings.',
        lower: 'Customers see advisory notes more often.',
        example: 'Default 1 — one moderate problem is worth mentioning.',
      },
      {
        path: 'suitability.verdict.cautionAtLowCount',
        label: 'Minor problems needed for a caution',
        what: 'How many minor problems have to pile up before they are worth showing together.',
        raise: 'Small niggles are ignored.',
        lower: 'Even one small note surfaces.',
        example: 'Default 2 — one small thing is noise, two starts to be a pattern.',
      },
      {
        path: 'suitability.budgetTightAboveRatio',
        label: 'Warn "this will use most of your budget" above',
        what:
          'The share of the stated budget that, once used, triggers a friendly heads-up that '
          + 'things are tight.',
        raise: 'Only near-total budget use is mentioned.',
        lower: 'Customers are told about budget pressure earlier.',
        example: 'At the default of 0.8, spending over $400 of a $500 budget triggers the note.',
      },
      {
        path: 'suitability.contextMediumAtOrAboveRatio',
        label: 'Context shortfall is only moderate above',
        what:
          'How close a model has to get to the requested context length for the shortfall to '
          + 'count as moderate rather than serious.',
        raise: 'Context shortfalls are treated as serious more often.',
        lower: 'Falling short on context is treated as a minor issue.',
        example: 'At the default of 0.8, a model handling 100,000 tokens against a 128,000 request is moderate, not serious.',
      },
      {
        path: 'suitability.scorePenalties.high',
        label: 'Fit score: points lost per serious problem',
        what:
          'Each model also gets a fit score out of 100, shown as the match number on the model '
          + 'cards. This is what a serious problem costs.',
        raise: 'Match percentages drop sharply on any real problem.',
        lower: 'Match percentages stay optimistic.',
        example: 'At the default of 40, two serious problems take a model from 100 to 20.',
      },
      {
        path: 'suitability.scorePenalties.medium',
        label: 'Fit score: points lost per moderate problem',
        what: 'What a moderate problem costs the match score.',
        raise: 'Moderate issues visibly dent the match number.',
        lower: 'Moderate issues barely register.',
        example: 'Default 18.',
      },
      {
        path: 'suitability.scorePenalties.low',
        label: 'Fit score: points lost per minor problem',
        what: 'What a minor problem costs the match score.',
        raise: 'Small issues accumulate visibly.',
        lower: 'Small issues are cosmetic only.',
        example: 'Default 6.',
      },
    ],
  },

  {
    key: 'other',
    label: 'Confidence and refresh speed',
    intro:
      'How openly the engine admits when it is guessing, and how quickly your edits reach '
      + 'customers.',
    note: '',
    fields: [
      {
        path: 'confidence.lowMaxSignals',
        label: 'Answers up to this count = low confidence',
        what:
          'Not every question affects sizing — asking about compliance or integrations tells the '
          + 'engine nothing about hardware. This counts only the answers that genuinely '
          + 'influenced the result. At or below this number the engine treats its own advice as '
          + 'a guess.',
        raise: 'The engine describes itself as unsure for longer.',
        lower: 'It claims confidence sooner.',
        example: 'With no useful answers at all, the explanation panel is hidden entirely rather than shown empty.',
      },
      {
        path: 'confidence.mediumMaxSignals',
        label: 'Answers up to this count = medium confidence',
        what: 'Above this, and with at least one hard requirement, the engine reports high confidence.',
        raise: 'High confidence is claimed less often.',
        lower: 'High confidence is claimed sooner.',
        example: 'Default 4.',
      },
      {
        path: 'cacheTtlSeconds',
        label: 'How long changes take to appear (seconds)',
        what:
          'The engine briefly remembers your catalog and this policy so it does not re-read the '
          + 'database on every keystroke of the customer journey. Saving from this page clears '
          + 'that memory immediately, so your own edits appear at once.',
        raise: 'Slightly less database load, but edits made elsewhere take longer to show.',
        lower: 'Changes appear faster at the cost of more database reads.',
        example: 'Default 30 seconds. Anything under 5 is rarely worth it.',
      },
    ],
  },
];

/* ── Open-ended lists ───────────────────────────────────────────────────── */

export const MAP_GROUPS = [
  {
    path: 'fitWeights',
    label: 'What each "Good for" rating is worth',
    numeric: true,
    what:
      'On the model form you rate each use case Excellent, Good or Possible. These numbers '
      + 'decide what each rating is worth when matching a model to what the customer described. '
      + '1 means a perfect match.',
    example:
      'At the defaults, a model rated Good (0.7) scores 70% of what an Excellent one (1.0) would '
      + 'for the same use case.',
  },
  {
    path: 'modelRanking.statusFit',
    label: 'What each model status is worth',
    numeric: true,
    what:
      'How much each lifecycle status counts against a model when ranking. 1 means no penalty '
      + 'at all, 0 means never suggest it.',
    example:
      'Deprecated is 0 by default, so retired models are never suggested for something new. '
      + 'Beta is 0.7 — usable, but not the first thing offered.',
  },
  {
    path: 'uptimeRanks',
    label: 'Uptime levels, weakest to strongest',
    numeric: true,
    what:
      'When two answers imply different uptime needs, the higher number wins. This is the order '
      + 'of seriousness.',
    example:
      'Someone who says "just testing" on one question and "24/7 production" on another is '
      + 'treated as needing 24/7, because it has the higher rank.',
  },
  {
    path: 'modalityLabels',
    label: 'How each capability is worded to customers',
    numeric: false,
    what:
      'Internal capability names are machine-readable and must never reach a customer. These '
      + 'are the human words used in their place.',
    example:
      'Without this, a customer would read "does not support image_generation" instead of '
      + '"does not support image generation".',
  },
];

/* ── Editable copy ──────────────────────────────────────────────────────── */

export const COPY_GROUPS = [
  {
    path: 'reasonTemplates',
    label: 'Why we chose this hardware',
    what:
      'The sentences under "Why this configuration" on the recommendation screen. Each one is '
      + 'tied to something the customer actually answered, which is what makes the '
      + 'recommendation checkable rather than something they have to take on trust.',
  },
  {
    path: 'suitabilityTemplates',
    label: 'Why a model may be the wrong choice',
    what: 'The warning panel shown when the chosen model does not suit what the customer described.',
  },
  {
    path: 'tierIssueTemplates',
    label: 'Notes on individual configurations',
    what: 'Short notes attached to specific GPU configurations — undersized, over budget, out of stock.',
  },
  {
    path: 'matchReasonTemplates',
    label: 'Why this model matched',
    what: 'The bullet points on each model card when the engine suggests models to choose from.',
  },
  {
    path: 'alternativeTemplates',
    label: 'The cheaper and more-headroom cards',
    what: 'The two alternative configurations offered beside the main recommendation.',
  },
  {
    path: 'blockerTemplates',
    label: 'When nothing you sell fits',
    what:
      'Shown when a single limit rules out every option — most often a budget no configuration '
      + 'can meet. Without this the customer clicks through several models that all fail the '
      + 'same way, with nothing explaining that switching model cannot help.',
  },
];

/* ── Per-item explanations ───────────────────────────────────────────────
 * Every individual key inside a vocabulary (MAP_GROUPS) and every sentence
 * code inside a copy section (COPY_GROUPS) gets its own explanation, keyed as
 * `${group.path}.${key}`. Nothing on the page is left unexplained.
 */

export const MAP_ITEM_INFO = {
  'fitWeights.excellent': {
    label: '"Excellent" fit',
    what: 'How much a model rated Excellent for a use case counts toward matching it to that request.',
    when: 'Set per model, per use case, on the model form.',
  },
  'fitWeights.good': {
    label: '"Good" fit',
    what: 'How much a model rated Good (rather than Excellent) counts toward the match.',
    when: 'Set per model, per use case, on the model form.',
  },
  'fitWeights.possible': {
    label: '"Possible" fit',
    what: 'How much a model rated merely Possible for a use case counts — a weak, last-resort claim.',
    when: 'Set per model, per use case, on the model form.',
  },

  'modelRanking.statusFit.available': {
    label: 'Status: Available',
    what: 'How much a model marked Available counts toward being suggested. 1 means no penalty.',
    when: 'Set on the model form as its lifecycle status.',
  },
  'modelRanking.statusFit.beta': {
    label: 'Status: Beta',
    what: 'How much a Beta model is held back compared to a fully Available one.',
    when: 'Set on the model form as its lifecycle status.',
  },
  'modelRanking.statusFit.coming_soon': {
    label: 'Status: Coming soon',
    what: 'How much a not-yet-released model is held back. Kept low since it cannot be deployed today.',
    when: 'Set on the model form as its lifecycle status.',
  },
  'modelRanking.statusFit.deprecated': {
    label: 'Status: Deprecated',
    what: 'How much a retired model is held back. 0 means it is never suggested for something new.',
    when: 'Set on the model form as its lifecycle status.',
  },

  'uptimeRanks.dev': {
    label: 'Development / testing',
    what: 'The lowest uptime need. Loses to any answer implying more serious use.',
    when: 'Matched against the "when does it need to be running" question.',
  },
  'uptimeRanks.business_hours': {
    label: 'Business hours only',
    what: 'A middling uptime need — outranks casual testing, loses to always-on production.',
    when: 'Matched against the "when does it need to be running" question.',
  },
  'uptimeRanks.always_on': {
    label: '24/7 production',
    what: 'The highest uptime need. Wins over every other answer if the customer gave conflicting ones.',
    when: 'Matched against the "when does it need to be running" question.',
  },

  'modalityLabels.chat': {
    label: 'Chat',
    what: 'The word used for conversational, back-and-forth capability.',
    when: 'Shown whenever a reason or warning mentions this capability by name.',
  },
  'modalityLabels.completion': {
    label: 'Text completion',
    what: 'The word used for finishing or continuing a piece of text.',
    when: 'Shown whenever a reason or warning mentions this capability by name.',
  },
  'modalityLabels.vision': {
    label: 'Image understanding',
    what: 'The word used for a model that can look at and reason about images.',
    when: 'Shown whenever a reason or warning mentions this capability by name.',
  },
  'modalityLabels.image_generation': {
    label: 'Image generation',
    what: 'The word used for a model that creates images rather than just reading them.',
    when: 'Shown whenever a reason or warning mentions this capability by name.',
  },
  'modalityLabels.embedding': {
    label: 'Embeddings',
    what: 'The word used for models that turn text into search-ready vectors rather than writing replies.',
    when: 'Shown whenever a reason or warning mentions this capability by name.',
  },
  'modalityLabels.audio': {
    label: 'Audio',
    what: 'The word used for speech or sound capability.',
    when: 'Shown whenever a reason or warning mentions this capability by name.',
  },
  'modalityLabels.code': {
    label: 'Code',
    what: 'The word used for programming-focused capability.',
    when: 'Shown whenever a reason or warning mentions this capability by name.',
  },
};

export const COPY_ITEM_INFO = {
  // reasonTemplates
  'reasonTemplates.VRAM_FLOOR': {
    label: 'An answer implied a minimum memory size',
    what: 'States the memory floor an answer created — e.g. asking for very long context.',
    when: 'Shown under "Why this configuration" whenever an answer set a memory requirement.',
  },
  'reasonTemplates.GPU_COUNT_FLOOR': {
    label: 'An answer implied a minimum GPU count',
    what: 'States that an answer (usually very high request volume) requires more than one GPU.',
    when: 'Shown under "Why this configuration" whenever an answer required multiple GPUs.',
  },
  'reasonTemplates.VCPU_FLOOR': {
    label: 'An answer implied a minimum vCPU count',
    what: 'States a minimum processor count an answer implied.',
    when: 'Rarely triggered by default — only if a question is configured to set this.',
  },
  'reasonTemplates.RAM_FLOOR': {
    label: 'An answer implied a minimum system RAM',
    what: 'States a minimum system memory an answer implied.',
    when: 'Rarely triggered by default — only if a question is configured to set this.',
  },
  'reasonTemplates.CONTEXT_FLOOR': {
    label: 'An answer implied a minimum context length',
    what: 'States how much text at once the customer said they need to handle.',
    when: 'Shown whenever the "how much does it need to read at once" question was answered.',
  },
  'reasonTemplates.BUDGET_CEILING': {
    label: 'The customer stated a budget',
    what: 'Repeats back the monthly budget the customer gave, so the recommendation looks reasoned rather than arbitrary.',
    when: 'Shown whenever the budget question was answered.',
  },
  'reasonTemplates.HOURLY_CEILING': {
    label: 'The customer stated an hourly price cap',
    what: 'States a per-hour spending cap, when a question is configured to ask for one.',
    when: 'Only if a question sets this signal — not asked by the default questionnaire.',
  },
  'reasonTemplates.MODEL_MINIMUM': {
    label: 'The model itself needs this much memory',
    what: 'States the model\'s own minimum requirement, when that is the actual reason a small configuration is unavailable — not anything the customer said.',
    when: 'Shown when the model\'s own minimum, not an answer, is what set the memory floor.',
  },
  'reasonTemplates.MODALITY_REQUIRED': {
    label: 'An answer required a specific capability',
    what: 'States that an answer requires a specific capability, such as image generation.',
    when: 'Shown whenever an answer required a capability the recommendation is checked against.',
  },
  'reasonTemplates.BUDGET_INFEASIBLE': {
    label: 'Nothing this model supports fits the budget',
    what: 'A warning that even the cheapest configuration this model can run on costs more than the stated budget.',
    when: 'Shown as a warning (never an error) whenever the winning configuration is over budget.',
  },

  // suitabilityTemplates
  'suitabilityTemplates.MODALITY_MISMATCH': {
    label: 'Wrong kind of model',
    what: 'The model cannot do the kind of work the customer described at all — e.g. an embeddings-only model for a chat request.',
    when: 'The strongest kind of "wrong model" warning; always rated a serious problem.',
  },
  'suitabilityTemplates.CONTEXT_SHORTFALL': {
    label: 'Not enough context length',
    what: 'The model cannot hold as much text at once as the customer asked for.',
    when: 'Shown whenever the model\'s own context length falls short of what was requested.',
  },
  'suitabilityTemplates.BUDGET_IMPOSSIBLE': {
    label: 'This model is not affordable at all',
    what: 'Even the cheapest way to run this specific model costs more than the stated budget.',
    when: 'Shown on the model\'s own suitability panel — see the separate "when nothing you sell fits" section for the catalog-wide version.',
  },
  'suitabilityTemplates.BUDGET_TIGHT': {
    label: 'This will use most of the budget',
    what: 'A gentle heads-up rather than a warning — the model fits, but leaves little room.',
    when: 'Shown when spend crosses the "budget is tight" threshold in Step 3 above.',
  },
  'suitabilityTemplates.MODEL_COMING_SOON': {
    label: 'Model not released yet',
    what: 'States that this model cannot actually be deployed today.',
    when: 'Shown whenever a not-yet-released model is the one selected.',
  },
  'suitabilityTemplates.MODEL_DEPRECATED': {
    label: 'Model being retired',
    what: 'Discourages starting something new on a model that is being phased out.',
    when: 'Shown whenever a deprecated model is the one selected.',
  },
  'suitabilityTemplates.MODEL_BETA': {
    label: 'Model still in beta',
    what: 'A mild heads-up that behaviour may still change.',
    when: 'Shown whenever a beta-status model is the one selected.',
  },
  'suitabilityTemplates.NO_BOOKABLE_TIER': {
    label: 'Nothing is in stock for this model',
    what: 'Every configuration this model supports is currently unavailable.',
    when: 'Shown when no hardware this model runs on can be booked right now.',
  },
  'suitabilityTemplates.VRAM_UNSUPPORTED': {
    label: 'No configuration reaches the memory needed',
    what: 'Even the largest available configuration for this model falls short of what the workload needs.',
    when: 'Shown when every bookable configuration is undersized for the requirement.',
  },

  // tierIssueTemplates
  'tierIssueTemplates.VRAM_SHORTFALL': {
    label: 'This configuration is undersized',
    what: 'A note on one specific configuration explaining it has less memory than the workload wants.',
    when: 'Shown on any individual configuration that falls short on memory.',
  },
  'tierIssueTemplates.GPU_COUNT_SHORTFALL': {
    label: 'This configuration has too few GPUs',
    what: 'A note explaining a configuration has fewer GPUs than the workload implies it needs.',
    when: 'Shown on a configuration with fewer GPUs than the requirement.',
  },
  'tierIssueTemplates.VCPU_SHORTFALL': {
    label: 'This configuration has fewer processors than requested',
    what: 'A minor note about processor count falling short.',
    when: 'Rarely triggered by default.',
  },
  'tierIssueTemplates.RAM_SHORTFALL': {
    label: 'This configuration has less system memory than requested',
    what: 'A minor note about system RAM falling short.',
    when: 'Rarely triggered by default.',
  },
  'tierIssueTemplates.OVER_BUDGET': {
    label: 'This configuration is over budget',
    what: 'States how much this specific configuration costs against the stated budget.',
    when: 'Shown on any configuration priced above the budget.',
  },
  'tierIssueTemplates.OVER_HOURLY_CAP': {
    label: 'This configuration is above the hourly price cap',
    what: 'States that this configuration\'s hourly rate is above a stated cap.',
    when: 'Only if a question sets an hourly cap — not asked by the default questionnaire.',
  },
  'tierIssueTemplates.OUT_OF_STOCK': {
    label: 'This configuration is out of stock',
    what: 'States plainly that this configuration cannot currently be booked.',
    when: 'Shown on any configuration marked out of stock.',
  },
  'tierIssueTemplates.LIMITED_STOCK': {
    label: 'This configuration has limited stock',
    what: 'A softer version of the out-of-stock note — it can still be booked, just constrained.',
    when: 'Shown on any configuration marked limited.',
  },

  // matchReasonTemplates
  'matchReasonTemplates.USE_CASE_MATCH': {
    label: 'Why this model matched the use case',
    what: 'The bullet naming which use case the model is rated for and how strongly.',
    when: 'Shown on the model-comparison cards, for each use case the model claims to be good at.',
  },
  'matchReasonTemplates.CONTEXT_HEADROOM': {
    label: 'This model comfortably covers the context needed',
    what: 'A positive bullet when the model handles more context than was asked for.',
    when: 'Shown on the model-comparison cards when context is not a concern.',
  },
  'matchReasonTemplates.WITHIN_BUDGET': {
    label: 'This model fits the stated budget',
    what: 'A positive bullet confirming the model\'s cheapest configuration is affordable.',
    when: 'Shown on the model-comparison cards when the model is affordable.',
  },

  // alternativeTemplates
  'alternativeTemplates.CHEAPER_ADEQUATE': {
    label: 'Cheaper option, still adequate',
    what: 'The note on the "spend less" card when the cheaper configuration still meets the requirement.',
    when: 'Shown when a genuinely adequate cheaper option exists.',
  },
  'alternativeTemplates.CHEAPER_INADEQUATE': {
    label: 'Cheaper option, but undersized',
    what: 'An honest warning shown when the only cheaper option available falls short of the requirement.',
    when: 'Shown when no adequate cheaper option exists, so the closest cheaper one is offered with a caveat.',
  },
  'alternativeTemplates.HEADROOM': {
    label: 'A bigger option, for room to grow',
    what: 'The note on the "more headroom" card — a deliberately modest step up, not the most expensive thing you sell.',
    when: 'Shown whenever a sensible next-size-up configuration exists.',
  },

  // blockerTemplates
  'blockerTemplates.BUDGET_IMPOSSIBLE': {
    label: 'No model at all fits the stated budget',
    what: 'Shown instead of a list of models to switch between, when every suggested model is also over budget — this tells the customer that switching model will not help, because the limit is the hardware cost.',
    when: 'Only appears when EVERY suggested alternative shares the same blocking problem as the one selected.',
  },
  'blockerTemplates.CONTEXT_SHORTFALL': {
    label: 'No model reaches the context length needed',
    what: 'Shown when every suggested model falls short of the requested context length.',
    when: 'Only appears when EVERY suggested alternative shares this same problem.',
  },
  'blockerTemplates.VRAM_UNSUPPORTED': {
    label: 'No configuration for any model reaches the memory needed',
    what: 'Shown when the memory requirement cannot be met by anything in the catalog, for any model.',
    when: 'Only appears when EVERY suggested alternative shares this same problem.',
  },
  'blockerTemplates.NO_BOOKABLE_TIER': {
    label: 'Nothing is in stock, for any model',
    what: 'Shown when every suggested alternative is also completely out of stock.',
    when: 'Only appears when EVERY suggested alternative shares this same problem.',
  },
  'blockerTemplates.DEFAULT': {
    label: 'Fallback wording for any other shared limit',
    what: 'A generic fallback used if a future problem type is not covered by one of the specific sentences above.',
    when: 'Rarely seen — only if a new kind of limit is added to the engine later without its own sentence here.',
  },
};

/* ── The guide drawer ───────────────────────────────────────────────────── */

export const GUIDE = {
  intro:
    'When a customer deploys a model, they answer a short series of questions and the platform '
    + 'suggests a model and a GPU configuration. This page controls how those suggestions are '
    + 'made, and every sentence the customer reads about them. Nothing here is written into the '
    + 'software — changing a number here changes what customers are offered, with no developer '
    + 'and no release needed.',

  pipeline: [
    {
      title: 'The customer answers questions',
      body:
        'Set up under AI Infrastructure → Questionnaire. Each answer can carry hints — "this '
        + 'implies at least 80 GB of memory", "this means a budget of $500 a month". Answers with '
        + 'no hints attached, like compliance or integration questions, are recorded for your '
        + 'team but do not affect the suggestion.',
    },
    {
      title: 'The hints are combined into one set of requirements',
      body:
        'Where answers disagree, the safer one wins: the highest memory requirement and the '
        + 'tightest budget. If the customer goes back and changes an answer, the old one stops '
        + 'counting immediately.',
    },
    {
      title: 'Models are scored — Step 1 on this page',
      body:
        'Only when the customer did not already pick a model. Each model in your catalog gets a '
        + 'match score, and the best few are shown as cards to choose from.',
    },
    {
      title: 'Hardware is scored — Step 2 on this page',
      body:
        'Every configuration the chosen model supports is scored. The winner becomes the main '
        + 'recommendation, alongside a cheaper option and one with more room to grow.',
    },
    {
      title: 'Fit is checked — Step 3 on this page',
      body:
        'The engine asks whether this model really suits what was described. If not, the customer '
        + 'sees a warning and a list of better-fitting models — but is never prevented from '
        + 'continuing with their original choice.',
    },
    {
      title: 'The reasons are written out',
      body:
        'Every sentence comes from the Copy sections on this page, with real numbers filled in. '
        + 'Each reason names the answer that caused it.',
    },
  ],

  rules: [
    {
      title: 'An empty box means "use the built-in default"',
      body:
        'Every field shows its default in grey. Clearing a field returns it to that default — it '
        + 'does not set it to zero. This is what lets you change one number without having to '
        + 'fill in the other fifty. Anything you have changed is marked with a blue tag.',
    },
    {
      title: 'The engine advises, it never refuses',
      body:
        'No setting here can stop a customer deploying something. A configuration that is too '
        + 'small, too expensive or out of stock ranks last and explains itself, but stays '
        + 'selectable. They may know something about their workload that your rules do not.',
    },
    {
      title: 'Only one policy is live at a time',
      body:
        'You can keep as many as you like, but exactly one is in use. Making one live '
        + 'automatically retires the previous one, so customers can never be shown suggestions '
        + 'from two different rule sets.',
    },
    {
      title: 'Saving takes effect straight away',
      body:
        'There is no publish step. Saving a live policy changes what the next customer sees. '
        + 'Anyone already halfway through a journey keeps the answers they have given.',
    },
  ],

  howToEdit: [
    'Find the setting you want to change and read its ⓘ — it says what happens if you raise or lower it.',
    'Type the new value. A blue "changed" tag appears, so you can always see what you have touched.',
    'Scroll to Preview at the bottom, choose a model, and press Run preview.',
    'Compare the two panels. The left is what customers get right now; the right is what they would get after saving. Nothing has been saved yet.',
    'If it looks right, press Save changes. If not, clear the field to return it to its default.',
  ],

  howToExperiment: [
    'On the Policies table, press the copy button beside the live policy. A copy is created, switched off.',
    'Click the copy to select it. A warning bar confirms you are editing something customers cannot see.',
    'Change as much as you like and save as often as you like — live traffic is untouched.',
    'Use Preview to compare your version against the live one at any point.',
    'When you are happy, press "Make live". The previous policy is retired automatically and kept, so you can switch back by making it live again.',
  ],

  placeholders:
    'Sentences in the Copy sections contain words in curly braces such as {requirement} or '
    + '{modelName}. These are replaced with real values when the customer sees them — '
    + '{requirementMoney} becomes "$500", {modelName} becomes "Llama 3.3 70B". Reword the '
    + 'sentence around them freely, but keep the braced words spelled exactly as they are. Each '
    + 'one available for a given sentence is listed as a small tag above the box. If you '
    + 'misspell one, it appears to the customer as literal text like {requirment} rather than '
    + 'silently vanishing — so mistakes are visible instead of producing a sentence with a hole '
    + 'in it.',

  faq: [
    {
      q: 'I changed something and customers see no difference.',
      a:
        'Check the policy you edited is the live one — the Policies table badges it green. If you '
        + 'were editing a copy, a warning bar appears above the settings. Also check the field '
        + 'actually shows a blue "changed" tag; grey text is the default, not a value you set.',
    },
    {
      q: 'Every model is being suggested as a poor fit.',
      a:
        'Usually the customer\'s budget cannot cover any configuration you sell. That is not a '
        + 'model problem, and the journey now says so and offers to change the answer. If it is '
        + 'happening constantly, your cheapest configuration may be priced above what your '
        + 'questionnaire offers as its lowest budget option.',
    },
    {
      q: 'I want my chosen hardware to always win.',
      a:
        'Tick Recommended against that configuration on the model form, then raise "Bonus for '
        + 'your own Recommended tick" in Step 2 until it wins. Preview it first — a large enough '
        + 'bonus overrides what the customer actually asked for.',
    },
    {
      q: 'How do I undo everything?',
      a:
        'Each section has a Reset section button that returns every field in it to its default. '
        + 'To undo a single field, clear the box.',
    },
    {
      q: 'What happens if there is no policy at all?',
      a:
        'The engine falls back to the built-in defaults and keeps working normally. You cannot '
        + 'break suggestions by deleting policies, and the live one cannot be deleted anyway.',
    },
  ],
};
