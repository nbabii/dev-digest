import { DEFAULT_API_URL } from './constants.js';

export interface ResolvedApiUrl {
  url: string;
  warnNonLoopback: boolean;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Pure: reads DEVDIGEST_API_URL, accepts only http(s), strips trailing slashes. Throws on invalid input. */
export function resolveApiUrl(env: Record<string, string | undefined>): ResolvedApiUrl {
  const raw = env['DEVDIGEST_API_URL']?.trim() || DEFAULT_API_URL;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`DEVDIGEST_API_URL is not a valid URL: ${JSON.stringify(raw)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`DEVDIGEST_API_URL must use http: or https: (got ${parsed.protocol})`);
  }

  const url = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  return { url, warnNonLoopback: !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) };
}
