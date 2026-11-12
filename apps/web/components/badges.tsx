import type { DeliveryStatusName, SignatureStatusName } from '@hookline/shared';

const DELIVERY_LABELS: Record<DeliveryStatusName, string> = {
  PENDING: 'Pending',
  IN_FLIGHT: 'In flight',
  SUCCEEDED: 'Succeeded',
  FAILED_RETRYING: 'Retrying',
  DEAD: 'Dead',
};

const DELIVERY_TONES: Record<DeliveryStatusName, string> = {
  PENDING: 'neutral',
  IN_FLIGHT: 'info',
  SUCCEEDED: 'success',
  FAILED_RETRYING: 'warning',
  DEAD: 'danger',
};

export function DeliveryBadge({ status }: { status: DeliveryStatusName }) {
  return (
    <span className={`badge ${DELIVERY_TONES[status]}`} data-status={status}>
      {DELIVERY_LABELS[status]}
    </span>
  );
}

const SIGNATURE_LABELS: Record<SignatureStatusName, string> = {
  valid: 'Signature valid',
  invalid: 'Signature invalid',
  not_configured: 'Unsigned',
};

const SIGNATURE_TONES: Record<SignatureStatusName, string> = {
  valid: 'success',
  invalid: 'danger',
  not_configured: 'neutral',
};

export function SignatureBadge({ status }: { status: SignatureStatusName }) {
  return <span className={`badge ${SIGNATURE_TONES[status]}`}>{SIGNATURE_LABELS[status]}</span>;
}

export function HttpStatus({ status }: { status: number | null }) {
  if (status === null) return <span className="badge danger">No response</span>;
  const tone =
    status < 300
      ? 'success'
      : status < 500 && status !== 408 && status !== 429
        ? 'danger'
        : 'warning';
  return <span className={`badge ${tone}`}>HTTP {status}</span>;
}
