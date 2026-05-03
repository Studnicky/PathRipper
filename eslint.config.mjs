import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  {
    ignores: ['dist/', 'node_modules/', 'coverage/']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }]
    }
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/rdf/**', 'src/shacl/**'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'n3',                 message: 'Use src/rdf/Serializer.ts or src/rdf/Parser.ts' },
          { name: 'jsonld',             message: 'Use src/rdf/Serializer.ts or src/rdf/Parser.ts' },
          { name: 'rdf-canonize',       message: 'Use src/rdf/Canonicalize.ts' },
          { name: 'rdf-validate-shacl', message: 'Use src/shacl/ShaclGate.ts' },
          { name: '@rdfjs/data-model',  message: 'Use src/rdf/DataFactory.ts' },
          { name: '@rdfjs/dataset',     message: 'Use src/rdf/Dataset.ts' },
          { name: '@rdfjs/namespace',   message: 'Use src/rdf/Namespaces.ts or src/rdf/Vocab.ts' },
        ],
        patterns: [{ group: ['@semantics/*'], message: 'v1.x only — application code stays behind src/rdf/* wrappers' }],
      }],
    },
  },
];
