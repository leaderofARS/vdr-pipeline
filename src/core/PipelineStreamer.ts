import { PipelineEvent, StreamingConfig } from '../types';

const DEFAULT_API_BASE = 'https://api.sipheron.com';

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

type StreamerConfig = StreamingConfig & {
  pipelineName: string;
};

/**
 * Real-time dashboard sync: HTTP ingest to SipHeron (`POST /api/pipeline/live-event`)
 * and/or an optional custom WebSocket.
 */
export class PipelineStreamer {
  private ws?: any;
  private config: StreamerConfig;
  private queue: PipelineEvent[] = [];
  private connected = false;
  private useHttp: boolean;
  private ingestUrl: string;

  constructor(config: StreamerConfig) {
    this.config = config;
    const base = normalizeBase(config.apiBaseUrl || DEFAULT_API_BASE);
    this.ingestUrl = `${base}/api/pipeline/live-event`;
    const httpDefault =
      config.useHttpIngest !== false && Boolean(config.apiKey?.trim());
    this.useHttp = httpDefault;

    if (this.config.enabled && this.config.webSocketUrl) {
      this.connectWs();
    }
  }

  private connectWs() {
    const url = this.config.webSocketUrl;
    if (!url) return;
    try {
      const WS = (globalThis as any).WebSocket;
      if (!WS) return;

      this.ws = new WS(url);

      this.ws.onopen = () => {
        this.connected = true;
        if (this.config.authToken) {
          this.ws.send(JSON.stringify({ type: 'auth', token: this.config.authToken }));
        }
        this.flushWs();
      };

      this.ws.onclose = () => {
        this.connected = false;
        setTimeout(() => this.connectWs(), 5000);
      };

      this.ws.onerror = (err: any) => {
        if (this.config.onConnectionError) {
          this.config.onConnectionError(err);
        }
      };
    } catch {
      /* non-fatal */
    }
  }

  private flushWs() {
    while (this.queue.length > 0 && this.connected) {
      const e = this.queue.shift();
      if (e) {
        try {
          this.ws.send(JSON.stringify({ type: 'event', data: e, timestamp: Date.now() }));
        } catch {
          this.connected = false;
          this.queue.unshift(e);
          break;
        }
      }
    }
  }

  private buildLiveBody(event: PipelineEvent) {
    return {
      sessionId: event.sessionId,
      pipelineName: this.config.pipelineName,
      sequenceIndex: event.sequenceIndex,
      eventType: event.type,
      eventHash: event.hash,
      timestamp: event.timestamp,
      metadata: event.metadata
        ? {
            model: event.metadata.model,
            provider: event.metadata.provider,
            latencyMs: event.metadata.latencyMs,
            tokenCount: event.metadata.tokenCount,
            tags: event.metadata.tags
          }
        : undefined
    };
  }

  private async postIngest(event: PipelineEvent): Promise<void> {
    const key = this.config.apiKey;
    if (!key) return;

    const fetcher = (globalThis as any).fetch as typeof fetch | undefined;
    if (!fetcher) return;

    const body = JSON.stringify(this.buildLiveBody(event));
    await fetcher(this.ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key
      },
      body
    });
  }

  /**
   * Stream an event to the dashboard (HTTP ingest and/or WebSocket).
   */
  async stream(event: PipelineEvent): Promise<void> {
    if (!this.config.enabled) return;

    if (this.useHttp) {
      try {
        await this.postIngest(event);
      } catch {
        /* best-effort; never block logging */
      }
    }

    if (this.config.webSocketUrl) {
      if (!this.connected || !this.ws) {
        this.queue.push(event);
        if (this.queue.length > 1000) this.queue.shift();
        if (!this.ws) this.connectWs();
        return;
      }
      try {
        this.ws.send(
          JSON.stringify({ type: 'event', data: event, timestamp: Date.now() })
        );
      } catch {
        this.connected = false;
        this.queue.push(event);
      }
    }
  }
}
