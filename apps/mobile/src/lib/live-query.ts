import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { useConvex } from 'convex/react';
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';
import { errorMessage } from './auth';

// The external store owns a stable snapshot; React only subscribes to it.
function queryStore<T>(watch: { localQueryResult: () => T | undefined; onUpdate: (callback: () => void) => () => void } | null) {
  let snapshot: { data?: T; error?: string } = {};
  const read = () => {
    try {
      const data = watch?.localQueryResult();
      if (data !== snapshot.data || snapshot.error) snapshot = { data };
    } catch (error) {
      const message = errorMessage(error);
      if (snapshot.error !== message) snapshot = { error: message };
    }
    return snapshot;
  };
  return { read, subscribe: (notify: () => void) => watch?.onUpdate(notify) ?? (() => {}) };
}

export function useLiveQuery<F extends FunctionReference<'query'>>(reference: F, args: FunctionArgs<F>) {
  const client = useConvex();
  const [focused, setFocused] = useState(false);
  const [version, setVersion] = useState(0);
  const key = JSON.stringify(args);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const store = useMemo(() => {
    void version; // Explicit retry creates a fresh subscription.
    const watch = focused ? client.watchQuery(reference, JSON.parse(key)) : null;
    return queryStore<FunctionReturnType<F>>(watch);
  }, [client, reference, key, focused, version]);
  const result = useSyncExternalStore(store.subscribe, store.read, store.read);
  return { ...result, retry: () => setVersion((value) => value + 1) };
}
