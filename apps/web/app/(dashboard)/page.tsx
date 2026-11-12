'use client';

import type { EndpointDto } from '@hookline/shared';
import Link from 'next/link';
import { useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { EndpointForm } from '@/components/endpoint-form';
import { Empty, ErrorState, Loading } from '@/components/states';
import { SCHEME_LABELS, relativeTime } from '@/lib/format';
import { useResource } from '@/lib/use-resource';

export default function EndpointsPage() {
  const endpoints = useResource<EndpointDto[]>('/endpoints');
  const [creating, setCreating] = useState(false);

  return (
    <section>
      <div className="page-header">
        <h1>Endpoints</h1>
        {!creating ? (
          <button type="button" className="button primary" onClick={() => setCreating(true)}>
            New endpoint
          </button>
        ) : null}
      </div>

      {creating ? (
        <div className="card">
          <h2>New endpoint</h2>
          <EndpointForm
            onCancel={() => setCreating(false)}
            onSaved={(endpoint) => {
              setCreating(false);
              window.location.assign(`/endpoints/${endpoint.id}`);
            }}
          />
        </div>
      ) : null}

      {endpoints.state === 'loading' ? <Loading label="Loading endpoints…" /> : null}
      {endpoints.state === 'error' ? (
        <ErrorState message={endpoints.error} onRetry={() => void endpoints.reload()} />
      ) : null}
      {endpoints.state === 'ready' && endpoints.data.length === 0 && !creating ? (
        <Empty title="No endpoints yet">
          Create an endpoint, then point a webhook provider at its ingest URL.
        </Empty>
      ) : null}
      {endpoints.state === 'ready' && endpoints.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Ingest URL</th>
                <th>Signature</th>
                <th>Destinations</th>
                <th>Last request</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.data.map((endpoint) => (
                <tr key={endpoint.id}>
                  <td>
                    <Link href={`/endpoints/${endpoint.id}`} className="strong-link">
                      {endpoint.name}
                    </Link>
                  </td>
                  <td>
                    <div className="url-cell">
                      <code>{endpoint.ingestUrl}</code>
                      <CopyButton value={endpoint.ingestUrl} />
                    </div>
                  </td>
                  <td>{SCHEME_LABELS[endpoint.signingScheme]}</td>
                  <td>{endpoint.destinations.filter((d) => d.enabled).length}</td>
                  <td title={endpoint.lastRequestAt ?? undefined}>
                    {relativeTime(endpoint.lastRequestAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
