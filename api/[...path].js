// Same-origin Supabase proxy for RUSTOCK on Vercel.
// No secret service-role key is used or exposed.
const UPSTREAM = 'https://spocaiwbpxwwfymmhdon.supabase.co';
const PREFIXES = ['rest/v1/', 'auth/v1/', 'storage/v1/'];
const HOP = new Set(['host','connection','content-length','transfer-encoding','keep-alive','upgrade','proxy-authorization','proxy-authenticate','te','trailer','cookie']);

export default async function handler(req, res) {
  const pathname = new URL(req.url, 'https://example.invalid').pathname;
  const path = pathname.replace(/^\/api\/?/, '');
  if (!PREFIXES.some(p => path.startsWith(p))) return res.status(404).json({message:'Not found'});
  if (req.method === 'OPTIONS') return res.status(204).end();
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP.has(key.toLowerCase()) && value !== undefined) headers[key] = value;
  }
  delete headers.origin;
  delete headers.referer;
  // Vercel may parse JSON bodies before the function sees them.
  let body;
  if (!['GET','HEAD'].includes(req.method)) {
    if (Buffer.isBuffer(req.body)) body = req.body;
    else if (typeof req.body === 'string') body = req.body;
    else if (req.body !== undefined && req.body !== null) body = JSON.stringify(req.body);
    else {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = Buffer.concat(chunks);
    }
  }
  try {
    const upstream = await fetch(`${UPSTREAM}/${path}${query}`, {
      method: req.method, headers, body, redirect:'manual', signal: AbortSignal.timeout(20000)
    });
    res.status(upstream.status);
    for (const [key, value] of upstream.headers.entries()) {
      if (!['content-encoding','content-length','transfer-encoding','connection','set-cookie'].includes(key.toLowerCase())) res.setHeader(key, value);
    }
    // Browser caching is safe only for public Storage objects; don't cache auth or private data.
    if (req.method === 'GET' && path.startsWith('storage/v1/object/public/') && upstream.ok) {
      res.setHeader('Cache-Control','public, s-maxage=3600, stale-while-revalidate=86400');
    } else {
      res.setHeader('Cache-Control','no-store');
    }
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    res.status(502).json({message:'Upstream unavailable', detail:error?.name === 'TimeoutError' ? 'timeout' : 'network error'});
  }
}
