'use client';

import type { LiveEvent, Page, RequestSummaryDto } from '@hookline/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from './api';
import { type TailFilters, applyLiveEvent, matchesFilters, mergeFirstPage } from './live-tail';

/** `offline` means several reconnects failed in a row; the hook keeps trying in the background. */
export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';
export type LoadState = 'loading' | 'ready' | 'error';

const RECONNECT_MS = 3_000;
const OFFLINE_AFTER_FAILURES = 3;

function query(filters: TailFilters, cursor?: string): string {
  const params = new URLSearchParams({ limit: '50' });
  if (filters.signatureStatus) params.set('signatureStatus', filters.signatureStatus);
  if (filters.deliveryStatus) params.set('deliveryStatus', filters.deliveryStatus);
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}

/**
 * The endpoint page's live tail: loads the newest requests, then keeps them current from the SSE
 * stream. After a reconnect the first page is fetched again so nothing missed while offline is lost.
 */
export function useLiveTail(endpointId: string, filters: TailFilters) {
  const [requests, setRequests] = useState<RequestSummaryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const loadFirstPage = useCallback(
    async (mode: 'replace' | 'merge') => {
      if (mode === 'replace') setLoadState('loading');
      try {
        const page = await api<Page<RequestSummaryDto>>(
          `/endpoints/${endpointId}/requests?${query(filtersRef.current)}`,
        );
        setRequests((current) =>
          mode === 'replace' ? page.items : mergeFirstPage(current, page.items),
        );
        if (mode === 'replace') setNextCursor(page.nextCursor);
        setLoadState('ready');
        setLoadError(null);
      } catch (error) {
        if (mode === 'replace') {
          setLoadState('error');
          setLoadError(errorMessage(error));
        }
      }
    },
    [endpointId],
  );

  useEffect(() => {
    void loadFirstPage('replace');
  }, [loadFirstPage, filters.signatureStatus, filters.deliveryStatus]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let connectedBefore = false;
    let disposed = false;

    const connect = () => {
      source = new EventSource(`/api/endpoints/${endpointId}/stream`);
      source.addEventListener('ready', () => {
        failures = 0;
        setConnection('live');
        if (connectedBefore) void loadFirstPage('merge');
        connectedBefore = true;
      });
      const onLive = (message: MessageEvent<string>) => {
        const event = JSON.parse(message.data) as LiveEvent;
        setRequests((current) => applyLiveEvent(current, event));
      };
      source.addEventListener('request.received', onLive);
      source.addEventListener('delivery.updated', onLive);
      source.onerror = () => {
        if (disposed || !source) return;
        if (source.readyState === EventSource.CLOSED) {
          // The browser gave up (non-200 answer, e.g. the API is down): retry ourselves.
          source.close();
          failures++;
          setConnection(failures >= OFFLINE_AFTER_FAILURES ? 'offline' : 'reconnecting');
          retryTimer = setTimeout(connect, RECONNECT_MS);
        } else {
          setConnection('reconnecting');
        }
      };
    };

    setConnection('connecting');
    connect();
    return () => {
      disposed = true;
      source?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [endpointId, loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await api<Page<RequestSummaryDto>>(
        `/endpoints/${endpointId}/requests?${query(filtersRef.current, nextCursor)}`,
      );
      setRequests((current) => [
        ...current,
        ...page.items.filter((r) => !current.some((c) => c.id === r.id)),
      ]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }, [endpointId, nextCursor]);

  const visible = useMemo(
    () => requests.filter((r) => matchesFilters(r, filters)),
    [requests, filters],
  );

  return {
    requests: visible,
    loadState,
    loadError,
    connection,
    hasMore: nextCursor !== null,
    loadingMore,
    loadMore,
    reload: () => loadFirstPage('replace'),
  };
}
