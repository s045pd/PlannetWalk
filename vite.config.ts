/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/PlannetWalk/' : '/',
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
