'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'assets/**',
      '.opencode/**',
      'package-lock.json'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      curly: ['error', 'multi-line'],
      'no-throw-literal': 'error',
      'no-console': 'off'
    }
  },
  {
    files: ['app.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser }
    }
  },
  {
    files: ['src/shared/calc.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.node, ...globals.browser }
    }
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: { ...globals.node }
    }
  }
];
