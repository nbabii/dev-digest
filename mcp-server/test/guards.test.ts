// Static guards over src/**/*.ts (plain node:fs scan, no extra dependency).
// Files that do not exist yet (services/, tools/, server.ts, main.ts) are simply
// not scanned, so these rules pass now and start enforcing the moment they land.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(PKG_ROOT, 'src');

interface SrcFile {
  /** posix path relative to src/, e.g. "tools/get-findings.ts" */
  rel: string;
  content: string;
}
interface ImportRef {
  spec: string;
  typeOnly: boolean;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function loadSrc(): SrcFile[] {
  return walk(SRC).map((full) => ({
    rel: path.relative(SRC, full).split(path.sep).join('/'),
    content: readFileSync(full, 'utf8'),
  }));
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

export function extractImports(content: string): ImportRef[] {
  const code = stripComments(content);
  const refs: ImportRef[] = [];
  const from = /\b(?:import|export)\s+(type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g;
  const bare = /\bimport\s*['"]([^'"]+)['"]/g;
  const dynamic = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of code.matchAll(from)) refs.push({ spec: m[2]!, typeOnly: !!m[1] });
  for (const m of code.matchAll(bare)) refs.push({ spec: m[1]!, typeOnly: false });
  for (const m of code.matchAll(dynamic)) refs.push({ spec: m[1]!, typeOnly: false });
  return refs;
}

/** Relative specifier -> src-relative module id without extension ("services/resolve"), or null if it escapes src/. */
function resolveRelative(fromRel: string, spec: string): string | null {
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  if (joined.startsWith('..')) return null;
  return joined.replace(/\.(js|ts)$/, '');
}

const isMain = (rel: string) => rel === 'main.ts';
const isTools = (rel: string) => rel.startsWith('tools/');
const isServices = (rel: string) => rel.startsWith('services/');
const isSdk = (spec: string) => spec.startsWith('@modelcontextprotocol/');

// ---- rules: each returns a list of human-readable violations ----

export function ruleNoStdout(files: SrcFile[]): string[] {
  const bad = /\bconsole\.(log|info)\b|\bprocess\.stdout\b/;
  return files
    .filter((f) => !isMain(f.rel)) // main.ts deliberately redirects console to stderr
    .filter((f) => bad.test(stripComments(f.content)))
    .map((f) => `${f.rel}: uses console.log/info or process.stdout (stdout is the JSON-RPC channel)`);
}

export function ruleFetchOnlyInApiClient(files: SrcFile[]): string[] {
  return files
    .filter((f) => f.rel !== 'api-client.ts')
    .filter((f) => /(?<![\w$])fetch\s*\(/.test(stripComments(f.content)))
    .map((f) => `${f.rel}: calls fetch( outside api-client.ts`);
}

export function ruleImportSpecifiers(files: SrcFile[], deps: string[]): string[] {
  const builtins = new Set(builtinModules);
  const out: string[] = [];
  for (const f of files) {
    for (const { spec } of extractImports(f.content)) {
      if (spec.startsWith('.')) {
        if (resolveRelative(f.rel, spec) === null) out.push(`${f.rel}: "${spec}" escapes src/`);
      } else if (spec.startsWith('node:') || builtins.has(spec)) {
        // builtin ok
      } else {
        const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;
        if (pkg.startsWith('@devdigest/') || !deps.includes(pkg)) {
          out.push(`${f.rel}: "${spec}" is not a declared dependency`);
        }
      }
    }
  }
  return out;
}

export function ruleImportDirection(files: SrcFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    for (const { spec, typeOnly } of extractImports(f.content)) {
      const target = spec.startsWith('.') ? resolveRelative(f.rel, spec) : null;
      const fail = (why: string) => out.push(`${f.rel}: imports "${spec}" — ${why}`);

      // Only main.ts (the composition root) may import the concrete adapter.
      if (target === 'api-client' && !isMain(f.rel)) fail('only main.ts may import api-client.ts');

      if (isTools(f.rel)) {
        if (target === 'server' || target === 'main') fail('tools/ may not import server.ts/main.ts');
      }
      if (isServices(f.rel) || f.rel === 'format.ts') {
        if (target && (target.startsWith('tools/') || ['server', 'main', 'result'].includes(target))) {
          fail('services/ and format.ts may not import tools/, server, main or result');
        }
        if (isSdk(spec)) fail('services/ and format.ts may not import @modelcontextprotocol/*');
      }
      if (f.rel === 'api-client.ts') {
        if (target && (target.startsWith('services/') || target.startsWith('tools/'))) {
          fail('api-client.ts may not import services/ or tools/');
        }
      }
      if (f.rel === 'ports.ts') {
        if (target && target !== 'constants' && !typeOnly) fail('ports.ts may import only constants or types');
        if (!spec.startsWith('.') && !typeOnly) fail('ports.ts may not import packages at runtime');
      }
      // MCP SDK only in delivery files.
      if (isSdk(spec) && !(f.rel === 'result.ts' || isTools(f.rel) || f.rel === 'server.ts' || isMain(f.rel))) {
        fail('@modelcontextprotocol/* allowed only in result.ts, tools/, server.ts, main.ts');
      }
    }
  }
  return out;
}

// ---- tests ----

describe('static guards over src/', () => {
  const files = loadSrc();
  const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const deps = Object.keys(pkg.dependencies ?? {});

  it('scans at least the core files', () => {
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining(['api-client.ts', 'ports.ts', 'format.ts']));
  });

  it('(a) no console.log/info or process.stdout outside main.ts', () => {
    expect(ruleNoStdout(files)).toEqual([]);
  });

  it('(b) imports are relative-in-src, node: builtins or declared dependencies', () => {
    expect(ruleImportSpecifiers(files, deps)).toEqual([]);
  });

  it('(c) import direction: tools -> services -> ports <- api-client, main is the root', () => {
    expect(ruleImportDirection(files)).toEqual([]);
  });

  it('(d) fetch( is used only in api-client.ts', () => {
    expect(ruleFetchOnlyInApiClient(files)).toEqual([]);
  });
});

describe('guard scanner self-test (in-memory bad samples)', () => {
  const f = (rel: string, content: string): SrcFile => ({ rel, content });

  it('detects stdout use but allows main.ts and ignores comments', () => {
    expect(ruleNoStdout([f('format.ts', 'console.log("x")')])).toHaveLength(1);
    expect(ruleNoStdout([f('a.ts', 'process.stdout.write("x")')])).toHaveLength(1);
    expect(ruleNoStdout([f('main.ts', 'console.log = console.error')])).toEqual([]);
    expect(ruleNoStdout([f('a.ts', '// console.log("x")')])).toEqual([]);
  });

  it('detects fetch outside api-client.ts', () => {
    expect(ruleFetchOnlyInApiClient([f('services/x.ts', 'await fetch(url)')])).toHaveLength(1);
    expect(ruleFetchOnlyInApiClient([f('api-client.ts', 'await fetch(url)')])).toEqual([]);
    expect(ruleFetchOnlyInApiClient([f('services/x.ts', 'this.fetchImpl(url)')])).toEqual([]);
  });

  it('detects foreign package imports', () => {
    const bad = [
      f('a.ts', "import { x } from '../../server/src/y.js';"),
      f('b.ts', "import type { Y } from '@devdigest/shared';"),
      f('c.ts', "import lodash from 'lodash';"),
    ];
    expect(ruleImportSpecifiers(bad, ['zod'])).toHaveLength(3);
    const good = [
      f('a.ts', "import { z } from 'zod';\nimport fs from 'node:fs';\nimport { k } from './constants.js';"),
    ];
    expect(ruleImportSpecifiers(good, ['zod'])).toEqual([]);
  });

  it('detects import-direction violations', () => {
    const bad = [
      f('tools/a.ts', "import { ApiClient } from '../api-client.js';"),
      f('services/a.ts', "import { t } from '../tools/descriptions.js';"),
      f('services/b.ts', "import { ok } from '../result.js';"),
      f('format.ts', "import { S } from '@modelcontextprotocol/sdk/server/mcp.js';"),
      f('api-client.ts', "import { s } from './services/resolve.js';"),
      f('ports.ts', "import { f } from './format.js';"),
      f('server.ts', "import { ApiClient } from './api-client.js';"),
    ];
    const v = ruleImportDirection(bad);
    for (const rel of ['tools/a.ts', 'services/a.ts', 'services/b.ts', 'format.ts', 'api-client.ts', 'ports.ts', 'server.ts']) {
      expect(v.some((m) => m.startsWith(`${rel}:`)), rel).toBe(true);
    }
  });

  it('accepts the legitimate layout', () => {
    const good = [
      f('main.ts', "import { ApiClient } from './api-client.js';\nimport { S } from '@modelcontextprotocol/sdk/server/stdio.js';"),
      f('result.ts', "import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';\nimport { estimateTokens } from './format.js';"),
      f('tools/a.ts', "import { run } from '../services/run-review.js';\nimport { ok } from '../result.js';\nimport { D } from './descriptions.js';"),
      f('services/a.ts', "import type { DevDigestApi } from '../ports.js';\nimport { shape } from '../format.js';"),
      f('ports.ts', "import { X } from './constants.js';\nimport type { Y } from './format.js';"),
    ];
    expect(ruleImportDirection(good)).toEqual([]);
  });
});
