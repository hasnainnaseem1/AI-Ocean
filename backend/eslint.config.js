/**
 * Lint rules for the backend.
 *
 * This is not a style config — formatting is left alone deliberately. Every
 * rule below exists because the pattern it bans produced a real, reproduced bug
 * in this codebase, and the fix for that bug was to extract a shared helper.
 * Nothing stopped the next route from hand-rolling the same thing again, which
 * is exactly what happened between BUG-010 and BUG-034: the first fix reached
 * 66 query sites, the response-shape sites kept the old behaviour, and the
 * result was a 200 with `{"page":null,"pages":-7}` in it.
 *
 * So the rules encode the conclusions:
 *
 *   - pagination goes through `utils/helpers/pagination.js` (BUG-010, BUG-034)
 *   - error responses go through `utils/helpers/apiError.js` (BUG-006, BUG-028)
 *   - the account-status vocabulary lives in one place (Phase B of CLEANUP_PLAN)
 *
 * Run: npm run lint    (npm run lint:fix for the auto-fixable ones)
 *
 * When a rule is genuinely wrong for a line — the helper module itself, say —
 * disable it on that line with a comment explaining why, rather than loosening
 * the rule for everyone.
 */

const HELPERS = ['**/utils/helpers/pagination.js', '**/utils/helpers/apiError.js'];

module.exports = [
  {
    ignores: ['node_modules/**', 'prisma/migrations/**', 'uploads/**'],
  },

  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: {
      /*
       * Correctness rules. These are the ones that would have caught the
       * codemod damage during the QA fix phase — `node --check` parses a file
       * with an undefined `safeLimit` in it perfectly happily, and the 500 only
       * appears when the route is called.
       */
      'no-undef': 'error',
      /*
       * `ignoreRestSiblings` matters here: stripping a field by destructuring
       * it away — `const { password, ...safe } = user` — is the idiom this
       * codebase uses to keep secrets out of responses, and the "unused"
       * binding is the entire point of it.
       */
      'no-unused-vars': ['warn', {
        args: 'none',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'require-atomic-updates': 'off',

      'no-restricted-syntax': [
        'error',

        // ── Pagination ────────────────────────────────────────────────
        {
          selector:
            "CallExpression[callee.name=/^(parseInt|Number)$/] > MemberExpression[object.property.name='query'][property.name=/^(page|limit|offset|skip)$/]",
          message:
            'Do not parse req.query.page/limit by hand — use paginate() from utils/helpers/pagination.js. '
            + 'Hand-rolled parsing is BUG-010 (page=0 → HTTP 500 on 40 of 66 endpoints).',
        },
        {
          selector:
            "Property[key.name='pages'][value.callee.object.name='Math'][value.callee.property.name='ceil']",
          message:
            'Do not compute the pagination block by hand — use meta(query, total) from '
            + 'utils/helpers/pagination.js. Computing it separately from the query is BUG-034 '
            + '(correct rows returned beside {"page":null,"pages":-7}).',
        },

        /*
         * ── Error responses ───────────────────────────────────────────
         *
         * Scoped to 500 on purpose. A 4xx branch that echoes `error.message`
         * is usually correct: the code threw that error itself, with a known
         * `code` and often extra fields the client needs (`balance`,
         * `required`, `tiers`), and `failure()` deliberately lets a
         * deliberate 4xx through. A 500 is by definition the unexpected
         * case — that is where a Prisma stack trace and an absolute file path
         * reach the caller, which is what BUG-006 actually was.
         */
        {
          selector:
            "CallExpression[callee.object.callee.property.name='status'][callee.object.arguments.0.value=500] Property[key.name='message'][value.object.name='error']",
          message:
            "Do not send an error's own .message on a 500 — use failure(res, err, 'fallback') "
            + 'from utils/helpers/apiError.js. Echoing raw errors is BUG-006 (absolute file paths '
            + 'and Prisma source excerpts returned to callers on 38 endpoints).',
        },

        // ── Account status vocabulary ─────────────────────────────────
        {
          selector: "Literal[value=/^ACCOUNT_(SUSPENDED|BANNED|INACTIVE)$/]",
          message:
            'Account-status codes live in middleware/auth/accountStatus.js only. Clients should '
            + 'read the `endsSession` flag on the response instead of matching on these strings.',
        },

        // ── Mongo is gone ─────────────────────────────────────────────
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value=/mongoose|mongodb/]",
          message: 'MongoDB was fully removed from this project. Use Prisma via src/lib/prismaClient.js.',
        },
      ],
    },
  },

  /*
   * The helper modules are the one legitimate place to do the thing their rule
   * bans — pagination.js *is* the hand-rolled parsing, accountStatus.js *is*
   * the list of codes. Linting them against their own rule would only teach
   * people to add blanket disables.
   */
  {
    files: [...HELPERS, '**/middleware/auth/accountStatus.js'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  /*
   * Seeds and one-off scripts are run by hand, print to the console, and often
   * carry deliberately unused destructured fields.
   */
  {
    files: ['src/scripts/**/*.js'],
    rules: { 'no-unused-vars': 'off' },
  },
];
