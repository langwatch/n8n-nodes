import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'credentials/**/*.credentials.ts',
    'nodes/**/*.node.ts',
    'shared/index.ts',
  ],
  outDir: 'dist',
  format: ['cjs'],
  target: 'node18',
  platform: 'node',
  sourcemap: true,
  clean: false,
  dts: false,
  splitting: false,
  treeshake: true,
  minify: false,
  // Bundle sdk + templating to avoid nested node_modules in custom dir
  noExternal: ['langwatch', 'liquidjs'],
  // Keep n8n-provided packages external
  external: ['n8n-workflow'],
  // Preserve file structure
  shims: false,
});


