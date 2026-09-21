import type { VercelRequest, VercelResponse } from '@vercel/node';

const allowedMethods = new Set(['GET', 'HEAD']);

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const backendUrl = process.env.API_BACKEND_URL?.replace(/\/$/, '');
  const token = process.env.API_AUTH_TOKEN;
  if (!backendUrl || !token) return response.status(503).json({ message: 'Remote API is not configured.' });
  if (!allowedMethods.has(request.method ?? 'GET')) {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).json({ message: 'Method not allowed.' });
  }

  const requestUrl = new URL(request.url ?? '/api', 'https://vercel.local');
  if (!requestUrl.pathname.startsWith('/api/')) return response.status(404).json({ message: 'Not found.' });
  const targetUrl = `${backendUrl}${requestUrl.pathname}${requestUrl.search}`;
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (typeof request.headers.origin === 'string') headers.set('Origin', request.headers.origin);

  try {
    const upstream = await fetch(targetUrl, { method: request.method, headers });
    const contentType = upstream.headers.get('content-type');
    if (contentType) response.setHeader('content-type', contentType);
    // Diagnostics responses are live system state and must never be cached by the platform or a proxy.
    response.setHeader('Cache-Control', 'no-store');
    return response.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    return response.status(502).json({ message: 'Remote API is unavailable.' });
  }
}
