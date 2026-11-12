'use client';

import type { EndpointDto } from '@hookline/shared';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { CopyButton } from '@/components/copy-button';
import { DestinationsPanel } from '@/components/destinations-panel';
import { EndpointForm } from '@/components/endpoint-form';
import { LiveTail } from '@/components/live-tail';
import { ErrorState, Loading } from '@/components/states';
import { del } from '@/lib/api';
import { SCHEME_LABELS } from '@/lib/format';
import { useResource } from '@/lib/use-resource';

export default function EndpointPage() {
  const { id } = useParams<{ id: string }>();
  const endpoint = useResource<EndpointDto>(`/endpoints/${id}`);
  const [editing, setEditing] = useState(false);

  if (endpoint.state === 'loading') return <Loading label="Loading endpoint…" />;
  if (endpoint.state === 'error')
    return <ErrorState message={endpoint.error} onRetry={() => void endpoint.reload()} />;
  const e = endpoint.data;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>{e.name}</h1>
          <div className="url-cell">
            <code data-testid="ingest-url">{e.ingestUrl}</code>
            <CopyButton value={e.ingestUrl} label="Copy URL" />
          </div>
          <p className="muted small">
            Signature: {SCHEME_LABELS[e.signingScheme]}
            {e.dedupeHeader ? ` · dedupe on ${e.dedupeHeader}` : ''}
            {e.forwardInvalidSignatures ? ' · forwards invalid signatures' : ''}
          </p>
        </div>
        <div className="row-actions">
          <button type="button" className="button" onClick={() => setEditing(!editing)}>
            {editing ? 'Close settings' : 'Settings'}
          </button>
          <ConfirmButton
            tone="danger"
            label="Delete"
            title="Delete endpoint"
            description={`Delete "${e.name}" and every request, delivery and attempt stored for it? This cannot be undone.`}
            confirmLabel="Delete endpoint"
            onConfirm={async () => {
              await del(`/endpoints/${e.id}`);
              window.location.assign('/');
            }}
          />
        </div>
      </div>

      {editing ? (
        <div className="card">
          <h2>Settings</h2>
          <EndpointForm
            endpoint={e}
            onCancel={() => setEditing(false)}
            onSaved={(saved) => {
              endpoint.setData(saved);
              setEditing(false);
            }}
          />
        </div>
      ) : null}

      <div className="endpoint-layout">
        <LiveTail endpointId={e.id} ingestUrl={e.ingestUrl} />
        <DestinationsPanel
          endpointId={e.id}
          destinations={e.destinations}
          onChange={() => void endpoint.reload()}
        />
      </div>
    </section>
  );
}
