import { unzipSync, type UnzipFileInfo } from 'fflate';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';

/**
 * Pure parsing for the Skill import flow (`POST /skills/import/preview`).
 * No I/O, no persistence — turns an uploaded `.md`/`.txt`/`.zip` buffer into a
 * suggested `{ name, description, type, body, source, evidence_files }`
 * payload plus a list of any zip entries that were ignored.
 *
 * SECURITY (see server/specs/skills.md's Import section + the `security`
 * skill's file-upload guidance): nothing in an uploaded archive is ever
 * executed. Only `.md`/`.txt` entries are read; every other entry is skipped
 * via fflate's `unzipSync` filter callback, which fflate calls with just the
 * central-directory metadata (name/size/compression) BEFORE deciding whether
 * to decompress — returning `false` from the filter means that entry's bytes
 * are never inflated, let alone read as code.
 */

/** Conservative caps, chosen for a markdown/text skill bundle (no legitimate
 *  skill doc needs more than a few MB or a few hundred files):
 *   - MAX_UPLOAD_BYTES: cap on the raw upload (single file OR zip archive).
 *   - MAX_DECOMPRESSED_BYTES: cap on total bytes actually read out of a zip's
 *     .md/.txt entries — a zip-bomb guard. Only counts entries we read; a
 *     huge non-text entry never counts because its bytes are never inflated.
 *   - MAX_ZIP_ENTRIES: cap on the archive's total entry count, checked from
 *     the central directory BEFORE any decompression — a many-tiny-files zip
 *     can still cause excessive iteration even under a byte cap alone. */
export const IMPORT_LIMITS = {
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024, // 5 MB
  MAX_DECOMPRESSED_BYTES: 20 * 1024 * 1024, // 20 MB
  MAX_ZIP_ENTRIES: 500,
} as const;

const READABLE_EXTENSIONS = new Set(['.md', '.txt']);

export interface IgnoredEntry {
  path: string;
  ignored: true;
}

export interface SkillImportPreview {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  source: SkillSource;
  evidence_files: string[];
  /** Zip entries that were never read (present, possibly empty, only for a
   *  `.zip` upload — omitted for a plain `.md`/`.txt` upload). */
  ignored?: IgnoredEntry[];
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

/** Exported for reuse by url-import.ts (URL-path-derived fallback name). */
export function baseName(name: string): string {
  const withoutDir = name.slice(name.lastIndexOf('/') + 1);
  const ext = extOf(withoutDir);
  return ext ? withoutDir.slice(0, -ext.length) : withoutDir;
}

/**
 * Light front-matter parse: `name:`/`description:`/`type:` lines at the top
 * of the markdown (before the first heading/blank-separated body), used to
 * pre-fill suggested fields. Not a full YAML parser — deliberately so, this
 * only ever reads plain `key: value` lines and never evaluates anything.
 */
export function parseFrontMatter(body: string): {
  name?: string;
  description?: string;
  type?: SkillType;
} {
  const out: { name?: string; description?: string; type?: SkillType } = {};
  const lines = body.split(/\r?\n/).slice(0, 20);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#')) break; // reached the real body / a heading
    const m = /^(name|description|type)\s*:\s*(.+)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim().replace(/^["']|["']$/g, '');
    if (!value) continue;
    if (key === 'type') {
      if (value === 'rubric' || value === 'convention' || value === 'security' || value === 'custom') {
        out.type = value;
      }
    } else if (key === 'name') {
      out.name = value;
    } else if (key === 'description') {
      out.description = value;
    }
  }
  return out;
}

interface ZipExtractResult {
  core?: { path: string; body: string };
  ignored: IgnoredEntry[];
}

/** Extract the "core" markdown/text file from a zip archive, per the
 *  selection rule: a top-level `SKILL.md` wins if present, else the first
 *  markdown file found; every other entry is reported as ignored and never
 *  decompressed. Throws ValidationError if the archive exceeds a guard. */
function extractZipCore(buffer: Uint8Array): ZipExtractResult {
  const ignored: IgnoredEntry[] = [];
  const readable: { path: string; body: string }[] = [];
  let entryCount = 0;
  let decompressedTotal = 0;

  const filter = (file: UnzipFileInfo): boolean => {
    entryCount++;
    if (entryCount > IMPORT_LIMITS.MAX_ZIP_ENTRIES) {
      throw new ValidationError(
        `Archive has too many entries (max ${IMPORT_LIMITS.MAX_ZIP_ENTRIES})`,
      );
    }
    const isDir = file.name.endsWith('/');
    if (isDir) return false;
    if (!READABLE_EXTENSIONS.has(extOf(file.name))) {
      ignored.push({ path: file.name, ignored: true });
      return false; // never decompressed — bytes are never read past this point
    }
    decompressedTotal += file.originalSize;
    if (decompressedTotal > IMPORT_LIMITS.MAX_DECOMPRESSED_BYTES) {
      throw new ValidationError(
        `Archive exceeds the decompressed-size limit (${IMPORT_LIMITS.MAX_DECOMPRESSED_BYTES} bytes) — possible zip bomb`,
      );
    }
    return true;
  };

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buffer, { filter });
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(`Could not read archive: ${(err as Error).message}`);
  }

  for (const [path, bytes] of Object.entries(files)) {
    readable.push({ path, body: Buffer.from(bytes).toString('utf-8') });
  }

  const skillMd = readable.find((f) => f.path.toLowerCase() === 'skill.md');
  const firstMd = readable.find((f) => extOf(f.path) === '.md');
  const core = skillMd ?? firstMd ?? readable[0];

  return { core, ignored };
}

/**
 * Parse an uploaded file into a suggested Skill payload. Never persists
 * anything — pure transform from bytes to the preview shape returned by
 * `POST /skills/import/preview`.
 */
export function buildImportPreview(filename: string, buffer: Buffer): SkillImportPreview {
  if (buffer.length > IMPORT_LIMITS.MAX_UPLOAD_BYTES) {
    throw new ValidationError(
      `Upload exceeds the size limit (${IMPORT_LIMITS.MAX_UPLOAD_BYTES} bytes)`,
    );
  }

  const ext = extOf(filename);

  if (ext === '.zip') {
    const { core, ignored } = extractZipCore(buffer);
    if (!core) {
      throw new ValidationError('No .md/.txt file found in the archive');
    }
    const front = parseFrontMatter(core.body);
    return {
      name: front.name ?? baseName(core.path),
      description: front.description ?? '',
      type: front.type ?? 'custom',
      body: core.body,
      source: 'extracted',
      evidence_files: [core.path],
      ignored,
    };
  }

  if (ext === '.md' || ext === '.txt') {
    const body = buffer.toString('utf-8');
    const front = parseFrontMatter(body);
    return {
      name: front.name ?? baseName(filename),
      description: front.description ?? '',
      type: front.type ?? 'custom',
      body,
      source: 'imported_url',
      evidence_files: [filename],
    };
  }

  throw new ValidationError('Unsupported file type — upload a .md, .txt, or .zip file');
}
