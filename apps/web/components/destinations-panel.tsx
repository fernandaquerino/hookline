'use client';

import { DESTINATION_LIMITS, type DestinationDto } from '@hookline/shared';
import { type FormEvent, useState } from 'react';
import { del, errorMessage, patch, post } from '@/lib/api';
import { ConfirmButton } from './confirm-button';
import { InlineError } from './states';

interface Props {
  endpointId: string;
  destinations: DestinationDto[];
  onChange: () => void;
}

export function DestinationsPanel({ endpointId, destinations, onChange }: Props) {
  const [url, setUrl] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(String(DESTINATION_LIMITS.timeoutMs.default));
  const [maxAttempts, setMaxAttempts] = useState(String(DESTINATION_LIMITS.maxAttempts.default));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/endpoints/${endpointId}/destinations`, {
        url: url.trim(),
        timeoutMs: Number(timeoutMs),
        maxAttempts: Number(maxAttempts),
      });
      setUrl('');
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (destination: DestinationDto) => {
    setError(null);
    try {
      await patch(`/endpoints/${endpointId}/destinations/${destination.id}`, {
        enabled: !destination.enabled,
      });
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="card">
      <h2>Destinations</h2>
      {destinations.length === 0 ? (
        <p className="muted">No destinations yet. Requests are stored but not forwarded.</p>
      ) : (
        <ul className="destination-list">
          {destinations.map((d) => (
            <li key={d.id} className={d.enabled ? undefined : 'disabled'} data-testid="destination">
              <div>
                <code>{d.url}</code>
                <div className="muted small">
                  timeout {d.timeoutMs} ms · up to {d.maxAttempts} attempts
                  {d.enabled ? '' : ' · disabled'}
                </div>
              </div>
              <div className="row-actions">
                <button type="button" className="button small" onClick={() => void toggle(d)}>
                  {d.enabled ? 'Disable' : 'Enable'}
                </button>
                <ConfirmButton
                  small
                  tone="danger"
                  label="Remove"
                  title="Remove destination"
                  description={
                    <>
                      Remove <code>{d.url}</code>? Its delivery history is deleted too.
                    </>
                  }
                  confirmLabel="Remove"
                  onConfirm={async () => {
                    await del(`/endpoints/${endpointId}/destinations/${d.id}`);
                    onChange();
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="destination-form" onSubmit={(e) => void add(e)} aria-label="Add destination">
        <label className="field grow">
          <span>Destination URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:3000/webhooks"
            required
          />
        </label>
        <label className="field narrow">
          <span>Timeout (ms)</span>
          <input
            type="number"
            min={DESTINATION_LIMITS.timeoutMs.min}
            max={DESTINATION_LIMITS.timeoutMs.max}
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(e.target.value)}
          />
        </label>
        <label className="field narrow">
          <span>Max attempts</span>
          <input
            type="number"
            min={DESTINATION_LIMITS.maxAttempts.min}
            max={DESTINATION_LIMITS.maxAttempts.max}
            value={maxAttempts}
            onChange={(e) => setMaxAttempts(e.target.value)}
          />
        </label>
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add destination'}
        </button>
      </form>
      <InlineError message={error} />
    </div>
  );
}
