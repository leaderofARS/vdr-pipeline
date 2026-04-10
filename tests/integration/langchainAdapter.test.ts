import { Pipeline } from '../../src/core/Pipeline';
import { PipelineCallbackHandler } from '../../src/integrations/langchain/PipelineCallbackHandler';
import { describe, it, expect, jest } from '@jest/globals';

// Mock vdr-core as in other tests
jest.mock('@sipheron/vdr-core', () => ({
  SipHeron: jest.fn().mockImplementation(() => ({
    anchor: jest.fn<(opts: any) => Promise<any>>().mockResolvedValue({
      transactionSignature: 'mock_tx_sig',
      id: 'mock_id'
    }),
    request: jest.fn<(method: string, path: string, data?: any) => Promise<any>>().mockImplementation((method: string, path: string) => {
      if (path === '/api/pipeline/events') {
        return Promise.resolve({
          txSignature: 'mock_tx_sig',
          id: 'mock_id'
        });
      }
      return Promise.reject(new Error(`Unexpected request to ${path}`));
    })
  })),
  hashDocument: jest.fn().mockImplementation(async (...args: any[]) => {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(args[0]).digest('hex');
  })
}));

describe('Integration: LangChain Callback Handler', () => {
    it('should capture LLM events from LangChain interface', async () => {
        const pipeline = Pipeline.withApiKey('test-key', { pipelineName: 'langchain-test' });
        const handler = new PipelineCallbackHandler(pipeline);
        
        // Simulate LangChain events
        const runId = 'test-run-id';
        
        // 1. LLM Start
        await handler.handleChatModelStart(
            { id: ['openai', 'chat', 'ChatOpenAI'] } as any,
            [[{ content: 'Explain quantum physics', _getType: () => 'human' }]],
            runId
        );
        
        // 2. LLM End
        await handler.handleLLMEnd(
            {
                generations: [[{ text: 'Quantum physics is...', generationInfo: { finish_reason: 'stop' } }]],
                llmOutput: { tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } }
            } as any,
            runId
        );
        
        // 3. Tool Call
        const toolRunId = 'tool-run-id';
        await handler.handleToolStart(
            { id: ['calculator'] } as any,
            JSON.stringify({ a: 1, b: 2 }),
            toolRunId,
            runId,
            undefined,
            undefined,
            'CalculatorTool'
        );
        
        await handler.handleToolEnd(
            { result: 3 },
            toolRunId
        );

        // 4. Finalize session
        const result = await pipeline.finalizeAndAnchor();
        
        expect(pipeline.getEventCount()).toBe(4);
        expect(result.eventCount).toBe(4);
        expect(pipeline.getSessionStatus()).toBe('finalized');
        
        const session = pipeline.exportSession();
        expect(session.events[0].type).toBe('PROMPT');
        expect(session.events[1].type).toBe('GENERATION');
        expect(session.events[2].type).toBe('TOOL_CALL');
        expect(session.events[3].type).toBe('TOOL_RESULT');
    });

    it('should capture retrieval events', async () => {
        const pipeline = Pipeline.withApiKey('test-key', { pipelineName: 'langchain-retrieval' });
        const handler = new PipelineCallbackHandler(pipeline);
        
        const runId = 'retrieval-run-id';
        // Need to set run info before handleRetrieverEnd since it relies on previous run input
        // Simulate chain start first to set input
        await handler.handleChainStart(
            { id: ['retriever-chain'] } as any,
            { query: 'Who is Alan Turing?' },
            runId
        );

        await handler.handleRetrieverEnd(
            [
                { pageContent: 'Alan Turing was...', metadata: { source: 'wikipedia' } }
            ] as any,
            runId
        );

        const session = pipeline.finalizeOnly();
        expect(session.events.some(e => e.type === 'RETRIEVAL')).toBe(true);
        const retrievalEvent = session.events.find(e => e.type === 'RETRIEVAL');
        expect(retrievalEvent?.payload.query).toBe('Who is Alan Turing?');
        expect(retrievalEvent?.payload.resultCount).toBe(1);
    });
});
