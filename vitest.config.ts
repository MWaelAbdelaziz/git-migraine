import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests shell out to real `git`; give them room and run serially
    // enough to avoid temp-dir churn issues.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
