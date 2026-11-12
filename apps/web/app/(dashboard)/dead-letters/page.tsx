'use client';

import {
  BULK_REPLAY_MAX,
  type BulkReplayResultDto,
  type DeadLetterDto,
  type Page,
} from '@hookline/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { HttpStatus } from '@/components/badges';
import { ConfirmButton } from '@/components/confirm-button';
import { Empty, ErrorState, InlineError, Loading } from '@/components/states';
import { api, errorMessage, post } from '@/lib/api';
import { relativeTime } from '@/lib/format';

export default function DeadLettersPage() {
  const [items, setItems] = useState<DeadLetterDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async (after?: string) => {
    if (!after) setState('loading');
    try {
      const page = await api<Page<DeadLetterDto>>(
        `/deliveries?status=DEAD${after ? `&cursor=${after}` : ''}`,
      );
      setItems((current) => (after ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setState('ready');
    } catch (e) {
      setError(errorMessage(e));
      if (!after) setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < BULK_REPLAY_MAX) next.add(id);
      return next;
    });

  const pending = items.filter((d) => !d.replayed);
  const allSelected = pending.length > 0 && pending.every((d) => selected.has(d.id));

  const replaySelected = async () => {
    const outcome = await post<BulkReplayResultDto>('/deliveries/replay', {
      deliveryIds: [...selected],
    });
    setResult(
      `Replayed ${outcome.replayed.length} deliver${outcome.replayed.length === 1 ? 'y' : 'ies'}` +
        (outcome.skipped.length
          ? `, skipped ${outcome.skipped.length}: ${outcome.skipped.map((s) => s.message).join('; ')}`
          : '.'),
    );
    setSelected(new Set());
    await load();
  };

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Dead letters</h1>
          <p className="muted">Deliveries that ran out of attempts or failed with a final error.</p>
        </div>
        <ConfirmButton
          label={`Replay selected (${selected.size})`}
          title="Replay deliveries"
          description={`Create a new delivery for each of the ${selected.size} selected dead letters. The dead deliveries stay in the history.`}
          confirmLabel="Replay"
          disabled={selected.size === 0}
          onConfirm={replaySelected}
        />
      </div>
      {result ? (
        <p className="banner success" role="status">
          {result}
        </p>
      ) : null}
      {state === 'loading' ? <Loading label="Loading dead letters…" /> : null}
      {state === 'error' ? <ErrorState message={error ?? ''} onRetry={() => void load()} /> : null}
      {state === 'ready' && items.length === 0 ? (
        <Empty title="No dead letters">
          Every delivery either succeeded or is still being retried.
        </Empty>
      ) : null}
      {state === 'ready' && items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(
                        allSelected
                          ? new Set()
                          : new Set(pending.slice(0, BULK_REPLAY_MAX).map((d) => d.id)),
                      )
                    }
                  />
                </th>
                <th>Endpoint</th>
                <th>Destination</th>
                <th>Last result</th>
                <th>Attempts</th>
                <th>Received</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} data-testid="dead-letter">
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select delivery ${d.id}`}
                      checked={selected.has(d.id)}
                      onChange={() => toggle(d.id)}
                    />
                  </td>
                  <td>{d.endpoint.name}</td>
                  <td>
                    <code>{d.destinationUrl}</code>
                  </td>
                  <td>
                    {d.lastResponseStatus !== null || d.lastError === null ? (
                      <HttpStatus status={d.lastResponseStatus} />
                    ) : null}
                    {d.lastError ? <div className="attempt-error small">{d.lastError}</div> : null}
                  </td>
                  <td>{d.attemptCount}</td>
                  <td title={d.request.receivedAt}>{relativeTime(d.request.receivedAt)}</td>
                  <td>
                    <Link href={`/requests/${d.request.id}`}>Inspect</Link>
                    {d.replayed ? <span className="badge neutral">Replayed</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <InlineError message={state === 'ready' ? error : null} />
      {cursor ? (
        <button type="button" className="button" onClick={() => void load(cursor)}>
          Load more
        </button>
      ) : null}
    </section>
  );
}
