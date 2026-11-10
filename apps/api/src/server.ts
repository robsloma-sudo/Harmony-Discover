import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { observationRoutes } from './routes/observations.js';
import { learningRoutes } from './routes/learning.js';

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
await app.register(helmet);
await app.register(cors, { origin: false }); // Set an explicit app origin allow-list before deployment.
await app.register(rateLimit, { max: 60, timeWindow: '1 minute' });
await app.register(multipart, { limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024, files: 10 } });
app.get('/health', async () => ({ ok: true, service: 'harmony-discover-api', mode: 'development-scaffold' }));
await app.register(observationRoutes, { prefix: '/v1/observations' });
await app.register(learningRoutes, { prefix: '/v1/learning' });

const port = Number(process.env.PORT || 8787);
await app.listen({ port, host: '0.0.0.0' });
