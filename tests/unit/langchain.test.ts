import { PipelineCallbackHandler } from '../../src/integrations/langchain';
import { Pipeline } from '../../src/core/Pipeline';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../../src/core/Pipeline');

describe('LangChain Integration - PipelineCallbackHandler', () => {
    let pipeline: jest.Mocked<Pipeline>;
    let handler: PipelineCallbackHandler;

    beforeEach(() => {
        pipeline = new Pipeline({ pipelineName: 'test', apiKey: 'test' }) as jest.Mocked<Pipeline>;
        pipeline.logPrompt = jest.fn() as any;
        pipeline.logGeneration = jest.fn() as any;
        pipeline.logToolCall = jest.fn() as any;
        pipeline.logToolResult = jest.fn() as any;
        pipeline.logRetrieval = jest.fn() as any;
        pipeline.logRouting = jest.fn() as any;
        pipeline.logCustom = jest.fn() as any;
        
        handler = new PipelineCallbackHandler(pipeline);
    });

    it('should map handleChatModelStart to logPrompt', async () => {
        const runId = 'run-1';
        await handler.handleChatModelStart(
            { id: ['ChatOpenAI'] } as any,
            [[{ content: 'Hello', _getType: () => 'human' }]],
            runId
        );
        expect(pipeline.logPrompt).toHaveBeenCalledWith({
            role: 'user',
            content: 'Hello',
            variables: undefined
        }, { model: 'ChatOpenAI', tags: undefined });
    });

    it('should map handleLLMEnd to logGeneration', async () => {
        const runId = 'run-1';
        await handler.handleChatModelStart({ id: ['ChatOpenAI'] } as any, [[{ content: 'Hi' }]], runId);
        
        await handler.handleLLMEnd(
            { generations: [[{ text: 'How can I help?', generationInfo: { finish_reason: 'stop' } }]] } as any,
            runId
        );
        
        expect(pipeline.logGeneration).toHaveBeenCalledWith({
            content: 'How can I help?',
            model: 'ChatOpenAI',
            finishReason: 'stop',
            usage: undefined
        }, { tags: undefined });
    });

    it('should map tool start and end', async () => {
        const runId = 'run-2';
        await handler.handleToolStart(
            { id: ['SearchTool'] } as any,
            '{"query": "solana"}',
            runId
        );
        
        expect(pipeline.logToolCall).toHaveBeenCalledWith({
            toolName: 'SearchTool',
            arguments: { query: 'solana' },
            toolId: runId
        }, { tags: undefined });

        await handler.handleToolEnd('search result here', runId);
        expect(pipeline.logToolResult).toHaveBeenCalledWith({
            toolName: 'SearchTool',
            toolId: runId,
            result: 'search result here'
        }, { tags: undefined });
    });
});
