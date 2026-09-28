import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Typography, Button, Space, Result, Card,
} from 'antd';
import {
  ArrowLeftOutlined, ArrowRightOutlined, RocketOutlined, CloseOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DetailSkeleton } from '../../components/Skeletons';
import catalogApi from '../../api/catalogApi';
import deploymentsApi from '../../api/deploymentsApi';
import walletApi from '../../api/walletApi';
import { useTheme } from '../../context/ThemeContext';
import { useBilling } from '../../context/SiteContext';
import { cardStyle as surfaceStyle, SURFACE, ltrTechnical } from '../../theme/colors';
import {
  ProgressRail, LiveSizingChip, ThinkingDots, StepHeading, tierSpecLine,
} from './journeyParts';
import { formatRate } from '../../utils/money';
import QuestionStep from './QuestionStep';
import RecommendationStep from './RecommendationStep';
import ModelMatchStep from './ModelMatchStep';
import ReviewStep, { NameStep } from './ReviewStep';
import CheckoutModal from './CheckoutModal';
import { useTranslation } from 'react-i18next';

const { Text, Paragraph } = Typography;

/** Live sizing shouldn't fire on every keystroke of a slider or number box. */
const SIZING_DEBOUNCE_MS = 250;

/** Mirrors the backend's own visibility rule so steps and questions agree. */
const isVisible = (item, answers) => {
  const dep = item.dependsOn;
  if (!dep || !dep.questionKey) return true;
  return answers[dep.questionKey] === dep.equals;
};

const isAnswered = (value, type) => {
  if (type === 'boolean') return value !== undefined && value !== null;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
};

/**
 * The guided deployment journey.
 *
 * Replaces the old three-step form. The flow itself — which questions, in what
 * order, with what copy — comes from an admin-authored DeploymentJourney
 * record, so this component is a renderer and a state machine, not a script.
 *
 * Two entry points share it:
 *   /deploy/:slug — the customer picked a model; we size hardware for it.
 *   /deploy       — no model yet; we recommend one too.
 */
const DeployJourney = () => {
  const { t } = useTranslation(['deploy', 'common']);
  const { slug } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { currency, creditsEnabled } = useBilling();

  const requirementsFirst = !slug;

  /**
   * The machine the customer already chose, if they came from the machine
   * catalogue (`/deploy/:model?machine=:machine`).
   *
   * Captured into a ref on mount and never re-read. The review screen rewrites
   * this parameter when the machine is switched, and if the loader below
   * depended on the live value that rewrite would refetch the journey and wipe
   * every answer the customer has given.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMachine = useRef(searchParams.get('machine'));

  // ── Loading / journey config ──
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [journey, setJourney] = useState(null);
  const [rawSteps, setRawSteps] = useState([]);

  // ── The customer's progress ──
  const [model, setModel] = useState(null);
  const [answers, setAnswers] = useState({});
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState('forward');
  // Set by jumpToQuestion when editing an answer from the recommendation
  // screen; lets goNext hop straight back once nothing else needs attention.
  const [returnStepKey, setReturnStepKey] = useState(null);
  const [missing, setMissing] = useState([]);
  const [deploymentName, setDeploymentName] = useState('');
  const [nameError, setNameError] = useState(null);
  const [chosenTierId, setChosenTierId] = useState(null);
  // Non-null only in preset mode: the machine is settled and the recommendation
  // step has already been dropped from the journey server-side.
  const [machine, setMachine] = useState(null);
  /**
   * True once the server has confirmed the chosen machine. In this mode the
   * journey asks the same questions but recommends nothing: the hardware is
   * settled, so every sizing call would compute an answer nobody is going to
   * be shown.
   */
  const hardwarePreset = !!machine;
  /**
   * A machine the customer assembled themselves in the builder, in the same
   * shape as any other tier so nothing downstream has to care. It has no
   * `tierId` — `customPicks` is its identity, and the server re-prices those
   * on both the checkout quote and the create.
   */
  const [customMachine, setCustomMachine] = useState(null);
  const [region, setRegion] = useState(null);

  // ── Engine output ──
  // `recommendation` is hardware sizing for `model`; `modelMatches` is the
  // ranked-catalogue answer, kept separate so picking a model doesn't wipe
  // the match list a "go back and try another" gesture needs to redraw from.
  const [recommendation, setRecommendation] = useState(null);
  const [modelMatches, setModelMatches] = useState(null);
  // Admin-editable copy for the "everything is blocked" notice. Arrives on
  // every /recommend response; kept separately because the match screen and
  // the sizing screen are fed by different calls but share the notice.
  const [blockerTemplates, setBlockerTemplates] = useState(null);
  const [sizingLoading, setSizingLoading] = useState(false);
  const [wallet, setWallet] = useState(null);

  // ── Poor-fit gate: hardware waits for the model choice to be settled ──
  const [modelConfirmed, setModelConfirmed] = useState(false);
  const [altModels, setAltModels] = useState([]);
  const [altLoading, setAltLoading] = useState(false);

  // ── Submission ──
  const [created, setCreated] = useState(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const sizingTimer = useRef(null);
  const sizingRequestId = useRef(0);
  const altRequestId = useRef(0);
  const stageRef = useRef(null);

  /* ── Load the journey and (if given) the model ─────────────────────────── */

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const mode = requirementsFirst ? 'requirements_first' : 'model_first';

    Promise.all([
      slug ? catalogApi.getModel(slug) : Promise.resolve(null),
      deploymentsApi.getJourney({
        ...(slug ? { modelId: slug } : {}),
        ...(initialMachine.current ? { machine: initialMachine.current } : {}),
        mode,
      }),
    ])
      .then(([modelData, journeyData]) => {
        if (cancelled) return;

        if (modelData?.model) {
          setModel(modelData.model);
          setDeploymentName(`${modelData.model.slug}-1`);
        }

        /*
         * The server decides whether the machine is usable — it returns null
         * for one that has been retired, renamed or unlinked from this model,
         * and sends back the full journey with its recommendation step. A
         * stale bookmark degrades into the normal flow rather than an error.
         */
        setMachine(journeyData.machine || null);
        if (initialMachine.current && !journeyData.machine) {
          setSearchParams({}, { replace: true });
        }

        setJourney(journeyData.journey);
        setRawSteps(journeyData.steps || []);

        // Seed whatever defaults the admin configured on the questions
        const defaults = {};
        (journeyData.steps || []).forEach((step) => {
          (step.questions || []).forEach((q) => {
            if (q.defaultValue !== null && q.defaultValue !== undefined) {
              defaults[q.key] = q.defaultValue;
            }
          });
        });
        setAnswers(defaults);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.response?.data?.message || t('deploy:journey.startFailed'));
      })
      .finally(() => !cancelled && setLoading(false));

    return () => { cancelled = true; };
    // Deliberately NOT keyed on the machine param: the review screen rewrites
    // it when the customer switches machines, and refetching here would reset
    // every answer they have given.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, requirementsFirst]);

  useEffect(() => {
    if (!creditsEnabled) return undefined;
    let cancelled = false;
    walletApi.get().then((w) => !cancelled && setWallet(w.wallet)).catch(() => {});
    return () => { cancelled = true; };
  }, [creditsEnabled]);

  /* ── Which steps are actually on screen right now ──────────────────────── */

  const steps = useMemo(
    () => rawSteps.filter((step) => isVisible(step, answers)),
    [rawSteps, answers]
  );

  const step = steps[stepIndex] || null;

  /** Every question in the flow, for the review screen and validation. */
  const allQuestions = useMemo(
    () => steps.reduce((acc, s) => acc.concat(s.questions || []), []),
    [steps]
  );

  /**
   * Only the answers that belong to currently-visible questions.
   *
   * Retracted answers must be excluded, not just hidden: if someone turns
   * fine-tuning back off, the answer they gave to its follow-up is still in
   * state, and sending it would keep inflating the sizing behind a question
   * that is no longer on screen. The backend filters these too — this is the
   * matching half so the UI and the engine agree on what was actually said.
   */
  const activeAnswers = useMemo(() => {
    const visibleKeys = new Set(
      allQuestions.filter((q) => isVisible(q, answers)).map((q) => q.key)
    );
    return Object.entries(answers)
      .filter(([key]) => visibleKeys.has(key))
      .map(([questionKey, answer]) => ({ questionKey, answer }));
  }, [allQuestions, answers]);

  // Always-current snapshot, so callbacks created on an earlier render (an
  // auto-advance timer, say) still send the answer that was just given.
  const activeAnswersRef = useRef(activeAnswers);
  useEffect(() => { activeAnswersRef.current = activeAnswers; }, [activeAnswers]);

  /* ── Live sizing ───────────────────────────────────────────────────────── */

  /**
   * Ask the engine to size things.
   *
   * Calls can overlap — the debounced effect and an explicit call from
   * `goNext` or `chooseModel` can be in flight at once — so each request takes
   * a ticket and only the newest one is allowed to write. Without this a slow
   * earlier response can land after a faster later one and quietly replace a
   * correct recommendation with a stale one.
   */
  const runSizing = useCallback(async (modelId, payloadAnswers, limit) => {
    const ticket = ++sizingRequestId.current;
    setSizingLoading(true);

    try {
      const result = await deploymentsApi.recommend({
        ...(modelId ? { modelId } : {}),
        answers: payloadAnswers,
        ...(limit ? { limit } : {}),
      });

      if (ticket !== sizingRequestId.current) return null;

      if (result.blockerTemplates) setBlockerTemplates(result.blockerTemplates);

      if (result.mode === 'match_models') {
        setModelMatches(result.matches || []);
      } else {
        setRecommendation(result);
        // Adopt our own pick unless the customer has already chosen otherwise.
        setChosenTierId((current) => current || result.recommendation?.primary?.tierId || null);
      }
      return result;
    } catch {
      // Sizing is advisory — a failure must not derail the journey.
      return null;
    } finally {
      if (ticket === sizingRequestId.current) setSizingLoading(false);
    }
  }, []);

  const setAnswer = useCallback((key, value) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setMissing((prev) => prev.filter((k) => k !== key));
  }, []);

  /**
   * A fingerprint of just the answers that could change the recommendation.
   *
   * `affectsSizing` is derived server-side from whether a question carries any
   * sizing signals, which is exactly what makes this cheap: typing in the free
   * text box never moves this string, so it never triggers a recompute. And
   * because it hashes values rather than counting them, changing an existing
   * answer re-fires properly — counting would have missed that entirely.
   */
  const sizingSignature = useMemo(() => {
    const keys = allQuestions
      .filter((q) => q.affectsSizing && isVisible(q, answers))
      .map((q) => q.key);
    return JSON.stringify(keys.map((k) => [k, answers[k] ?? null]));
  }, [allQuestions, answers]);

  useEffect(() => {
    if (!journey || loading) return undefined;
    // Nothing to size for: the machine is already chosen and no screen in this
    // journey renders a recommendation.
    if (hardwarePreset) return undefined;
    if (!activeAnswersRef.current.length) return undefined;

    const timer = setTimeout(() => {
      runSizing(model?.id, activeAnswersRef.current, journey?.settings?.modelMatchLimit);
    }, SIZING_DEBOUNCE_MS);

    sizingTimer.current = timer;
    return () => clearTimeout(timer);
  }, [sizingSignature, journey, loading, hardwarePreset, model?.id, runSizing]);

  /* ── Poor-fit gate ─────────────────────────────────────────────────────
   * A model that looks like a bad match for what the customer described
   * shouldn't have hardware quoted for it until they've actually decided to
   * go ahead with it — showing "here is your $500/mo box" next to "this
   * model might be wrong for you" in the same breath reads as contradictory.
   * `modelConfirmed` resets whenever the model changes and only matters when
   * the fit is poor; a good or cautious fit never gates anything.
   */
  const isPoorFit = !!recommendation && recommendation.suitability?.verdict === 'poor';
  const hardwareLocked = isPoorFit && !modelConfirmed;

  useEffect(() => {
    setModelConfirmed(false);
  }, [model?.id]);

  const runAltModels = useCallback(async (payloadAnswers) => {
    const ticket = ++altRequestId.current;
    setAltLoading(true);
    try {
      const result = await deploymentsApi.recommend({ answers: payloadAnswers, limit: 4 });
      if (ticket !== altRequestId.current) return;
      setAltModels((result.matches || []).filter((m) => String(m.model.id) !== String(model?.id)));
    } catch {
      // Advisory only — the gate still offers "keep this model anyway".
    } finally {
      if (ticket === altRequestId.current) setAltLoading(false);
    }
  }, [model?.id]);

  // Kept in sync whenever hardware is scored, not just on a poor fit: the
  // recommendation screen also offers "compare with other suggested models"
  // for a good or cautious fit, and that list should reflect the answers
  // actually on record rather than whatever happened to be true earlier.
  useEffect(() => {
    // Never fires in preset mode — `recommendation` stays null because nothing
    // requests sizing — but stated explicitly so the intent survives a future
    // edit to how recommendations are fetched.
    if (hardwarePreset || !recommendation) {
      setAltModels([]);
      return;
    }
    runAltModels(activeAnswersRef.current);
  }, [hardwarePreset, recommendation, model?.id, runAltModels]);

  /* ── Navigation ────────────────────────────────────────────────────────── */

  const validateStep = useCallback(() => {
    if (!step) return true;

    if (step.type === 'question' || step.type === 'question_group') {
      if (step.skippable) return true;
      const unanswered = (step.questions || [])
        .filter((q) => q.required && isVisible(q, answers) && !isAnswered(answers[q.key], q.type));

      if (unanswered.length) {
        setMissing(unanswered.map((q) => q.key));
        return false;
      }
    }

    if (step.type === 'name') {
      if (!deploymentName.trim()) {
        setNameError(t('deploy:name.required'));
        return false;
      }
      setNameError(null);
    }

    if (step.type === 'model_match' && !model) {
      return false;
    }

    if (step.type === 'recommendation' && hardwareLocked) {
      return false;
    }

    return true;
  }, [t, step, answers, deploymentName, model, hardwareLocked]);

  const goNext = useCallback(async () => {
    if (!validateStep()) return;

    // Returning from an answer edit (see jumpToQuestion below): if nothing
    // between here and there still needs an answer, skip straight back
    // rather than making the customer re-walk every step they already got
    // through once just to fix the one thing that was wrong.
    if (returnStepKey) {
      const targetIndex = steps.findIndex((s) => s.key === returnStepKey);

      if (targetIndex > stepIndex) {
        const between = steps.slice(stepIndex + 1, targetIndex);
        const stillNeeded = between.some((s) => (s.questions || []).some(
          (q) => q.required && isVisible(q, answers) && !isAnswered(answers[q.key], q.type)
        ));

        if (!stillNeeded) {
          const target = steps[targetIndex];
          if (target && (target.type === 'recommendation' || target.type === 'model_match')) {
            if (sizingTimer.current) clearTimeout(sizingTimer.current);
            await runSizing(model?.id, activeAnswersRef.current, journey?.settings?.modelMatchLimit);
          }
          setReturnStepKey(null);
          setDirection('forward');
          setStepIndex(targetIndex);
          return;
        }
      } else {
        setReturnStepKey(null);
      }
    }

    const next = steps[stepIndex + 1];

    // Make sure the recommendation is actually ready before revealing it —
    // and read answers from the ref, since an auto-advance fires from a timer
    // set before the last answer was committed.
    if (next && (next.type === 'recommendation' || next.type === 'model_match')) {
      if (sizingTimer.current) clearTimeout(sizingTimer.current);
      await runSizing(model?.id, activeAnswersRef.current, journey?.settings?.modelMatchLimit);
    }

    setDirection('forward');
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }, [validateStep, steps, stepIndex, model, journey, runSizing, returnStepKey, answers]);

  const goBack = useCallback(() => {
    // A deliberate step back cancels a pending "return to where I was" — the
    // customer is choosing to explore further rather than just fix one answer.
    setReturnStepKey(null);
    setDirection('back');
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  /**
   * Jump straight to whichever step asked the question behind a given
   * constraint — "you said $500, here's what's blocking that" is only
   * actionable if changing the answer doesn't mean exiting and restarting.
   * Every issue and reason the engine produces already names its
   * `questionKey`, so this works for any constraint, not just budget.
   * Remembers where we came from so `goNext` can hop straight back once the
   * edit is made, instead of forcing a click through every step in between.
   */
  const jumpToQuestion = useCallback((questionKey) => {
    if (!questionKey) return;
    const idx = steps.findIndex((s) => (s.questions || []).some((q) => q.key === questionKey));
    if (idx < 0) return;
    setReturnStepKey((current) => current || step?.key || null);
    setDirection('back');
    setStepIndex(idx);
  }, [steps, step]);

  // The auto-advance timer fires after the render that scheduled it is gone,
  // so it has to reach for the current goNext rather than the captured one.
  const goNextRef = useRef(goNext);
  useEffect(() => { goNextRef.current = goNext; }, [goNext]);

  /**
   * Picking an answer moves the journey on by itself, but the Continue button
   * stays on screen — and it is the obvious "next" affordance, so people click
   * both. That advanced twice and silently skipped the following question:
   * required ones were caught by validation, but the optional ones were not,
   * and four of those (context_length, latency, fine_tuning, monthly_budget)
   * feed the hardware sizing. The customer ended up with a machine and an
   * hourly price derived from answers they were never asked for.
   *
   * Two guards, one for each ordering:
   *  - `pendingAutoAdvance` lets an explicit Continue cancel a scheduled
   *    auto-advance, so the click doesn't get doubled by a timer still to fire.
   *  - `autoAdvancedAt` absorbs the opposite case: a click that lands just
   *    after the timer already moved us on. Only auto-advances arm this, so
   *    deliberate rapid navigation (holding Enter through answered steps)
   *    is unaffected.
   */
  const pendingAutoAdvance = useRef(null);
  const autoAdvancedAt = useRef(0);

  const cancelPendingAutoAdvance = useCallback(() => {
    if (pendingAutoAdvance.current) {
      clearTimeout(pendingAutoAdvance.current);
      pendingAutoAdvance.current = null;
    }
  }, []);

  useEffect(() => cancelPendingAutoAdvance, [cancelPendingAutoAdvance]);

  /**
   * When the customer picks a model — from the scenario-2 match screen, or
   * from the "better-fitting models" gate on the recommendation screen
   * itself — re-run sizing against that model. `advance` is false for the
   * latter: we're already on the recommendation step and just want it to
   * redraw for the new model, not skip forward past it.
   */
  const chooseModel = useCallback(async (picked, options = {}) => {
    const { advance = true } = options;

    setDeploymentName((current) => (
      !current || current === `${model?.slug}-1` ? `${picked.slug}-1` : current
    ));
    setModel(picked);
    setChosenTierId(null);
    // A custom machine was sized and VRAM-checked against the old model, so it
    // cannot carry over to a different one.
    setCustomMachine(null);
    // Clear the stale recommendation so the screen shows a loading state
    // rather than the previous model's hardware while this one is scored.
    setRecommendation(null);
    await runSizing(picked.id, activeAnswersRef.current);

    if (advance) {
      setDirection('forward');
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    }
  }, [runSizing, steps.length, model]);

  /**
   * Advance by itself after a single-choice answer, so picking one of six
   * cards doesn't also require reaching for a Continue button. Only for
   * single-select — multiselect and free text need an explicit "done".
   *
   * Declared before the keyboard handler because that handler uses it too:
   * clicking a card and pressing its number must do the same thing, or the
   * number badge on each option is a lie.
   */
  const autoAdvance = journey?.settings?.autoAdvance !== false;
  const autoAdvanceDelay = journey?.settings?.autoAdvanceDelayMs ?? 350;

  const handleAnswerAndMaybeAdvance = useCallback((key, value, question) => {
    setAnswer(key, value);

    const single = question.type === 'select'
      || question.type === 'radio'
      || question.type === 'boolean';

    if (autoAdvance && single && step?.type === 'question') {
      cancelPendingAutoAdvance();
      pendingAutoAdvance.current = setTimeout(() => {
        pendingAutoAdvance.current = null;
        autoAdvancedAt.current = Date.now();
        goNextRef.current();
      }, autoAdvanceDelay);
    }
  }, [setAnswer, autoAdvance, autoAdvanceDelay, step, cancelPendingAutoAdvance]);

  /**
   * What every explicit "move me forward" gesture goes through — the Continue
   * button, Skip, and Enter. `goNext` itself stays unguarded for the internal
   * callers (the auto-advance timer, returning from an answer edit) that mean
   * exactly one step and know it.
   */
  const advance = useCallback(() => {
    if (Date.now() - autoAdvancedAt.current < autoAdvanceDelay + 400) return;
    cancelPendingAutoAdvance();
    goNext();
  }, [goNext, cancelPendingAutoAdvance, autoAdvanceDelay]);

  /* ── Keyboard ──────────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKeyDown = (e) => {
      // Never hijack typing.
      const tag = e.target.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;

      if (e.key === 'Enter') {
        // A textarea owns Enter — it inserts a newline. Ctrl/Cmd+Enter is the
        // way forward from one, which the hint under the field tells people.
        if (tag === 'TEXTAREA') {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            advance();
          }
          return;
        }

        // A single-line input fires its own onPressEnter, so advancing here as
        // well would skip two steps per keypress.
        if (typing || e.shiftKey) return;

        e.preventDefault();
        advance();
        return;
      }

      if (typing) return;

      if (e.key === 'Backspace' || (e.key === 'ArrowLeft' && e.altKey)) {
        e.preventDefault();
        goBack();
        return;
      }

      // Number keys pick an option on a single-question step.
      if (/^[1-9]$/.test(e.key) && step && step.type === 'question') {
        const question = step.questions?.[0];
        if (!question) return;

        const index = Number(e.key) - 1;

        // Route through the same handler a click uses, so a number key and a
        // tap behave identically — including the auto-advance.
        if (question.type === 'boolean') {
          if (index < 2) handleAnswerAndMaybeAdvance(question.key, index === 0, question);
          return;
        }

        const option = (question.options || [])[index];
        if (!option) return;

        if (question.type === 'multiselect') {
          const current = Array.isArray(answers[question.key]) ? answers[question.key] : [];
          setAnswer(
            question.key,
            current.includes(option.value)
              ? current.filter((v) => v !== option.value)
              : [...current, option.value]
          );
        } else {
          handleAnswerAndMaybeAdvance(question.key, option.value, question);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step, answers, setAnswer, handleAnswerAndMaybeAdvance, advance, goBack]);

  /* ── Submit ────────────────────────────────────────────────────────────── */

  /**
   * The machine this deployment will run on.
   *
   * A preset machine wins outright — it is the customer's own choice, made
   * before the journey started, and it is the only source of a tier in that
   * mode because no recommendation is ever fetched. Everything downstream
   * hangs off this one value: the region default, the Deploy button's enabled
   * state, and the checkout modal's pricing lookup.
   */
  const selectedTier = useMemo(() => {
    // Built in the builder, moments ago and on purpose — it outranks both the
    // preset and anything we would have suggested. Choosing a catalogue
    // machine clears it, so this can never quietly shadow a later choice.
    if (customMachine) return customMachine;
    if (machine) return machine;
    const all = recommendation?.recommendation?.allTiers || [];
    return all.find((t) => String(t.tierId) === String(chosenTierId))
      || recommendation?.recommendation?.primary
      || null;
  }, [customMachine, machine, recommendation, chosenTierId]);

  /**
   * The customer picked a catalogue machine — from the list, an alternative
   * card, or "use our suggestion". Any of those replaces a custom build.
   */
  const chooseTier = useCallback((tierId) => {
    setCustomMachine(null);
    setChosenTierId(tierId);
  }, []);

  /**
   * They built their own instead. Everything on screen is already priced by
   * the server (the builder re-quotes on every slider move), so this just
   * reshapes the quote into the tier shape the rest of the journey speaks.
   */
  const useCustomMachine = useCallback((build) => {
    setCustomMachine({
      tierId: null,
      isCustom: true,
      customPicks: build.picks,
      name: t('deploy:builder.customMachineName'),
      ...build.specs,
      pricePerHour: build.pricePerHour,
      pricePerDay: build.pricePerDay,
      pricePerMonth: build.pricePerMonth,
      stoppedPricePerHour: build.stoppedPricePerHour,
      stoppedPricePerMonth: build.stoppedPricePerMonth,
      currency: build.currency,
      // Region comes from the server at checkout for a custom machine; leaving
      // this empty keeps the region selector hidden rather than offering a
      // list this machine was never quoted against.
      regions: [],
      bookable: true,
      meetsVram: true,
    });
  }, [t, ]);

  /**
   * The machines this model runs on, for the review screen's switcher.
   *
   * Free: `catalogApi.getModel` already returned them, and it returns them in
   * the same shape as the preset machine — both come from the server's
   * `buildTierOptions`, so the price already carries this model's multiplier.
   * `bookable` and `currency` are normalised on here because the catalogue's
   * model payload omits them, and `undefined` must not reach checkout.
   */
  const machineOptions = useMemo(() => (model?.tiers || []).map((t) => ({
    ...t,
    currency: t.currency || machine?.currency || currency,
    bookable: t.status !== 'out_of_stock' && t.availableUnits !== 0,
  })), [model, machine, currency]);

  const chooseMachine = useCallback((tierId) => {
    const picked = machineOptions.find((t) => String(t.tierId) === String(tierId));
    if (!picked) return;
    setMachine(picked);
    // Keep the URL honest so a refresh or a shared link lands on the machine
    // they actually chose. `replace` so Back still leaves the journey rather
    // than stepping through every machine they tried.
    setSearchParams({ machine: picked.slug || picked.tierId }, { replace: true });
  }, [machineOptions, setSearchParams]);

  useEffect(() => {
    if (selectedTier?.regions?.length) {
      setRegion((current) =>
        current && selectedTier.regions.includes(current) ? current : selectedTier.regions[0]);
    }
  }, [selectedTier]);

  /**
   * The actual "commit money" step now happens in CheckoutModal, which
   * calls deploymentsApi.create itself once the customer has picked a
   * billing method and cleared the card gate. This only handles the one
   * failure the modal can't resolve on its own — the set of required
   * questions changed server-side while it was open — by sending the
   * customer back to fix it, the same way the old inline submit() did.
   */
  const handleMissingRequirements = useCallback(() => {
    setCheckoutOpen(false);
    const firstQuestion = steps.findIndex((s) => s.type === 'question' || s.type === 'question_group');
    if (firstQuestion >= 0) {
      setDirection('back');
      setStepIndex(firstQuestion);
    }
  }, [steps]);

  /* ── Render ────────────────────────────────────────────────────────────── */

  if (loading) return <DetailSkeleton />;

  if (loadError) {
    return (
      <Result
        status="404"
        title={t('deploy:journey.couldNotStart')}
        subTitle={loadError}
        extra={<Button type="primary" onClick={() => navigate('/models')}>{t('deploy:journey.backToCatalog')}</Button>}
      />
    );
  }

  if (created) {
    return (
      <Result
        status="success"
        title={t('deploy:journey.requested')}
        subTitle={
          journey?.settings?.completionMessage
          || t('deploy:journey.reviewingBody', { deploymentName: created.deploymentName })
        }
        extra={[
          <Button type="primary" key="view" onClick={() => navigate(`/deployments/${created.id}`)}>
            {t('deploy:journey.viewDeployment')}
          </Button>,
          <Button key="all" onClick={() => navigate('/deployments')}>{t('deploy:journey.allDeployments')}</Button>,
        ]}
      />
    );
  }

  // No journey configured at all — say so rather than showing a blank stage.
  if (!journey || !steps.length) {
    return (
      <Result
        status="warning"
        title={t('deploy:journey.noFlowTitle')}
        subTitle={t('deploy:journey.noFlowBody')}
        extra={<Button type="primary" onClick={() => navigate('/models')}>{t('deploy:journey.backToCatalog')}</Button>}
      />
    );
  }

  const isLast = stepIndex === steps.length - 1;
  const showBack = journey.settings?.allowBack !== false && stepIndex > 0;
  const needsSizing = step?.type === 'recommendation' || step?.type === 'model_match';
  const waitingOnSizing = needsSizing && sizingLoading
    && (step?.type === 'model_match' ? !modelMatches : !recommendation);

  const eyebrow = journey.settings?.showProgressBar === false
    ? null
    : t('deploy:journey.stepOf', { current: stepIndex + 1, total: steps.length });

  const renderStep = () => {
    if (waitingOnSizing) {
      return <ThinkingDots label={t('deploy:recommendation.matching')} />;
    }

    switch (step.type) {
      case 'intro':
        return (
          <div>
            {/*
              * The seeded copy promises "we will pick the right hardware for
              * you", which is exactly what is NOT happening here — they picked
              * it. Overridden rather than edited in the seed, because the same
              * journey still runs the other way round for everyone who arrives
              * without a machine.
              */}
            <StepHeading
              title={step.title}
              subtitle={hardwarePreset
                ? t('deploy:journey.intro')
                : step.subtitle}
            />
            {step.body && !hardwarePreset && (
              <Paragraph type="secondary" style={{ fontSize: 15, maxWidth: 560 }}>
                {step.body}
              </Paragraph>
            )}
            {model && (
              <Card
                style={{ ...surfaceStyle(isDark), marginTop: 24, maxWidth: 520 }}
                styles={{ body: { padding: 20 } }}
              >
                <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{t('deploy:journey.deploying')}</Text>
                <Text strong style={{ fontSize: 18 }}>{model.name}</Text>
                <Text dir="auto" type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
                  {model.shortDescription}
                </Text>
                {/* Their own choice, confirmed back to them — this is the only
                    screen before review that mentions the machine at all. */}
                {machine && (
                  <div style={{
                    marginTop: 14, paddingTop: 14,
                    borderTop: `1px solid ${isDark ? SURFACE.borderDark : SURFACE.borderLight}`,
                  }}>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>On</Text>
                    <Text strong style={{ fontSize: 15 }}>{machine.name}</Text>
                    <Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginTop: 2, ...ltrTechnical }}>
                      {tierSpecLine(machine)} · {currency} {formatRate(machine.pricePerHour)}{t('common:units.perHour')}
                    </Text>
                  </div>
                )}
              </Card>
            )}
          </div>
        );

      case 'question':
      case 'question_group':
        return (
          <QuestionStep
            step={step}
            answers={answers}
            missing={missing}
            eyebrow={eyebrow}
            onEnter={advance}
            setAnswer={(key, value) => {
              const question = (step.questions || []).find((q) => q.key === key);
              if (question) handleAnswerAndMaybeAdvance(key, value, question);
              else setAnswer(key, value);
            }}
          />
        );

      case 'model_match':
        return (
          <ModelMatchStep
            step={step}
            eyebrow={eyebrow}
            matches={modelMatches || []}
            currency={currency}
            chosenModelId={model?.id}
            onChooseModel={chooseModel}
            onEditAnswer={jumpToQuestion}
            blockerTemplates={blockerTemplates}
          />
        );

      case 'recommendation':
        return recommendation?.recommendation ? (
          <RecommendationStep
            step={step}
            eyebrow={eyebrow}
            recommendation={recommendation}
            model={model}
            modelName={model?.name}
            currency={currency}
            chosenTierId={chosenTierId}
            onChooseTier={chooseTier}
            customMachine={customMachine}
            onUseCustomMachine={useCustomMachine}
            locked={hardwareLocked}
            alternativeModels={altModels}
            altLoading={altLoading}
            onChooseAlternative={(pickedModel) => chooseModel(pickedModel, { advance: false })}
            onKeepModel={() => setModelConfirmed(true)}
            onEditAnswer={jumpToQuestion}
            blockerTemplates={blockerTemplates}
            wallet={wallet}
            creditsEnabled={creditsEnabled}
          />
        ) : (
          <ThinkingDots label={t('deploy:recommendation.matching')} />
        );

      case 'name':
        return (
          <NameStep
            step={step}
            eyebrow={eyebrow}
            value={deploymentName}
            error={nameError}
            onChange={(v) => { setDeploymentName(v); setNameError(null); }}
            onEnter={advance}
          />
        );

      case 'review':
        return (
          <ReviewStep
            step={step}
            eyebrow={eyebrow}
            model={model}
            tier={selectedTier}
            deploymentName={deploymentName}
            region={region}
            regions={selectedTier?.regions}
            onRegionChange={setRegion}
            answers={answers}
            questions={allQuestions}
            currency={currency}
            wallet={wallet}
            creditsEnabled={creditsEnabled}
            // Only in preset mode: without a recommendation screen this is the
            // one place left to see or change the machine.
            machineOptions={hardwarePreset ? machineOptions : undefined}
            onChangeMachine={hardwarePreset ? chooseMachine : undefined}
          />
        );

      default:
        return (
          <div>
            <StepHeading eyebrow={eyebrow} title={step.title} subtitle={step.subtitle} />
            {step.body && <Paragraph type="secondary">{step.body}</Paragraph>}
          </div>
        );
    }
  };

  return (
    <div className={direction === 'back' ? 'journey-back' : undefined}>
      {/* Exit — a journey needs a visible way out that isn't the browser back button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Button
          type="text"
          icon={<CloseOutlined />}
          // Back to wherever they started: the machine they were browsing,
          // the model's page, or their deployments.
          onClick={() => navigate(
            machine ? `/machines/${machine.slug || machine.tierId}`
              : slug ? `/models/${slug}` : '/deployments'
          )}
          style={{ paddingInlineStart: 0 }}
        >
          {t('deploy:journey.exit')}
        </Button>

        {/* No live sizing in preset mode — the chip would be advertising a
            calculation that never runs. The chosen machine is shown on the
            review screen instead. */}
        {journey.settings?.showLiveSizing !== false && !needsSizing && !hardwarePreset && (
          <LiveSizingChip
            recommendation={recommendation}
            currency={currency}
            loading={sizingLoading}
          />
        )}
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {journey.settings?.showProgressBar !== false && (
          <ProgressRail current={stepIndex} total={steps.length} />
        )}

        {/* key on the step so the enter animation replays on every change */}
        <div key={step.key} ref={stageRef} className="journey-enter" style={{ minHeight: 320 }}>
          {renderStep()}
        </div>

        {/* Footer — inline with the content rather than in a detached card */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, marginTop: 36, paddingTop: 20,
          borderTop: `1px solid ${isDark ? SURFACE.borderDark : SURFACE.borderLight}`,
        }}>
          <div>
            {showBack && (
              <Button type="text" icon={<ArrowLeftOutlined />} onClick={goBack}>
                {t('deploy:journey.back')}
              </Button>
            )}
          </div>

          <Space size={14} align="center">
            {step.skippable && !isLast && (
              <Button type="text" onClick={advance}>{t('deploy:journey.skip')}</Button>
            )}

            <Text type="secondary" style={{ fontSize: 11.5, display: 'none' }} className="journey-kbd">
              {t('deploy:journey.pressEnter')}
            </Text>

            {isLast ? (
              <Button
                type="primary"
                size="large"
                icon={<RocketOutlined />}
                disabled={!model || !selectedTier}
                onClick={() => setCheckoutOpen(true)}
                style={{ borderRadius: 12, fontWeight: 600, paddingInline: 28 }}
              >
                {step.ctaLabel || t('deploy:checkout.deploy')}
              </Button>
            ) : (
              <Button
                type="primary"
                size="large"
                icon={<ArrowRightOutlined />}
                iconPosition="end"
                loading={needsSizing && sizingLoading}
                disabled={step.type === 'recommendation' && hardwareLocked}
                onClick={advance}
                style={{ borderRadius: 12, fontWeight: 600, paddingInline: 24 }}
              >
                {step.ctaLabel || t('deploy:journey.continue')}
              </Button>
            )}
          </Space>
        </div>
      </div>

      <CheckoutModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        model={model}
        tier={selectedTier}
        region={region}
        journeyKey={journey?.key || ''}
        requirements={activeAnswers}
        deploymentName={deploymentName}
        onDeployed={(deployment) => { setCheckoutOpen(false); setCreated(deployment); }}
        onMissingRequirements={handleMissingRequirements}
      />
    </div>
  );
};

export default DeployJourney;
