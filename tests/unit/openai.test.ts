import { wrapOpenAI } from '../../src/integrations/openai';
import { Pipeline } from '../../src/core/Pipeline';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../../src/core/Pipeline');

describe('OpenAI Integration - wrapOpenAI', () => {
    let pipeline: jest.Mocked<Pipeline>;
    let mockClient: any;

    beforeEach(() => {
        pipeline = new Pipeline({ pipelineName: 'test', apiKey: 'test' }) as jest.Mocked<Pipeline>;
        pipeline.logPrompt = jest.fn() as any;
        pipeline.logGeneration = jest.fn() as any;
        
        mockClient = {
            chat: {
                completions: {
                    create: jest.fn<() => Promise<any>>().mockResolvedValue({
                        model: 'gpt-4o',
                        choices: [{ message: { content: 'test response text' }, finish_reason: 'stop' }],
                        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
                    })
                }
            }
        };
    });

    it('should intercept non-streaming create and log events', async () => {
        const wrapped = wrapOpenAI(mockClient, pipeline);
        
        const res = await wrapped.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'hello' }]
        });
        
        expect(res.choices[0].message.content).toBe('test response text');
        
        expect(pipeline.logPrompt).toHaveBeenCalledWith(
            expect.objectContaining({ role: 'user', content: 'hello' }),
            expect.objectContaining({ model: 'gpt-4o' })
        );
        
        expect(pipeline.logGeneration).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'test response text', model: 'gpt-4o' }),
            expect.objectContaining({ model: 'gpt-4o', tokenCount: 20 })
        );
    });

    it('should intercept streaming create and yield full text for logGeneration', async () => {
        // mock generator
        async function* mockStream() {
            yield { model: 'gpt-4o', choices: [{ delta: { content: 'hello ' } }] };
            yield { model: 'gpt-4o', choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }] };
        }

        mockClient.chat.completions.create = jest.fn().mockReturnValue(mockStream());
        const wrapped = wrapOpenAI(mockClient, pipeline);

        const iterator = await wrapped.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'stream plz' }],
            stream: true
        });

        // consume stream
        const chunks = [];
        for await (const chunk of iterator) chunks.push(chunk);

        expect(chunks.length).toBe(2);
        
        expect(pipeline.logPrompt).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'stream plz' }),
            expect.objectContaining({ model: 'gpt-4o' })
        );

        expect(pipeline.logGeneration).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'hello world', model: 'gpt-4o' }),
            expect.objectContaining({ model: 'gpt-4o' })
        );
    });
});
