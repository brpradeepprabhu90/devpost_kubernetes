import { z } from 'zod';

export enum AgentState {
  IDLE = 'IDLE',
  HYDRATING_INPUT = 'HYDRATING_INPUT',
  QUERYING_MCP = 'QUERYING_MCP',
  EVALUATING_ASSERTIONS = 'EVALUATING_ASSERTIONS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export interface AgentExecutionContext {
  sessionId: string;
  currentState: AgentState;
  tokenBudget: number;
  tokensConsumed: number;
  payload: Record<string, unknown>;
  toolResults: Array<{ tool: string; result: unknown }>;
  errors: string[];
}

export const SensoryAssessmentInputSchema = z.object({
  ambientNoiseDecibels: z.number().min(0).max(160),
  lightingLux: z.number().min(0).max(100000),
  timeSinceLastMealMinutes: z.number().min(0),
  sugarIntakeGrams: z.number().min(0)
});

export type SensoryAssessmentInput = z.infer<typeof SensoryAssessmentInputSchema>;