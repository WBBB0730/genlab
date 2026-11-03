//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
      // 类型感知的 no-unnecessary-condition 对外部接口（kie）返回值的防御性判断过度敏感。
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    ignores: ['dist', '.agents', 'eslint.config.js', 'prettier.config.js'],
  },
]
