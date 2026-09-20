import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  buildImportPreview,
  parseFrontMatter,
  IMPORT_LIMITS,
} from '../src/modules/skills/import-parser.js';
import { ValidationError } from '../src/platform/errors.js';

/**
 * Unit coverage for the (pure, no I/O) skill-import parser: front-matter
 * extraction, plain .md/.txt handling, and the zip path's core-selection +
 * ignored-entry reporting + size/entry-count guards.
 */

describe('parseFrontMatter', () => {
  it('extracts name/description/type from leading key: value lines', () => {
    const body = 'name: my-skill\ndescription: does a thing\ntype: convention\n\n# Body\ntext';
    expect(parseFrontMatter(body)).toEqual({
      name: 'my-skill',
      description: 'does a thing',
      type: 'convention',
    });
  });

  it('ignores an invalid type value', () => {
    expect(parseFrontMatter('type: not-a-real-type\n')).toEqual({});
  });

  it('stops scanning once it hits a heading (does not read the real body as front-matter)', () => {
    const body = '# Title\nname: should-not-be-picked-up';
    expect(parseFrontMatter(body)).toEqual({});
  });

  it('returns {} for a body with no front-matter at all', () => {
    expect(parseFrontMatter('Just a plain markdown paragraph.')).toEqual({});
  });
});

describe('buildImportPreview — plain .md/.txt upload', () => {
  it('uses the whole file as body, source imported_url, evidence_files = [filename]', () => {
    const body = 'name: my-rule\ndescription: a rule\ntype: rubric\n\nDo the thing.';
    const preview = buildImportPreview('my-rule.md', Buffer.from(body, 'utf-8'));
    expect(preview).toEqual({
      name: 'my-rule',
      description: 'a rule',
      type: 'rubric',
      body,
      source: 'imported_url',
      evidence_files: ['my-rule.md'],
    });
  });

  it('falls back to the filename (without extension) when no front-matter name is given', () => {
    const preview = buildImportPreview('security-checklist.txt', Buffer.from('just text'));
    expect(preview.name).toBe('security-checklist');
    expect(preview.type).toBe('custom');
    expect(preview.description).toBe('');
  });

  it('rejects an unsupported extension', () => {
    expect(() => buildImportPreview('script.sh', Buffer.from('#!/bin/sh'))).toThrow(
      ValidationError,
    );
  });

  it('rejects an upload over the size cap', () => {
    const big = Buffer.alloc(IMPORT_LIMITS.MAX_UPLOAD_BYTES + 1, 'a');
    expect(() => buildImportPreview('big.md', big)).toThrow(ValidationError);
  });
});

describe('buildImportPreview — .zip upload', () => {
  function zipOf(entries: Record<string, string>): Buffer {
    const files: Record<string, Uint8Array> = {};
    for (const [name, content] of Object.entries(entries)) files[name] = strToU8(content);
    return Buffer.from(zipSync(files));
  }

  it('prefers a top-level SKILL.md as the core over other markdown files', () => {
    const zip = zipOf({
      'SKILL.md': 'name: core-skill\n\n# Core\nThe real content.',
      'notes/extra.md': '# Not the core',
      'README.md': '# Also not the core',
    });
    const preview = buildImportPreview('bundle.zip', zip);
    expect(preview.name).toBe('core-skill');
    expect(preview.source).toBe('extracted');
    expect(preview.evidence_files).toEqual(['SKILL.md']);
    expect(preview.body).toContain('The real content.');
  });

  it('falls back to the first markdown file when no SKILL.md exists', () => {
    const zip = zipOf({ 'a.md': 'name: alpha\nalpha body' });
    const preview = buildImportPreview('bundle.zip', zip);
    expect(preview.name).toBe('alpha');
    expect(preview.evidence_files).toEqual(['a.md']);
  });

  it('reports every non-.md/.txt entry as ignored, and never lets it affect the result', () => {
    const zip = zipOf({
      'SKILL.md': 'name: core\ncore body',
      'scripts/run.sh': '#!/bin/sh\nrm -rf /',
      'assets/logo.png': 'not-really-a-png-but-binary-ish',
    });
    const preview = buildImportPreview('bundle.zip', zip);
    expect(preview.ignored).toEqual(
      expect.arrayContaining([
        { path: 'scripts/run.sh', ignored: true },
        { path: 'assets/logo.png', ignored: true },
      ]),
    );
    expect(preview.ignored).toHaveLength(2);
    // the ignored entries' content never leaked into body/name/description
    expect(preview.body).not.toContain('rm -rf');
  });

  it('.txt entries are also readable core candidates', () => {
    const zip = zipOf({ 'notes.txt': 'name: notes-skill\nplain text body' });
    const preview = buildImportPreview('bundle.zip', zip);
    expect(preview.name).toBe('notes-skill');
    expect(preview.source).toBe('extracted');
  });

  it('throws when no .md/.txt entry exists at all', () => {
    const zip = zipOf({ 'binary.dat': 'not text' });
    expect(() => buildImportPreview('bundle.zip', zip)).toThrow(ValidationError);
  });

  it('rejects an archive with more entries than the entry-count cap', () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i <= IMPORT_LIMITS.MAX_ZIP_ENTRIES; i++) {
      entries[`file-${i}.txt`] = 'x';
    }
    const zip = zipOf(entries);
    expect(() => buildImportPreview('bundle.zip', zip)).toThrow(ValidationError);
  });

  it('rejects an archive whose readable entries exceed the decompressed-size cap', () => {
    // One giant .md entry, comfortably under the raw ZIP upload cap (highly
    // compressible text) but over the DECOMPRESSED cap once read — the
    // zip-bomb guard this limit exists for.
    const huge = 'a'.repeat(IMPORT_LIMITS.MAX_DECOMPRESSED_BYTES + 1024);
    const zip = zipOf({ 'SKILL.md': huge });
    expect(zip.length).toBeLessThan(IMPORT_LIMITS.MAX_UPLOAD_BYTES);
    expect(() => buildImportPreview('bundle.zip', zip)).toThrow(ValidationError);
  });
});
