import globals from 'globals';

// Deliberately limited to correctness checks on sensitive commerce code.
// ESLint complements node --check and node:test; it is not a formatter,
// a substitute for provenance checks, or a second runtime validation layer.
export default [{
  files: ['**/*.mjs'],
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    globals: {
      ...globals.nodeBuiltin,
    },
  },
  rules: {
    'no-undef': 'error',
    'no-dupe-keys': 'error',
    'no-unreachable': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-unsafe-finally': 'error',
    'valid-typeof': 'error',
    'no-self-compare': 'error',
  },
}, {
  // Browser globals are scoped to the actual customer UI: retain the same
  // correctness rules while avoiding Node-only assumptions for DOM APIs.
  files: ['src/search-page.mjs'],
  languageOptions: { globals: { ...globals.browser } },
}];
