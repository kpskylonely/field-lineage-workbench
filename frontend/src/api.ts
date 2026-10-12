/** 后端 API 封装（推导 / 自动分析） */

const BASE = "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export type DeriveEvidence = { t: string; ref: string };
export type DeriveRow = {
  id: number;
  object_key: string;
  cells: string[];
  evidence: DeriveEvidence[];
  note?: string | null;
  confidence?: number;
  review_status: "pending" | "ok" | "no" | "applied";
};

export type DerivePayload = {
  table_code: string;
  table_name: string;
  rule: string;
  logic: string[];
  columns: string[];
  deps: string[];
  batch_id: string | null;
  updated_at: string | null;
  rows: DeriveRow[];
  stats: {
    total: number;
    pending: number;
    ok: number;
    no: number;
    applied: number;
    avg_confidence?: number;
  };
};

export type DeriveSummary = {
  total_candidates: number;
  tables: {
    table_code: string;
    table_name: string;
    batch_id: string | null;
    updated_at: string | null;
    total: number;
    pending: number;
    ok: number;
    no: number;
    applied: number;
  }[];
};

export function runDerive(table: string) {
  return req<Record<string, unknown>>(`/api/derive/run?table=${encodeURIComponent(table)}`, {
    method: "POST",
  });
}

export function runAnalyzeAuto() {
  return req<{ ran: number; total_candidates: number; results: unknown[] }>("/api/analyze/auto", {
    method: "POST",
  });
}

export function fetchDeriveCandidates(table: string) {
  return req<DerivePayload>(`/api/derive/${encodeURIComponent(table)}/candidates`);
}

export function fetchDeriveSummary() {
  return req<DeriveSummary>("/api/derive/summary");
}

export type TraceProp = { k: string; v: string };
export type TraceRecord = {
  system: string;
  module: string;
  entry: string;
  op: string;
  role: string;
  expr: string;
  level: string;
};
export type TraceSide = {
  key: string;
  title: string;
  source_table: string;
  present: boolean;
  summary: string;
  props: TraceProp[];
  records: TraceRecord[];
  empty_hint?: string | null;
};
export type DeriveTrace = {
  id: number;
  table_code: string;
  object_key: string;
  cells: string[];
  note?: string | null;
  confidence: number;
  review_status: string;
  compare_hint: string;
  diff_type: string;
  sides: TraceSide[];
};

export function fetchDeriveTrace(candidateId: number) {
  return req<DeriveTrace>(`/api/derive/candidates/${candidateId}/trace`);
}

export function fetchTraceByKey(key: string) {
  return req<Omit<DeriveTrace, "id" | "table_code" | "cells" | "note" | "confidence" | "review_status"> & {
    object_key: string;
  }>(`/api/trace?key=${encodeURIComponent(key)}`);
}

export function fetchFields() {
  return req<{
    id: number;
    full_name: string;
    schema_name: string;
    table_name: string;
    field_name: string;
    field_comment: string | null;
    data_type: string | null;
    source_ref_count: number;
    field_ref_status: string | null;
    is_pk: boolean;
    is_fk: boolean;
    is_core?: boolean;
  }[]>("/api/fields");
}

export function fetchReferences() {
  return req<{
    id: number;
    system_name: string;
    module_name: string;
    entry_name: string;
    op_type: string;
    full_field: string;
    schema_name: string;
    table_name: string;
    field_name: string;
    field_role: string | null;
    sql_expr: string | null;
  }[]>("/api/references");
}

export function fetchObjects() {
  return req<{
    id: number;
    schema_name: string;
    object_name: string;
    object_type: string;
    object_comment?: string | null;
    preliminary_class: string | null;
    referenced_by_code: boolean;
    ref_entry_count: number;
  }[]>("/api/objects");
}

export function fetchModules() {
  return req<{
    id: number;
    system_name: string;
    module_name: string;
    repo: string | null;
    duty: string | null;
  }[]>("/api/modules");
}

export function fetchEntries() {
  return req<{
    id: number;
    system_name: string;
    module_name: string;
    entry_type: string;
    entry_name: string;
    entry_class: string | null;
    method_name: string | null;
    request_params?: string | null;
    return_type?: string | null;
    file_path?: string | null;
    in_table15: boolean;
  }[]>("/api/entries");
}

export function reviewDerive(candidateIds: number[], status: "pending" | "ok" | "no") {
  return req<{ updated: number }>("/api/derive/review", {
    method: "POST",
    body: JSON.stringify({ candidate_ids: candidateIds, status }),
  });
}

export function applyDerive(table: string) {
  return req<{ applied: number; written: number }>(
    `/api/derive/${encodeURIComponent(table)}/apply`,
    { method: "POST" }
  );
}

export type IngestResult = {
  kind: "dmp" | "code";
  filename: string;
  schemas?: string[];
  system?: string;
  counts: Record<string, number>;
  warnings: string[];
  material_id: number;
};

async function uploadForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export function ingestDmp(file: File, replace = false) {
  const form = new FormData();
  form.append("file", file);
  form.append("replace", String(replace));
  return uploadForm<IngestResult>("/api/ingest/dmp", form);
}

export function ingestCode(file: File, systemName: string, replace = false) {
  const form = new FormData();
  form.append("file", file);
  form.append("system_name", systemName);
  form.append("replace", String(replace));
  return uploadForm<IngestResult>("/api/ingest/code", form);
}

export function ingestAuto(file: File, systemName?: string, replace = false) {
  const form = new FormData();
  form.append("file", file);
  if (systemName) form.append("system_name", systemName);
  form.append("replace", String(replace));
  return uploadForm<IngestResult>("/api/ingest/auto", form);
}
