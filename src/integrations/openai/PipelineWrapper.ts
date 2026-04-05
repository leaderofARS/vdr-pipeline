import OpenAI from 'openai';
import { Pipeline } from '../../core/Pipeline';

/**
 * Wraps an OpenAI client to automatically log PROMPT and GENERATION events.
 * Intercepts `chat.completions.create` for both streaming and non-streaming.
 */
export function wrapOpenAI(client: OpenAI, pipeline: Pipeline): OpenAI {
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);

  client.chat.completions.create = async function (body: Record<string, any>, options?: any): Promise<any> {
    const startTime = Date.now();

    // 1. Log PROMPT
    const messages = body.messages || [];
    const lastMessage = messages[messages.length - 1] || {};
    
    let role: 'user' | 'system' | 'assistant' = 'user';
    if (lastMessage.role === 'system') role = 'system';
    else if (lastMessage.role === 'assistant') role = 'assistant';

    const promptContent = typeof lastMessage.content === 'string' 
      ? lastMessage.content 
      : JSON.stringify(lastMessage.content || '');

    try {
      await pipeline.logPrompt(
        {
          role,
          content: promptContent,
          variables: { ...body, messages: undefined } as any
        },
        { model: body.model }
      );
    } catch (err) {
      console.error("VDR Pipeline Error auto-logging OpenAI prompt:", err);
    }

    // 2. Call Original
    const response = await originalCreate(body as any, options);

    // 3. Log GENERATION (Non-streaming)
    if (!body.stream) {
      const latencyMs = Date.now() - startTime;
      const usage = response.usage;
      
      let generationContent = '';
      if (response.choices && response.choices.length > 0) {
        generationContent = response.choices[0].message?.content || '';
      }

      try {
        await pipeline.logGeneration(
          {
            content: generationContent,
            model: response.model || body.model,
            finishReason: response.choices?.[0]?.finish_reason || 'stop',
            usage: usage ? {
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
              totalTokens: usage.total_tokens
            } : undefined
          },
          {
            model: response.model || body.model,
            latencyMs,
            tokenCount: usage?.total_tokens
          }
        );
      } catch (err) {
        console.error("VDR Pipeline Error auto-logging OpenAI generation:", err);
      }
      return response;
    }

    // 4. Log GENERATION (Streaming)
    // For streams, wrap the AsyncIterator to capture the full string before logging
    async function* wrappedStream() {
      let fullContent = '';
      let finishReason = '';
      let responseModel = body.model;
      
      for await (const chunk of (response as any)) {
        const delta = chunk.choices?.[0]?.delta?.content || '';
        fullContent += delta;
        
        if (chunk.choices?.[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
        if (chunk.model) {
          responseModel = chunk.model;
        }
        
        yield chunk;
      }

      const latencyMs = Date.now() - startTime;
      
      try {
        await pipeline.logGeneration(
          {
            content: fullContent,
            model: responseModel,
            finishReason: finishReason || 'stop',
            // Token usage is not reliably sent in all streaming endpoints unless stream_options is configured,
            // so we omit it dynamically here unless provided
          },
          {
            model: responseModel,
            latencyMs
          }
        );
      } catch (err) {
        console.error("VDR Pipeline Error auto-logging OpenAI stream generation:", err);
      }
    }

    return wrappedStream() as any;
  } as any;

  return client;
}
