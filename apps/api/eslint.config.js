import { nestConfig } from '@smsvio/config/eslint/nest';

export default [
  ...nestConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ['src/**/*.test.ts', 'test/**/*.int.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
];
