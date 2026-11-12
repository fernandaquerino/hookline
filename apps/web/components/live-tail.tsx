'use client';

import {
  DELIVERY_STATUSES,
  type DeliveryStatusName,
  SIGNATURE_STATUSES,
  type SignatureStatusName,
} from '@hookline/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { TailFilters } from '@/lib/live-tail';
import { formatBytes, formatTime } from '@/lib/format';
import { type ConnectionState, useLiveTail } from '@/lib/use-live-tail';
import { DeliveryBadge, SignatureBadge } from './badges';
import { Empty, ErrorState, InlineError, Loading } from './states';

const CONNECTION_TEXT: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  offline: 'Offline, retrying',
};

function ConnectionIndicator({ state }: { state: ConnectionState }) {
  return (
    <span
      className={`connection ${state}`}
      role="status"
      aria-live="polite"
      data-testid="live-status"
    >
      <span className="dot" aria-hidden="true" />
      {CONNECTION_TEXT[state]}
    </span>
  );
}

/** Forces a re-render every few seconds so relative values stay fresh. */
function useTick(ms: number): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function LiveTail({ endpointId, ingestUrl }: { endpointId: string; ingestUrl: string }) {
  const [filters, setFilters] = useState<TailFilters>({ signatureStatus: '', deliveryStatus: '' });
  const tail = useLiveTail(endpointId, filters);
  useTick(10_000);

  return (
    <div className="card">
      <div className="card-header">
        <h2>Live tail</h2>
        <ConnectionIndicator state={tail.connection} />
      </div>
      {tail.connection === 'offline' || tail.connection === 'reconnecting' ? (
        <p className="banner warning" role="status">
          Lost the live connection. New requests will appear once it is back; the list is refreshed
          on reconnect.
        </p>
      ) : null}
      <div className="filters">
        <label className="field inline">
          <span>Signature</span>
          <select
            value={filters.signatureStatus}
            onChange={(e) =>
              setFilters({
                ...filters,
                signatureStatus: e.target.value as SignatureStatusName | '',
              })
            }
          >
            <option value="">Any</option>
            {SIGNATURE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>Delivery</span>
          <select
            value={filters.deliveryStatus}
            onChange={(e) =>
              setFilters({ ...filters, deliveryStatus: e.target.value as DeliveryStatusName | '' })
            }
          >
            <option value="">Any</option>
            {DELIVERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tail.loadState === 'loading' ? <Loading label="Loading requests…" /> : null}
      {tail.loadState === 'error' ? (
        <ErrorState message={tail.loadError ?? ''} onRetry={() => void tail.reload()} />
      ) : null}
      {tail.loadState === 'ready' && tail.requests.length === 0 ? (
        filters.signatureStatus || filters.deliveryStatus ? (
          <Empty title="No requests match these filters" />
        ) : (
          <Empty title="Waiting for the first request">
            Send one with:
            <pre className="code">{`curl -X POST ${ingestUrl} \\\n  -H 'Content-Type: application/json' \\\n  -d '{"hello":"world"}'`}</pre>
          </Empty>
        )
      ) : null}

      {tail.loadState === 'ready' && tail.requests.length > 0 ? (
        <ol className="tail" aria-label="Requests">
          {tail.requests.map((request) => (
            <li key={request.id} data-testid="tail-row">
              <Link href={`/requests/${request.id}`} className="tail-row">
                <span className="time" title={request.receivedAt}>
                  {formatTime(request.receivedAt)}
                </span>
                <span className="method">{request.method}</span>
                <span className="muted small">
                  {request.contentType ?? 'no content type'} · {formatBytes(request.sizeBytes)}
                </span>
                <SignatureBadge status={request.signatureStatus} />
                <span className="deliveries">
                  {request.deliveries.length === 0 ? (
                    <span className="muted small">not forwarded</span>
                  ) : (
                    request.deliveries.map((d) => (
                      <span key={d.id} title={`attempt ${d.attemptCount}`}>
                        <DeliveryBadge status={d.status} />
                      </span>
                    ))
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
      <InlineError message={tail.loadState === 'ready' ? tail.loadError : null} />
      {tail.hasMore ? (
        <button
          type="button"
          className="button"
          disabled={tail.loadingMore}
          onClick={() => void tail.loadMore()}
        >
          {tail.loadingMore ? 'Loading…' : 'Load older requests'}
        </button>
      ) : null}
    </div>
  );
}
