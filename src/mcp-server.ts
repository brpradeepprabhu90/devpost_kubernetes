import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'pediatric-sensory-mcp-server',
  version: '1.0.0'
});

// Register Tool: Sensory Escalation Forecaster
server.tool(
  'forecast_sensory_escalation',
  {
    ambientNoiseDecibels: z.number().describe('Ambient noise level in dB'),
    lightingLux: z.number().describe('Ambient illuminance in Lux'),
    timeSinceLastMealMinutes: z.number().describe('Minutes since last nutritional intake'),
    sugarIntakeGrams: z.number().describe('Estimated refined carbohydrates in grams')
  },
  async ({ ambientNoiseDecibels, lightingLux, timeSinceLastMealMinutes, sugarIntakeGrams }) => {
    // Deterministic Domain Calculation: Environmental Distress Index (EDI)
    let riskScore = 0;
    
    if (ambientNoiseDecibels > 75) riskScore += 40;
    else if (ambientNoiseDecibels > 60) riskScore += 20;

    if (lightingLux > 1000 || lightingLux < 50) riskScore += 15;
    if (timeSinceLastMealMinutes > 180) riskScore += 25; // Hypoglycemia vulnerability
    if (sugarIntakeGrams > 25) riskScore += 20;

    const riskLevel = riskScore >= 60 ? 'HIGH' : riskScore >= 35 ? 'MODERATE' : 'LOW';

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            riskScore,
            riskLevel,
            recommendedAction: riskLevel === 'HIGH' 
              ? 'Initiate proactive de-escalation: reduce auditory stimuli and offer complex carbohydrate snack.'
              : 'Maintain baseline environment. Sensory thresholds within safety bounds.'
          })
        }
      ]
    };
  }
);

// Register Tool: Nutrition Variance Checker
server.tool(
  'check_nutritional_variance',
  {
    mealId: z.string(),
    proteinGrams: z.number(),
    fiberGrams: z.number()
  },
  async ({ mealId, proteinGrams, fiberGrams }) => {
    const isSufficient = proteinGrams >= 10 && fiberGrams >= 5;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            mealId,
            neuroNutritionalStatus: isSufficient ? 'STABLE' : 'DEFICIT_RISK',
            stabilizationScore: (proteinGrams * 2) + (fiberGrams * 3)
          })
        }
      ]
    };
  }
);

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server listening over stdio');
}

run().catch((error) => {
  console.error('Fatal error in MCP Server:', error);
  process.exit(1);
});