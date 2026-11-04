import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { AgentState, AgentExecutionContext, SensoryAssessmentInputSchema } from './types.js';

export class AgentMicrokernel {
  private client: Client;
  private transport: StdioClientTransport | null = null;

  constructor() {
    this.client = new Client(
      { name: 'microkernel-orchestrator', version: '1.0.0' },
      { capabilities: {} }
    );
  }

  public async initialize(): Promise<void> {
    // Spawns the MCP Server in an isolated Node child-process communicating via stdio
    this.transport = new StdioClientTransport({
      command: 'node',
      args: ['./dist/mcp-server.js']
    });
    await this.client.connect(this.transport);
  }

  public async executePipeline(rawInput: unknown): Promise<AgentExecutionContext> {
    const context: AgentExecutionContext = {
      sessionId: `session_${Date.now()}`,
      currentState: AgentState.IDLE,
      tokenBudget: 4000,
      tokensConsumed: 0,
      payload: {},
      toolResults: [],
      errors: []
    };

    try {
      // Stage 1: Input Hydration & Strict Validation
      context.currentState = AgentState.HYDRATING_INPUT;
      const validatedInput = SensoryAssessmentInputSchema.parse(rawInput);
      context.payload = validatedInput;
      context.tokensConsumed += 150; // Ingress cost accounting

      // Stage 2 & 3: Context Assembly & MCP Tool Dispatching
      context.currentState = AgentState.QUERYING_MCP;
      const toolCallResult = await this.client.callTool({
        name: 'forecast_sensory_escalation',
        arguments: {
          ambientNoiseDecibels: validatedInput.ambientNoiseDecibels,
          lightingLux: validatedInput.lightingLux,
          timeSinceLastMealMinutes: validatedInput.timeSinceLastMealMinutes,
          sugarIntakeGrams: validatedInput.sugarIntakeGrams
        }
      });

      context.tokensConsumed += 350;
      context.toolResults.push({
        tool: 'forecast_sensory_escalation',
        result: toolCallResult.content
      });

      // Stage 4: Assertion Verification Gate (Zero Hallucination / Zero Out-of-Bounds Drift)
   context.currentState = AgentState.EVALUATING_ASSERTIONS;

      const content = toolCallResult.content as Array<{ type: string; text?: string }>;
      const firstEntry = content?.[0];

      if (!firstEntry || typeof firstEntry.text !== 'string') {
        throw new Error('Invalid MCP tool response format: expected text content block');
      }

      const parsedData = JSON.parse(firstEntry.text);

      if (typeof parsedData.riskScore !== 'number' || parsedData.riskScore < 0) {
        throw new Error('Assertion failed: Invalid riskScore returned by MCP server');
      }

      context.currentState = AgentState.COMPLETED;
    } catch (err: unknown) {
      context.currentState = AgentState.FAILED;
      context.errors.push(err instanceof Error ? err.message : String(err));
    }

    return context;
  }

  public async shutdown(): Promise<void> {
    if (this.transport) {
      await this.client.close();
    }
  }
}