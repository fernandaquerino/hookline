'use client';

import type { DeliveryDetailDto } from '@hookline/shared';
import { post } from '@/lib/api';
import { formatTime, relativeTime } from '@/lib/format';
import { DeliveryBadge, HttpStatus } from './badges';
import { ConfirmButton } from './confirm-button';

const REPLAYABLE = new Set(['SUCCEEDED', 'DEAD']);

export function DeliveryTimeline({
  delivery,
  onReplayed,
}: {
  delivery: DeliveryDetailDto;
  onReplayed: () => void;
}) {
  return (
    <li className="delivery" data-testid="delivery">
      <div className="delivery-header">
        <DeliveryBadge status={delivery.status} />
        <code className="grow">{delivery.destinationUrl}</code>
        {delivery.replayOfId ? <span className="badge neutral">Replay</span> : null}
        <ConfirmButton
          small
          label="Replay"
          title="Replay delivery"
          description={
            <>
              Send this request to <code>{delivery.destinationUrl}</code> again as a new delivery.
              The attempts below are kept as they are.
            </>
          }
          confirmLabel="Replay"
          disabled={!REPLAYABLE.has(delivery.status)}
          onConfirm={async () => {
            await post(`/deliveries/${delivery.id}/replay`);
            onReplayed();
          }}
        />
      </div>
      {delivery.status === 'FAILED_RETRYING' && delivery.nextAttemptAt ? (
        <p className="muted small">
          Next attempt {new Date(delivery.nextAttemptAt).toLocaleTimeString()}
        </p>
      ) : null}
      {delivery.attempts.length === 0 ? (
        <p className="muted small">No attempts yet.</p>
      ) : (
        <ol className="attempts">
          {delivery.attempts.map((attempt) => (
            <li key={attempt.id} data-testid="attempt">
              <span className="attempt-number">#{attempt.attemptNumber}</span>
              <span className="time" title={attempt.startedAt}>
                {formatTime(attempt.startedAt)}
              </span>
              <HttpStatus status={attempt.responseStatus} />
              <span className="muted small">
                {attempt.durationMs !== null ? `${attempt.durationMs} ms` : ''}
              </span>
              {attempt.error ? <span className="attempt-error">{attempt.error}</span> : null}
              {attempt.responseBodySnippet ? (
                <details className="snippet">
                  <summary>Response body</summary>
                  <pre className="code">{attempt.responseBodySnippet}</pre>
                </details>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">Created {relativeTime(delivery.createdAt)}</p>
    </li>
  );
}
