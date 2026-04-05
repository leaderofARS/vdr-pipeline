import { PipelineEventListener } from '../../src/integrations/llamaindex';
import { Pipeline } from '../../src/core/Pipeline';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../../src/core/Pipeline');

describe('LlamaIndex Integration - PipelineEventListener', () => {
    let pipeline: jest.Mocked<Pipeline>;
    let listener: PipelineEventListener;

    beforeEach(() => {
        pipeline = new Pipeline({ pipelineName: 'test', apiKey: 'test' }) as jest.Mocked<Pipeline>;
        pipeline.logPrompt = jest.fn() as any;
        pipeline.logGeneration = jest.fn() as any;
        pipeline.logRetrieval = jest.fn() as any;
        pipeline.logCustom = jest.fn() as any;
        
        listener = new PipelineEventListener(pipeline);
    });

    it('should map query events to logPrompt', async () => {
        await listener.onQueryStart({ query: 'Hello Llama' });
        expect(pipeline.logPrompt).toHaveBeenCalledWith({
            role: 'user',
            content: 'Hello Llama'
        });
    });

    it('should map retrieve events to logRetrieval', async () => {
        await listener.onRetrieve({
            query: 'test',
            nodes: [{ node: { nodeId: 'doc-1' } }]
        });
        expect(pipeline.logRetrieval).toHaveBeenCalledWith({
            query: 'test',
            resultCount: 1,
            sourceIds: ['doc-1']
        });
    });

    it('should map synthesize events to logGeneration', async () => {
        await listener.onSynthesize({ response: 'I found an answer' });
        expect(pipeline.logGeneration).toHaveBeenCalledWith({
            content: 'I found an answer',
            model: 'llamaindex-engine',
            finishReason: 'stop'
        });
    });
});
