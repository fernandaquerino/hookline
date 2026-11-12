'use client';

import { useMemo, useState } from 'react';
import { formatBytes, viewBody } from '@/lib/format';

type Mode = 'pretty' | 'raw';

export function BodyViewer({
  base64,
  contentType,
  size,
}: {
  base64: string;
  contentType: string | null;
  size: number;
}) {
  const view = useMemo(() => viewBody(base64, contentType), [base64, contentType]);
  const [mode, setMode] = useState<Mode>('pretty');
  const canToggle = view.kind === 'json' || view.kind === 'form';

  return (
    <div className="card">
      <div className="card-header">
        <h2>Body</h2>
        <span className="muted small">
          {contentType ?? 'no content type'} · {formatBytes(size)}
        </span>
        {canToggle ? (
          <div className="segmented" role="tablist" aria-label="Body view">
            {(['pretty', 'raw'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={mode === m ? 'active' : undefined}
                onClick={() => setMode(m)}
              >
                {m === 'pretty' ? (view.kind === 'json' ? 'JSON' : 'Form') : 'Raw'}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {view.kind === 'empty' ? <p className="muted">Empty body.</p> : null}
      {view.kind === 'json' ? (
        <pre className="code" data-testid="body">
          {mode === 'pretty' ? view.pretty : view.raw}
        </pre>
      ) : null}
      {view.kind === 'form' && mode === 'pretty' ? (
        <table className="table compact" data-testid="body">
          <tbody>
            {view.entries.map(([key, value], i) => (
              <tr key={`${key}-${i}`}>
                <th scope="row">{key}</th>
                <td>
                  <code>{value}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {view.kind === 'form' && mode === 'raw' ? <pre className="code">{view.raw}</pre> : null}
      {view.kind === 'text' ? (
        <pre className="code" data-testid="body">
          {view.raw}
        </pre>
      ) : null}
      {view.kind === 'binary' ? (
        <>
          <p className="muted small">Binary body, shown as hex.</p>
          <pre className="code">{view.hex}</pre>
        </>
      ) : null}
    </div>
  );
}
