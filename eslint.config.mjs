import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { noocodec } from './eslint-rules/noocodec.mjs';

// Minimal parser that accepts any content without errors.
// Used to silence ESLint warnings on non-code files (JSON, CSS, etc.)
// when litany --changed passes them to ESLint via git status --porcelain.
const noopParser = {
  parseForESLint: () => ({
    ast: {
      type: 'Program', body: [], sourceType: 'module',
      range: [0, 0],
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
      tokens: [], comments: []
    },
    visitorKeys: { Program: [] },
    scopeManager: null,
    services: {}
  })
};

const TS_FILES = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];
const CODE_FILES = [...TS_FILES, '**/*.js', '**/*.mjs', '**/*.cjs'];
const NOOP_FILES = ['**/*.json', '**/*.md', '**/*.css', '**/*.html', '**/*.yml', '**/*.yaml'];

export default [
  {
    ignores: ['dist/', 'node_modules/', 'coverage/']
  },
  // No-op entries for non-code files so litany --changed does not fail.
  // git status --porcelain includes all modified files; eslint must not
  // error or warn when passed json/css/md/yml paths.
  {
    files: NOOP_FILES,
    languageOptions: { parser: noopParser },
    rules: {}
  },
  {
    files: CODE_FILES,
    ...js.configs.recommended
  },
  // Scope tseslint configs to TS files only to prevent them applying to json.
  ...tseslint.configs.recommended.map(config => ({
    ...config,
    files: config.files ?? TS_FILES
  })),
  {
    files: ['src/**/*.ts', 'plugins/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    plugins: {
      noocodec
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      // Identifiers must describe what a thing is — no single-character names.
      'id-length': ['error', { min: 3, exceptions: ['as', 'fs', 'js', 'of', 'os', 'ts', 'vm'], properties: 'never' }],
      // noocodec custom rules — scope/scope-report phase only (violations not yet fixed)
      'noocodec/interface-must-be-contract': ['error', { allow: [] }],
      'noocodec/logger-binding-name':        'error'
    }
  },
  // src/types/ is the canonical type-grouping barrel — exempt it from
  // group-types-in-namespace so the rule fires only on non-barrel src files.
  {
    files: ['src/**/*.ts', 'plugins/**/*.ts', 'tests/**/*.ts'],
    ignores: ['src/types/**'],
    rules: {
      'noocodec/group-types-in-namespace': 'error'
    }
  }
];
