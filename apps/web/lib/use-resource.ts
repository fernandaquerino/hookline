'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from './api';

export type Resource<T> =
  | { state: 'loading'; data?: undefined; error?: undefined }
  | { state: 'ready'; data: T; error?: undefined }
  | { state: 'error'; data?: undefined; error: string };

/** Loads one API resource with loading and error states, and a reload function. */
export function useResource<T>(path: string | null) {
  const [resource, setResource] = useState<Resource<T>>({ state: 'loading' });

  const load = useCallback(
    async (quiet = false) => {
      if (!path) return;
      if (!quiet) setResource({ state: 'loading' });
      try {
        setResource({ state: 'ready', data: await api<T>(path) });
      } catch (error) {
        setResource({ state: 'error', error: errorMessage(error) });
      }
    },
    [path],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return {
    ...resource,
    reload: () => load(true),
    setData: (data: T) => setResource({ state: 'ready', data }),
  };
}
