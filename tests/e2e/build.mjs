// 画面テストの準備：本番ではCDNから読み込んでいる部品を、テスト用にローカルで用意する。
import { build } from 'esbuild';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cache = path.join(root, '.cache');
fs.mkdirSync(cache, { recursive: true });

fs.writeFileSync(path.join(cache, 'vendor-entry.js'), `
import React from 'react';
import * as ReactDOMClient from 'react-dom/client';
import * as Lucide from 'lucide-react';
import LZString from 'lz-string';
import * as JSXRuntime from 'react/jsx-runtime';
export { React, ReactDOMClient, Lucide, LZString, JSXRuntime };
`);
await build({
  entryPoints: [path.join(cache, 'vendor-entry.js')], bundle: true, format: 'esm', outfile: path.join(cache, 'vendor.js'),
  define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'error', nodePaths: [path.join(root, 'node_modules')],
});

const indexHtml = path.resolve(root, '..', 'index.html');
fs.writeFileSync(path.join(cache, 'tailwind.config.cjs'), `module.exports = { content: [${JSON.stringify(indexHtml)}] };`);
fs.writeFileSync(path.join(cache, 'in.css'), '@tailwind base;@tailwind components;@tailwind utilities;');
execFileSync(process.execPath, [path.join(root, 'node_modules/tailwindcss/lib/cli.js'), '-c', path.join(cache, 'tailwind.config.cjs'), '-i', path.join(cache, 'in.css'), '-o', path.join(cache, 'tw.css')], { stdio: ['ignore', 'ignore', 'ignore'] });
console.log('build OK');
