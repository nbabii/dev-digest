import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  assertHttpsAndNotBlocked,
  fetchAsText,
  buildUrlImportPreview,
} from '../src/modules/skills/url-import.js';
import { ValidationError, ExternalServiceError } from '../src/platform/errors.js';
import { IMPORT_LIMITS } from '../src/modules/skills/import-parser.js';

/**
 * Unit coverage for the URL-fetch import guards — see
 * server/specs/skill-url-import.md for the design these enforce.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockResponse(init: {
  status?: number;
  body?: string;
  ok?: boolean;
  headers?: Record<string, string>;
}): Response {
  const status = init.status ?? 200;
  const bodyText = init.body ?? '';
  const encoder = new TextEncoder();
  const bytes = encoder.encode(bodyText);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return {
    status,
    ok: init.ok ?? (status >= 200 && status < 300),
    statusText: `status ${status}`,
    body: stream,
  } as unknown as Response;
}

describe('assertHttpsAndNotBlocked', () => {
  it('accepts an ordinary https URL', () => {
    const parsed = assertHttpsAndNotBlocked('https://raw.githubusercontent.com/org/repo/main/skill.md');
    expect(parsed.hostname).toBe('raw.githubusercontent.com');
  });

  it('rejects a malformed URL', () => {
    expect(() => assertHttpsAndNotBlocked('not a url')).toThrow(ValidationError);
  });

  it('rejects a non-https protocol', () => {
    expect(() => assertHttpsAndNotBlocked('http://example.com/skill.md')).toThrow(ValidationError);
  });

  it.each([
    'https://localhost/skill.md',
    'https://127.0.0.1/skill.md',
    'https://10.0.0.5/skill.md',
    'https://172.16.0.1/skill.md',
    'https://192.168.1.1/skill.md',
    'https://169.254.169.254/latest/meta-data/',
    'https://foo.local/skill.md',
    'https://[::1]/skill.md',
  ])('rejects a blocked host: %s', (url) => {
    expect(() => assertHttpsAndNotBlocked(url)).toThrow(ValidationError);
  });

  it('does not block an ordinary public-looking domain that merely contains a blocked substring', () => {
    // e.g. "10.example.com" must not match the "^10\." RFC1918 pattern.
    expect(() => assertHttpsAndNotBlocked('https://10.example.com/skill.md')).not.toThrow();
  });
});

describe('fetchAsText', () => {
  it('returns the body text on a plain 200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ body: '# hello' })));
    await expect(fetchAsText('https://example.com/skill.md')).resolves.toBe('# hello');
  });

  it('refuses a redirect instead of following it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ status: 302 })));
    await expect(fetchAsText('https://example.com/skill.md')).rejects.toThrow(ExternalServiceError);
  });

  it('rejects a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ status: 404, ok: false })));
    await expect(fetchAsText('https://example.com/skill.md')).rejects.toThrow(ExternalServiceError);
  });

  it('rejects a response over the size cap, based on bytes actually read', async () => {
    const oversized = 'a'.repeat(IMPORT_LIMITS.MAX_UPLOAD_BYTES + 1);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ body: oversized })));
    await expect(fetchAsText('https://example.com/skill.md')).rejects.toThrow(ValidationError);
  });

  it('rejects binary-looking content (a NUL byte)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockResponse({ body: 'abc\0def' })),
    );
    await expect(fetchAsText('https://example.com/skill.md')).rejects.toThrow(ValidationError);
  });
});

describe('buildUrlImportPreview', () => {
  it('derives name/description/type from front-matter and forces source: imported_url', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse({ body: 'name: my-skill\ndescription: does a thing\ntype: convention\n\n# Body\ntext' }),
      ),
    );
    const preview = await buildUrlImportPreview('https://raw.githubusercontent.com/org/repo/main/skill.md');
    expect(preview).toEqual({
      name: 'my-skill',
      description: 'does a thing',
      type: 'convention',
      body: 'name: my-skill\ndescription: does a thing\ntype: convention\n\n# Body\ntext',
      source: 'imported_url',
      evidence_files: ['https://raw.githubusercontent.com/org/repo/main/skill.md'],
    });
  });

  it('falls back to the URL path basename when front-matter has no name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ body: '# Just a heading' })));
    const preview = await buildUrlImportPreview('https://raw.githubusercontent.com/org/repo/main/security.md');
    expect(preview.name).toBe('security');
    expect(preview.type).toBe('custom');
  });

  it('rejects a blocked URL before ever calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(buildUrlImportPreview('https://localhost/skill.md')).rejects.toThrow(ValidationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
