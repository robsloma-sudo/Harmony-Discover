import type { FastifyRequest } from 'fastify';
import { db } from './supabase.js';

// Scaffold only: production readiness requires JWT verification, abuse controls,
// anonymous-user lifecycle rules, and rate limits by verified identity/device.
export async function requireConsumerId(request: FastifyRequest): Promise<string> {
  const auth = request.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    const error = new Error('Authentication required for this endpoint');
    (error as any).statusCode = 401;
    throw error;
  }
  const token = auth.slice(7);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) {
    const invalid = new Error('Invalid access token');
    (invalid as any).statusCode = 401;
    throw invalid;
  }
  return data.user.id;
}
