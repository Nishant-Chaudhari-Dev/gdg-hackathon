import { API_URL, MOCK_MODE } from "./config";
import type {
  AuditEvent,
  EvalReport,
  OpsMetrics,
  Outage,
  SampleTicket,
  SystemStatus,
  TicketRecord,
  TicketStatus,
} from "./types";

// ---- Request bodies (not part of api-types.ts, derived from the endpoint comments) ----
export interface CreateTicketInput {
  subject: string;
  body: string;
  operator?: string;
}
export type TicketActionKind = "approve" | "edit" | "reject" | "acknowledge" | "override";
export interface TicketActionInput {
  action: TicketActionKind;
  reply?: string;
  override?: Record<string, string>;
  note?: string;
  operator?: string;
}
export type SimulateScenario = "mixed" | "outage" | "german" | "adversarial";
export interface SimulateInput {
  scenario: SimulateScenario;
  count?: number;
  interval_ms?: number;
}

/** Error thrown by every API wrapper. `offline` = the gateway could not be reached at all. */
export class ApiError extends Error {
  readonly status: number;
  readonly offline: boolean;
  constructor(message: string, status: number, offline = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.offline = offline;
  }
}

export function isOffline(err: unknown): boolean {
  return err instanceof ApiError && err.offline;
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.offline) return `Gateway unreachable at ${API_URL}`;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: { Accept: "application/json", ...(rest.body ? { "Content-Type": "application/json" } : {}), ...rest.headers },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    throw new ApiError(aborted ? `Request timed out after ${Math.round(timeoutMs / 1000)}s` : "Gateway offline", 0, true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = res.statusText || `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && typeof j === "object" && "detail" in j) {
        detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

const json = (body: unknown) => JSON.stringify(body);

async function mock() {
  return (await import("./mock")).mockBackend;
}

export const api = {
  async listTickets(params: { limit?: number; status?: TicketStatus } = {}): Promise<TicketRecord[]> {
    if (MOCK_MODE) return (await mock()).listTickets();
    const q = new URLSearchParams();
    q.set("limit", String(params.limit ?? 200));
    if (params.status) q.set("status", params.status);
    return (await request<{ items: TicketRecord[] }>(`/api/tickets?${q}`)).items;
  },

  async getTicket(id: string): Promise<TicketRecord> {
    if (MOCK_MODE) return (await mock()).getTicket(id);
    return request<TicketRecord>(`/api/tickets/${encodeURIComponent(id)}`);
  },

  /** wait=true blocks until the pipeline finishes (gateway caps at ~45s). */
  async createTicket(input: CreateTicketInput, wait = true): Promise<TicketRecord> {
    if (MOCK_MODE) return (await mock()).createTicket(input);
    return request<TicketRecord>(`/api/tickets?wait=${wait}`, {
      method: "POST",
      body: json(input),
      timeoutMs: 60_000,
    });
  },

  async ticketAction(id: string, input: TicketActionInput): Promise<TicketRecord> {
    if (MOCK_MODE) return (await mock()).ticketAction(id, input);
    return request<TicketRecord>(`/api/tickets/${encodeURIComponent(id)}/actions`, {
      method: "POST",
      body: json(input),
    });
  },

  async listOutages(): Promise<Outage[]> {
    if (MOCK_MODE) return (await mock()).listOutages();
    return (await request<{ items: Outage[] }>("/api/outages")).items;
  },

  async resolveOutage(id: string, operator?: string): Promise<Outage> {
    if (MOCK_MODE) return (await mock()).resolveOutage(id, operator);
    return request<Outage>(`/api/outages/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: json({ operator }),
    });
  },

  async listAudit(limit = 200): Promise<AuditEvent[]> {
    if (MOCK_MODE) return (await mock()).listAudit();
    return (await request<{ items: AuditEvent[] }>(`/api/audit?limit=${limit}`)).items;
  },

  async metrics(): Promise<OpsMetrics> {
    if (MOCK_MODE) return (await mock()).metrics();
    return request<OpsMetrics>("/api/metrics");
  },

  /** Throws ApiError(404) when no offline evaluation has been run yet. */
  async evalReport(): Promise<EvalReport> {
    if (MOCK_MODE) return (await mock()).evalReport();
    return request<EvalReport>("/api/eval");
  },

  async system(): Promise<SystemStatus> {
    if (MOCK_MODE) return (await mock()).system();
    return request<SystemStatus>("/api/system", { timeoutMs: 10_000 });
  },

  async samples(): Promise<SampleTicket[]> {
    if (MOCK_MODE) return (await mock()).samples();
    return (await request<{ items: SampleTicket[] }>("/api/samples")).items;
  },

  async simulate(input: SimulateInput): Promise<{ started: number; scenario: string }> {
    if (MOCK_MODE) return (await mock()).simulate(input);
    return request<{ started: number; scenario: string }>("/api/simulate", {
      method: "POST",
      body: json(input),
    });
  },

  eventsUrl(): string {
    return `${API_URL}/api/events`;
  },
};
