// Bundles the change-window CLI into one self-contained file, so a host with no node_modules
// can run it from a fresh clone (ADR-0059 increment 8). `npm run build` runs this after tsc.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli/change-mgr-cli.ts'],
  outfile: 'dist/bundle/change-mgr-cli.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  // Bundled CommonJS dependencies call require() for Node built-ins, which ESM lacks.
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
