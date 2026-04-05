import * as crypto from 'crypto';
import { WebhookConfig, AnchorResult, PipelineSession } from '../types';

/**
 * WebhookDispatcher POSTs notifications to developer endpoints on anchor confirmation or session finalization.
 * When `secret` is set, signs the body compatibly with `@sipheron/vdr-core` webhook verification (`t=...,v1=...`).
 */
export class WebhookDispatcher {
  private configs: WebhookConfig[];

  constructor(configs: WebhookConfig[]) {
    this.configs = configs;
  }

  async dispatch(event: 'anchor.confirmed' | 'session.finalized', payload: AnchorResult | PipelineSession) {
    if (!this.configs.length) return;

    for (const config of this.configs) {
      if (!config.events || config.events.includes(event)) {
        this.fire(config, event, payload).catch(() => {});
      }
    }
  }

  private signBody(secret: string, body: string): string {
    const ts = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    return `t=${ts},v1=${v1}`;
  }

  private async fire(config: WebhookConfig, event: string, payload: AnchorResult | PipelineSession) {
    const fetcher = (globalThis as any).fetch as typeof fetch | undefined;
    if (!fetcher) return;

    const body = JSON.stringify({
      event,
      payload,
      timestamp: Date.now(),
      vdr_version: '0.1.0'
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-VDR-Event': event,
      'User-Agent': '@sipheron/vdr-pipeline Webhook'
    };

    if (config.secret) {
      headers['X-Sipheron-Signature'] = this.signBody(config.secret, body);
    }

    await fetcher(config.url, {
      method: 'POST',
      headers,
      body
    });
  }
}
