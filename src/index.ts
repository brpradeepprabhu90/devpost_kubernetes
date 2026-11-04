import express, { Request, Response } from 'express';
import { AgentMicrokernel } from './microkernel.js';

const app = express();
app.use(express.json());

const port = process.env.PORT || 8080;
const kernel = new AgentMicrokernel();

// Liveness & Readiness Probes for Kubernetes
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'UP' });
});

app.post('/api/v1/forecast', async (req: Request, res: Response) => {
  const result = await kernel.executePipeline(req.body);

  if (result.currentState === 'FAILED') {
    return res.status(400).json({
      success: false,
      errors: result.errors,
      session: result.sessionId
    });
  }

  return res.status(200).json({
    success: true,
    data: result
  });
});

async function bootstrap() {
  await kernel.initialize();
  app.listen(port, () => {
    console.log(`AI Microkernel running on port ${port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Bootstrap failure:', err);
  process.exit(1);
});