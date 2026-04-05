import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { Serialized } from '@langchain/core/load/serializable';
import { AgentAction, AgentFinish } from '@langchain/core/agents';
import { LLMResult } from '@langchain/core/outputs';
import { Document } from '@langchain/core/documents';
import { Pipeline } from '../../core/Pipeline';

export class PipelineCallbackHandler extends BaseCallbackHandler {
  name = 'vdr-pipeline';
  private pipeline: Pipeline;
  
  // Track runs to associate events
  private runMap = new Map<string, { name: string, type: string, input?: any }>();

  constructor(pipeline: Pipeline) {
    super();
    this.pipeline = pipeline;
  }

  async handleChatModelStart(
    llm: Serialized,
    messages: any[][],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ) {
    const modelName = runName || (llm.id ? llm.id[llm.id.length - 1] : 'unknown-model');
    this.runMap.set(runId, { name: modelName, type: 'llm' });
    
    let content = '';
    let role: 'user' | 'system' | 'assistant' = 'user';
    
    if (messages.length > 0 && messages[0].length > 0) {
        const firstMsg = messages[0][0];
        // Safely extract text content regardless of BaseMessage formatting
        content = typeof firstMsg.content === 'string' ? firstMsg.content : JSON.stringify(firstMsg.content);
        
        const typeStr = firstMsg._getType ? firstMsg._getType() : (firstMsg.id?.join('') || '');
        if (typeStr.includes('system')) role = 'system';
        else if (typeStr.includes('ai') || typeStr.includes('assistant')) role = 'assistant';
    } else {
        content = JSON.stringify(messages);
    }

    try {
        await this.pipeline.logPrompt(
            {
                role,
                content,
                variables: extraParams as Record<string, string>
            },
            { model: modelName, tags }
        );
    } catch (e) {
        // Suppress logging errors so they don't break the agent
        console.error("VDR Pipeline Error logging prompt:", e);
    }
  }

  async handleLLMEnd(output: LLMResult, runId: string, parentRunId?: string, tags?: string[]) {
    const runInfo = this.runMap.get(runId);
    let content = '';
    
    if (output.generations && output.generations.length > 0 && output.generations[0].length > 0) {
        content = output.generations[0][0].text;
    }

    const usage = output.llmOutput?.tokenUsage || output.llmOutput?.estimatedTokenUsage;

    try {
        await this.pipeline.logGeneration(
            {
                content,
                model: runInfo?.name || 'unknown',
                finishReason: output.generations[0]?.[0]?.generationInfo?.finish_reason,
                usage: usage ? {
                    promptTokens: usage.promptTokens,
                    completionTokens: usage.completionTokens,
                    totalTokens: usage.totalTokens
                } : undefined
            },
            { tags }
        );
    } catch (e) {
        console.error("VDR Pipeline Error logging generation:", e);
    }
  }

  async handleRetrieverEnd(documents: Document<Record<string, any>>[], runId: string, parentRunId?: string, tags?: string[]) {
    const runInfo = this.runMap.get(runId);
    
    try {
        await this.pipeline.logRetrieval(
            {
                query: typeof runInfo?.input === 'string' ? runInfo.input : JSON.stringify(runInfo?.input || 'unknown'),
                resultCount: documents.length,
                sourceIds: documents.map(d => d.metadata?.source || d.metadata?.id || 'unknown').slice(0, 10),
                retrieverName: runInfo?.name
            },
            { tags }
        );
    } catch (e) {
        console.error("VDR Pipeline Error logging retrieval:", e);
    }
  }

  async handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ) {
    const toolName = runName || (tool.id ? tool.id[tool.id.length - 1] : 'unknown-tool');
    this.runMap.set(runId, { name: toolName, type: 'tool', input });

    let args: any;
    try {
        args = typeof input === 'string' && input.startsWith('{') ? JSON.parse(input) : { input };
    } catch {
        args = { input };
    }

    try {
        await this.pipeline.logToolCall(
            {
                toolName,
                arguments: args,
                toolId: runId
            },
            { tags }
        );
    } catch (e) {
        console.error("VDR Pipeline Error logging tool call:", e);
    }
  }

  async handleToolEnd(output: any, runId: string, parentRunId?: string, tags?: string[]) {
    const runInfo = this.runMap.get(runId);
    
    try {
        await this.pipeline.logToolResult(
            {
                toolName: runInfo?.name || 'unknown',
                toolId: runId,
                result: typeof output === 'string' ? output : JSON.stringify(output)
            },
            { tags }
        );
    } catch (e) {
        console.error("VDR Pipeline Error logging tool result:", e);
    }
  }

  async handleAgentAction(action: AgentAction, runId: string, parentRunId?: string, tags?: string[]) {
    try {
        await this.pipeline.logRouting(
            {
                decision: action.tool,
                reason: action.log
            },
            { tags }
        );
    } catch (e) {
        console.error("VDR Pipeline Error logging routing:", e);
    }
  }

  async handleChainStart(
    chain: Serialized,
    inputs: Record<string, any>,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runType?: string,
    runName?: string
  ) {
    const chainName = runName || (chain.id ? chain.id[chain.id.length - 1] : 'chain');
    
    // We want to avoid logging every internal sub-chain (like llm wrappers), mostly want higher level
    if (runType !== 'llm') {
        const inputStr = inputs?.query || inputs?.input || JSON.stringify(inputs);
        this.runMap.set(runId, { name: chainName, type: runType || 'chain', input: inputStr });
        
        try {
            await this.pipeline.logCustom(
                'CHAIN_START',
                {
                    chainName,
                    inputs: Object.keys(inputs || {})
                },
                { tags }
            );
        } catch (e) {
            console.error("VDR Pipeline Error logging chain start:", e);
        }
    }
  }

  async handleChainEnd(outputs: Record<string, any>, runId: string, parentRunId?: string, tags?: string[]) {
    const runInfo = this.runMap.get(runId);
    
    if (runInfo && runInfo.type !== 'llm') {
        try {
            await this.pipeline.logCustom(
                'CHAIN_END',
                {
                    chainName: runInfo.name,
                    outputs: outputs && typeof outputs === 'object' ? Object.keys(outputs) : undefined
                },
                { tags }
            );
        } catch (e) {
            console.error("VDR Pipeline Error logging chain end:", e);
        }
    }
  }
}
