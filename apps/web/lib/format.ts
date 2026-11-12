export type BodyView =
  | { kind: 'empty' }
  | { kind: 'json'; pretty: string; raw: string }
  | { kind: 'form'; entries: Array<[string, string]>; raw: string }
  | { kind: 'text'; raw: string }
  | { kind: 'binary'; hex: string; size: number };

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hexDump(bytes: Uint8Array, limit = 4096): string {
  const lines: string[] = [];
  for (let offset = 0; offset < Math.min(bytes.length, limit); offset += 16) {
    const row = Array.from(bytes.subarray(offset, offset + 16));
    const hex = row.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = row.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  if (bytes.length > limit) lines.push(`… ${bytes.length - limit} more bytes`);
  return lines.join('\n');
}

/** Decides how to show a stored body: pretty JSON, a form table, text, or a hex dump. */
export function viewBody(base64: string, contentType: string | null): BodyView {
  const bytes = decodeBase64(base64);
  if (bytes.length === 0) return { kind: 'empty' };

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { kind: 'binary', hex: hexDump(bytes), size: bytes.length };
  }

  const type = (contentType ?? '').toLowerCase();
  const looksJson = /^\s*[[{]/.test(text);
  if (type.includes('json') || looksJson) {
    try {
      return { kind: 'json', pretty: JSON.stringify(JSON.parse(text), null, 2), raw: text };
    } catch {
      // Claimed to be JSON but is not; show it as text.
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    return { kind: 'form', entries: Array.from(new URLSearchParams(text).entries()), raw: text };
  }
  return { kind: 'text', raw: text };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "just now", "5 s ago", "3 min ago", "2 h ago", then a date. */
export function relativeTime(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return 'never';
  const diff = Math.round((nowMs - Date.parse(iso)) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff} s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)} h ago`;
  return new Date(iso).toLocaleString();
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour12: false });
}

export const SCHEME_LABELS: Record<string, string> = {
  none: 'None',
  generic_sha256: 'HMAC SHA-256',
  github: 'GitHub',
  stripe: 'Stripe',
};
