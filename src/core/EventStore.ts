import { PipelineEvent, PersistenceAdapter } from '../types';

export class EventStore {
  private events: PipelineEvent[] = [];
  private persistenceAdapter?: PersistenceAdapter;
  private sessionId: string;
  private pipelineId: string;
  private createdAt: number;

  constructor(sessionId: string, pipelineId: string, adapter?: PersistenceAdapter) {
    this.sessionId = sessionId;
    this.pipelineId = pipelineId;
    this.persistenceAdapter = adapter;
    this.createdAt = Date.now();
  }

  async addEvent(event: PipelineEvent): Promise<void> {
    this.events.push(event);
    if (this.persistenceAdapter) {
      await this.persistenceAdapter.save({
        sessionId: this.sessionId,
        pipelineId: this.pipelineId,
        events: this.events,
        createdAt: this.createdAt
      });
    }
  }

  getEvents(): PipelineEvent[] {
    return [...this.events];
  }

  getEventCount(): number {
    return this.events.length;
  }

  getCreatedAt(): number {
    return this.createdAt;
  }
  
  async clearPersistence(): Promise<void> {
    if (this.persistenceAdapter) {
      await this.persistenceAdapter.delete(this.sessionId);
    }
  }
}
