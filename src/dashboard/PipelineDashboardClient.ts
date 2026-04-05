import { SipHeronAPIError } from '../errors';

const DEFAULT_BASE = 'https://api.sipheron.com';

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

export interface PipelineDashboardClientConfig {
  apiKey: string;
  /** Same origin as SipHeron API (vdr-core `baseUrl`). */
  apiBaseUrl?: string;
}

/** Response shapes mirror `GET /api/pipeline/analytics/*` in the SipHeron API server. */
export interface PipelineAnalyticsOverview {
  totalEvents: number;
  confirmedEvents: number;
  failedEvents: number;
  pendingEvents: number;
  anchorSuccessRate: string;
  totalPipelines: number;
  activePipelines: number;
  eventsLast7d: number;
  eventsLast30d: number;
  uniqueSessions: number;
  dailyAverage7d: number;
  aiMetrics: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalCost: number;
    avgLatencyMs: number;
    avgToxicity: number;
    piiEventsCount: number;
  };
}

/**
 * Read-only client for organization pipeline analytics and session inspection (managed API).
 * Uses the same `x-api-key` authentication as `@sipheron/vdr-core`.
 */
export class PipelineDashboardClient {
  private readonly apiKey: string;
  private readonly base: string;

  constructor(config: PipelineDashboardClientConfig) {
    if (!config.apiKey?.trim()) {
      throw new Error('PipelineDashboardClient requires apiKey');
    }
    this.apiKey = config.apiKey.trim();
    this.base = trimBase(config.apiBaseUrl || DEFAULT_BASE);
  }

  private async getJson<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const q = query
      ? '?' +
        Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    const url = `${this.base}${path}${q}`;
    const fetcher = (globalThis as any).fetch as typeof fetch | undefined;
    if (!fetcher) {
      throw new SipHeronAPIError('fetch is not available in this runtime', { path });
    }
    const res = await fetcher(url, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
        Accept: 'application/json'
      }
    });
    const text = await res.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      throw new SipHeronAPIError(`Dashboard API ${res.status}: ${data?.error || text || res.statusText}`, {
        path,
        statusCode: res.status,
        body: data
      });
    }
    return data as T;
  }

  getAnalyticsOverview(): Promise<PipelineAnalyticsOverview> {
    return this.getJson<PipelineAnalyticsOverview>('/api/pipeline/analytics/overview');
  }

  getAnalyticsThroughput(periodDays = 7): Promise<{ throughput: Array<Record<string, unknown>> }> {
    return this.getJson('/api/pipeline/analytics/throughput', { period: periodDays });
  }

  getAnalyticsByType(periodDays = 30): Promise<{ byType: Array<Record<string, unknown>> }> {
    return this.getJson('/api/pipeline/analytics/by-type', { period: `${periodDays}d` });
  }

  getAnalyticsByModel(): Promise<{ byModel: Array<Record<string, unknown>> }> {
    return this.getJson('/api/pipeline/analytics/by-model');
  }

  getComplianceTrend(periodDays = 30): Promise<{ trend: Array<Record<string, unknown>> }> {
    return this.getJson('/api/pipeline/analytics/compliance-trend', { period: `${periodDays}d` });
  }

  getSession(sessionId: string): Promise<{ session: Record<string, unknown>; events: unknown[] }> {
    return this.getJson(`/api/pipeline/sessions/${encodeURIComponent(sessionId)}`);
  }

  listEvents(params?: {
    page?: number;
    limit?: number;
    sessionId?: string;
    pipelineId?: string;
    eventType?: string;
    search?: string;
  }): Promise<{ events: unknown[]; total: number; page: number; pages: number }> {
    return this.getJson('/api/pipeline/events', params as Record<string, string | number | undefined>);
  }

  /**
   * URL for `GET /api/pipeline/sessions/:sessionId/stream` (SSE). Use from Node with `fetch` + `text/event-stream`,
   * or any client that can send the `x-api-key` header (browser `EventSource` cannot).
   */
  getSessionLiveStreamUrl(sessionId: string): string {
    return `${this.base}/api/pipeline/sessions/${encodeURIComponent(sessionId)}/stream`;
  }
}
