'use client';

import { type EndpointDto, SIGNING_SCHEMES, type SigningSchemeName } from '@hookline/shared';
import { type FormEvent, useState } from 'react';
import { errorMessage, patch, post } from '@/lib/api';
import { SCHEME_LABELS } from '@/lib/format';
import { InlineError } from './states';

const DEDUPE_HINTS: Partial<Record<SigningSchemeName, string>> = { github: 'X-GitHub-Delivery' };

interface EndpointFormProps {
  /** Present when editing. */
  endpoint?: EndpointDto;
  onSaved: (endpoint: EndpointDto) => void;
  onCancel?: () => void;
}

/** Create or edit an endpoint. Secrets are write-only: leave blank to keep the stored one. */
export function EndpointForm({ endpoint, onSaved, onCancel }: EndpointFormProps) {
  const [name, setName] = useState(endpoint?.name ?? '');
  const [scheme, setScheme] = useState<SigningSchemeName>(endpoint?.signingScheme ?? 'none');
  const [secret, setSecret] = useState('');
  const [dedupeHeader, setDedupeHeader] = useState(endpoint?.dedupeHeader ?? '');
  const [forwardInvalid, setForwardInvalid] = useState(endpoint?.forwardInvalidSignatures ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name,
      signingScheme: scheme,
      ...(scheme !== 'none' && secret ? { signingSecret: secret } : {}),
      dedupeHeader: dedupeHeader.trim() || null,
      forwardInvalidSignatures: forwardInvalid,
    };
    try {
      const saved = endpoint
        ? await patch<EndpointDto>(`/endpoints/${endpoint.id}`, body)
        : await post<EndpointDto>('/endpoints', body);
      setSecret('');
      onSaved(saved);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="form-grid"
      onSubmit={(e) => void submit(e)}
      aria-label={endpoint ? 'Edit endpoint' : 'New endpoint'}
    >
      <label className="field">
        <span>Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          placeholder="GitHub app (staging)"
        />
      </label>
      <label className="field">
        <span>Signature scheme</span>
        <select value={scheme} onChange={(e) => setScheme(e.target.value as SigningSchemeName)}>
          {SIGNING_SCHEMES.map((s) => (
            <option key={s} value={s}>
              {SCHEME_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      {scheme !== 'none' ? (
        <label className="field">
          <span>Signing secret</span>
          <input
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            required={!endpoint?.hasSigningSecret || endpoint.signingScheme === 'none'}
            placeholder={endpoint?.hasSigningSecret ? 'Leave blank to keep the current secret' : ''}
          />
        </label>
      ) : null}
      <label className="field">
        <span>Dedupe header (optional)</span>
        <input
          value={dedupeHeader}
          onChange={(e) => setDedupeHeader(e.target.value)}
          placeholder={DEDUPE_HINTS[scheme] ?? 'X-Request-Id'}
        />
      </label>
      {scheme !== 'none' ? (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={forwardInvalid}
            onChange={(e) => setForwardInvalid(e.target.checked)}
          />
          Forward requests with an invalid signature
        </label>
      ) : null}
      <InlineError message={error} />
      <div className="actions">
        {onCancel ? (
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'Saving…' : endpoint ? 'Save changes' : 'Create endpoint'}
        </button>
      </div>
    </form>
  );
}
