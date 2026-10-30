"use client";
/** WebSocket + HTTP polling hook for run log streaming */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry, Run, ConnectionState } from './types';
import { getRunLogs, wsUrl } from './api';

interface UseRunStreamOptions {
  runId: string;
  authenticated: boolean;
  onRunStatus?: (run: Run) => void;
}

interface UseRunStreamResult {
  logs: LogEntry[];
  connection: ConnectionState;
  pollError: string;
  followLogs: React.MutableRefObject<boolean>;
  terminalRef: React.RefObject<HTMLDivElement | null>;
  reconnect: () => void;
}

export function useRunStream({ runId, authenticated, onRunStatus }: UseRunStreamOptions): UseRunStreamResult {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('standby');
  const [pollError, setPollError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const followLogs = useRef(true);
  const terminalRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const onRunStatusRef = useRef(onRunStatus);
  onRunStatusRef.current = onRunStatus;

  const reconnect = useCallback(() => setRetryCount(n => n + 1), []);

  useEffect(() => {
    if (!runId || !authenticated) return;

    let disposed = false;
    let ws: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let pollTimer: ReturnType<typeof setTimeout>;
    let cursor = 0;
    let attempt = 0;

    seq.current = 0;
    followLogs.current = true;
    setLogs([]);
    setPollError('');

    const merge = (entries: LogEntry[]) => {
      if (disposed) return;
      setLogs(previous => {
        if (!entries.length) return previous;
        const all = new Map(previous.map(l => [l.seq, l]));
        for (const l of entries) all.set(l.seq, l);
        return [...all.values()].sort((a, b) => a.seq - b.seq).slice(-3000);
      });
    };

    // HTTP cursor advances only from HTTP responses: WS delivery cannot skip persisted replay.
    const poll = async () => {
      try {
        const result = await getRunLogs(runId, cursor);
        if (disposed) return;
        merge(result.logs);
        for (const l of result.logs) cursor = Math.max(cursor, l.seq);
        setPollError('');
      } catch (e) {
        if (!disposed) setPollError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!disposed) pollTimer = setTimeout(poll, 2000);
      }
    };

    const connect = () => {
      if (disposed) return;
      setConnection('connecting');
      try {
        ws = new WebSocket(wsUrl());
      } catch {
        setConnection('polling');
        return;
      }
      ws.onopen = () => {
        if (disposed) return;
        attempt = 0;
        setConnection('connected');
        ws?.send(JSON.stringify({ type: 'subscribe', runId, after: seq.current }));
      };
      ws.onmessage = e => {
        if (disposed) return;
        try {
          const m = JSON.parse(e.data);
          if (m.type === 'log' && m.runId === runId) {
            seq.current = Math.max(seq.current, m.seq);
            merge([m]);
          } else if (m.type === 'replay-truncated' && m.runId === runId) {
            setPollError('Live replay was truncated; HTTP polling will load the retained log history.');
          } else if (m.type === 'status' && m.run && onRunStatusRef.current) {
            onRunStatusRef.current(m.run);
          }
        } catch {
          setConnection('polling');
        }
      };
      ws.onerror = () => { if (!disposed) setConnection('polling'); };
      ws.onclose = () => {
        if (disposed) return;
        setConnection('polling');
        reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15000));
      };
    };

    poll();
    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      clearTimeout(pollTimer);
      ws?.close();
    };
  }, [runId, authenticated, retryCount]);

  // Auto-scroll terminal when following logs
  useEffect(() => {
    if (followLogs.current) {
      terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight });
    }
  }, [logs]);

  return { logs, connection, pollError, followLogs, terminalRef, reconnect };
}
