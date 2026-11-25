// Copy non-TS runtime assets (fonts) into the compiled main output so the
// packaged app can resolve them relative to __dirname. tsc does not copy
// binary files, so this runs as part of `build:main`.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'main', 'pdf', 'fonts');
const dest = join(root, 'dist-electron', 'main', 'pdf', 'fonts');

if (existsSync(src)) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`Copied fonts -> ${dest}`);
} else {
  console.warn(`No fonts directory at ${src}; skipping.`);
}
