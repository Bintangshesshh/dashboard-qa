/** Shared type definitions for the QA dashboard */

export type UserRole = 'admin' | 'member';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface AuthStatus {
  authenticated: boolean;
  user?: User;
  csrfToken?: string;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Suite {
  id: string;
  name: string;
  description: string;
  targetUrl: string;
  categoryId?: string | null;
  cases: Case[];
  createdAt: string;
  updatedAt: string;
}

export interface Case {
  id: string;
  suiteId: string;
  name: string;
  code: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  durationMs: number;
}

export interface LighthouseScores {
  performance?: number | null;
  accessibility?: number | null;
  'best-practices'?: number | null;
  seo?: number | null;
  [key: string]: number | null | undefined;
}

export interface Run {
  id: string;
  suiteId: string;
  suiteName: string;
  targetUrl: string;
  mode: string;
  headed: boolean;
  status: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  artifacts?: string[];
  reportUrl?: string;
  docsStatus?: string;
  docsError?: string;
  docsUrl?: string;
  summary?: RunSummary;
  lighthouseScores?: LighthouseScores;
  createdAt: string;
}

export interface LogEntry {
  seq: number;
  text: string;
  stream: string;
  at?: string;
}

export interface LogsResponse {
  logs: LogEntry[];
  hasMore?: boolean;
  nextAfter?: number;
}

export type ViewId = 'workspace' | 'lighthouse' | 'history' | 'users';
export type ModalId = '' | 'auth' | 'suite' | 'case' | 'category';
export type ConnectionState = 'standby' | 'connecting' | 'connected' | 'polling';
export type RunMode = 'pw' | 'lh' | 'both';
