'use client';

import type { LiveEvent, RequestDetailDto } from '@hookline/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { SignatureBadge } from '@/components/badges';
import { BodyViewer } from '@/components/body-viewer';
import { ConfirmButton } from '@/components/confirm-button';
import { DeliveryTimeline } from '@/components/delivery-timeline';
import { ErrorState, Loading } from '@/components/states';
import { post } from '@/lib/api';
import { SCHEME_LABELS } from '@/lib/format';
import { useResource } from '@/lib/use-resource';

const SIGNATURE_HELP: Record<string, string> = {
  valid: 'The signature matched the configured secret.',
  invalid:
    'The signature was missing or did not match. The request was stored but not forwarded unless the endpoint allows it.',
  not_configured: 'This endpoint does not verify signatures.',
};

export default function RequestPage() {
  const { id } = useParams<{ id: string }>();
  const request = useResource<RequestDetailDto>(`/requests/${id}`);
  const endpointId = request.data?.endpoint.id;
  const reloadRef = useRef(request.reload);
  reloadRef.current = request.reload;

  // Refresh the timeline whenever one of this request's deliveries changes.
  useEffect(() => {
    if (!endpointId) return;
    const source = new EventSource(`/api/endpoints/${endpointId}/stream`);
    source.addEventListener('delivery.updated', (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as LiveEvent;
      if (event.type === 'delivery.updated' && event.requestId === id) void reloadRef.current();
    });
    return () => source.close();
  }, [endpointId, id]);

  if (request.state === 'loading') return <Loading label="Loading request…" />;
  if (request.state === 'error')
    return <ErrorState message={request.error} onRetry={() => void request.reload()} />;
  const r = request.data;
  const headerEntries = Object.entries(r.headers).sort(([a], [b]) => a.localeCompare(b));

  return (
    <section>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href={`/endpoints/${r.endpoint.id}`}>{r.endpoint.name}</Link> / request
      </nav>
      <div className="page-header">
        <div>
          <h1>
            <span className="method">{r.method}</span> {r.path}
            {r.query ? <span className="muted">?{r.query}</span> : null}
          </h1>
          <p className="muted small">
            Received {new Date(r.receivedAt).toLocaleString()} · <code>{r.id}</code>
            {r.dedupeKey ? (
              <>
                {' '}
                · dedupe key <code>{r.dedupeKey}</code>
              </>
            ) : null}
          </p>
        </div>
        <ConfirmButton
          label="Replay to all destinations"
          title="Replay request"
          description="Create a new delivery of this request to every enabled destination of the endpoint. Earlier deliveries are not changed."
          confirmLabel="Replay"
          onConfirm={async () => {
            await post(`/endpoints/${r.endpoint.id}/requests/${r.id}/replay`);
            await request.reload();
          }}
        />
      </div>

      <div className="inspector">
        <div className="stack">
          <div className="card">
            <div className="card-header">
              <h2>Signature</h2>
              <SignatureBadge status={r.signatureStatus} />
            </div>
            <p className="muted">
              Scheme: {SCHEME_LABELS[r.endpoint.signingScheme]}. {SIGNATURE_HELP[r.signatureStatus]}
            </p>
          </div>
          <div className="card">
            <h2>Headers</h2>
            <table className="table compact headers">
              <tbody>
                {headerEntries.map(([name, value]) => (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    <td>
                      <code className={value === '[redacted]' ? 'redacted' : undefined}>
                        {value}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <BodyViewer base64={r.bodyBase64} contentType={r.contentType} size={r.sizeBytes} />
        </div>
        <div className="card">
          <h2>Deliveries</h2>
          {r.deliveries.length === 0 ? (
            <p className="muted">
              {r.signatureStatus === 'invalid'
                ? 'Not forwarded because the signature is invalid. You can still replay it manually.'
                : 'This request was not forwarded: the endpoint had no enabled destinations.'}
            </p>
          ) : (
            <ol className="deliveries-list">
              {r.deliveries.map((d) => (
                <DeliveryTimeline
                  key={d.id}
                  delivery={d}
                  onReplayed={() => void request.reload()}
                />
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
