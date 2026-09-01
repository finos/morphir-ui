import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/out/**', '**/release/**', '**/node_modules/**', '.moon/cache/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
      globals: { ...globals.browser },
    },
  },
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  {
    files: ['**/*.ts', '**/*.svelte'],
    ignores: ['packages/morphir-ui/src/components/editor/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['codemirror', '@codemirror/*', 'monaco-editor', 'monaco-editor/*'],
              message:
                'Import editor libraries only in packages/morphir-ui/src/components/editor. Use the CodeEditor component instead.',
            },
          ],
        },
      ],
    },
  },
)
