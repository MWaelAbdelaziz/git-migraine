import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm', 'cjs'],
  dts: { entry: { index: 'src/index.ts' } },
  clean: true,
  sourcemap: true,
  target: 'node18',
  // Shebang so `dist/cli.js` is directly executable. Node strips the leading
  // `#!` line from any module it loads, so it is harmless on the library entry.
  banner: { js: '#!/usr/bin/env node' },
});
