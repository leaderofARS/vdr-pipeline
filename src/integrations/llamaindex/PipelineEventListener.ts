import { Pipeline } from '../../core/Pipeline';

/**
 * PipelineEventListener acts as a binding interface for LlamaIndex events.
 * It provides explicit methods that map generic event payloads to VDR Pipeline events.
 */
export class PipelineEventListener {
  private pipeline: Pipeline;

  constructor(pipeline: Pipeline) {
    this.pipeline = pipeline;

    // Bind event handlers to maintain `this`
    this.onQueryStart = this.onQueryStart.bind(this);
    this.onRetrieve = this.onRetrieve.bind(this);
    this.onSynthesize = this.onSynthesize.bind(this);
    this.onQueryEnd = this.onQueryEnd.bind(this);
  }

  /**
   * Universal callback handler target supporting direct invocation:
   * e.g., `Settings.callbackManager.on('retrieve', new PipelineEventListener(pipeline))`
   * 
   * (Fallback logic to behave dynamically if called like a function or object method directly).
   */
  public handle(event: any, payload: any) {
    const eventName = typeof event === 'string' ? event : event?.type || 'unknown';
    // Dynamically route via event name string matching if bound broadly
    if (eventName.includes('query')) {
      if (eventName.includes('start')) return this.onQueryStart(payload || event);
      if (eventName.includes('end')) return this.onQueryEnd(payload || event);
    }
    if (eventName.includes('retrieve')) return this.onRetrieve(payload || event);
    if (eventName.includes('synthesize')) return this.onSynthesize(payload || event);
  }

  async onQueryStart(event: any) {
    try {
      const queryPayload = event?.query?.query || event?.query || JSON.stringify(event);
      await this.pipeline.logPrompt({
        role: 'user',
        content: typeof queryPayload === 'string' ? queryPayload : JSON.stringify(queryPayload)
      });
    } catch {}
  }

  async onRetrieve(event: any) {
    try {
      const nodes = event?.nodes || event?.payload?.nodes || [];
      const query = event?.query || event?.payload?.query || 'unknown';
      
      await this.pipeline.logRetrieval({
        query: typeof query === 'string' ? query : JSON.stringify(query),
        resultCount: nodes.length,
        sourceIds: nodes.map((n: any) => n.node?.nodeId || n.nodeId || n.id_ || 'unknown').slice(0, 10)
      });
    } catch {}
  }

  async onSynthesize(event: any) {
    try {
      const response = event?.response || event?.payload?.response || '';
      await this.pipeline.logGeneration({
        content: typeof response === 'string' ? response : (response.response || JSON.stringify(response)),
        model: 'llamaindex-engine',
        finishReason: 'stop'
      });
    } catch {}
  }

  async onQueryEnd(event: any) {
    try {
      await this.pipeline.logCustom('QUERY_END', {
        summary: 'Query processing completed'
      });
    } catch {}
  }
}
