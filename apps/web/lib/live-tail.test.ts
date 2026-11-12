import type { DeliverySummaryDto, RequestSummaryDto } from '@hookline/shared';
import { describe, expect, it } from 'vitest';
import { applyLiveEvent, matchesFilters, mergeFirstPage } from './live-tail';

const delivery = (overrides: Partial<DeliverySummaryDto> = {}): DeliverySummaryDto => ({
  id: 'd1',
  destinationId: 'dest',
  status: 'PENDING',
  attemptCount: 0,
  nextAttemptAt: null,
  replayOfId: null,
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const request = (id: string, overrides: Partial<RequestSummaryDto> = {}): RequestSummaryDto => ({
  id,
  endpointId: 'e',
  method: 'POST',
  contentType: 'application/json',
  sizeBytes: 2,
  signatureStatus: 'valid',
  receivedAt: '2026-01-01T00:00:00Z',
  deliveries: [delivery()],
  ...overrides,
});

describe('applyLiveEvent', () => {
  it('prepends new requests once', () => {
    const list = [request('a')];
    const event = { type: 'request.received' as const, endpointId: 'e', request: request('b') };
    const next = applyLiveEvent(list, event);
    expect(next.map((r) => r.id)).toEqual(['b', 'a']);
    expect(applyLiveEvent(next, event)).toBe(next);
  });

  it('updates and adds deliveries, ignoring stale updates', () => {
    const list = [request('a')];
    const update = (d: DeliverySummaryDto) =>
      ({ type: 'delivery.updated', endpointId: 'e', requestId: 'a', delivery: d }) as const;
    let next = applyLiveEvent(
      list,
      update(delivery({ status: 'FAILED_RETRYING', attemptCount: 2 })),
    );
    expect(next[0]?.deliveries[0]).toMatchObject({ status: 'FAILED_RETRYING', attemptCount: 2 });
    next = applyLiveEvent(next, update(delivery({ status: 'IN_FLIGHT', attemptCount: 1 })));
    expect(next[0]?.deliveries[0]?.attemptCount).toBe(2);
    next = applyLiveEvent(next, update(delivery({ id: 'd2' })));
    expect(next[0]?.deliveries).toHaveLength(2);
  });
});

describe('matchesFilters', () => {
  it('filters by signature and delivery status', () => {
    const r = request('a', {
      signatureStatus: 'invalid',
      deliveries: [delivery({ status: 'DEAD' })],
    });
    expect(matchesFilters(r, { signatureStatus: '', deliveryStatus: '' })).toBe(true);
    expect(matchesFilters(r, { signatureStatus: 'valid', deliveryStatus: '' })).toBe(false);
    expect(matchesFilters(r, { signatureStatus: '', deliveryStatus: 'DEAD' })).toBe(true);
    expect(matchesFilters(r, { signatureStatus: '', deliveryStatus: 'SUCCEEDED' })).toBe(false);
  });
});

describe('mergeFirstPage', () => {
  it('puts fresh items first and keeps older ones without duplicates', () => {
    const merged = mergeFirstPage([request('b'), request('a')], [request('c'), request('b')]);
    expect(merged.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
});
