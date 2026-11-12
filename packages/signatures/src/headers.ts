import type { HeaderMap } from './types';

/** Returns the first value of a header, matching the name case-insensitively. */
export function getHeader(headers: HeaderMap, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted || value === undefined) continue;
    return typeof value === 'string' ? value : value[0];
  }
  return undefined;
}
