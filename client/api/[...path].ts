import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const backendUrl = process.env.API_BACKEND_URL?.replace(/\/$/, '');
  const token = process.env.API_AUTH_TOKEN;
  if (!backendUrl || !token) return response.status(503).json({ message: 'Remote API is not configured.' });

  const requestUrl = new URL(request.url ?? '/api', 'https://vercel.local');
  const targetUrl = `${backendUrl}${requestUrl.pathname}${requestUrl.search}`;
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (typeof request.headers.origin === 'string') headers.set('Origin', request.headers.origin);

  try {
    const upstream = await fetch(targetUrl, { method: request.method, headers });
    const contentType = upstream.headers.get('content-type');
    if (contentType) response.setHeader('content-type', contentType);
    return response.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    return response.status(502).json({ message: 'Remote API is unavailable.' });
  }
}
