const ALLOWED_ORIGIN = 'https://hlforever11.github.io';

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  return origin === ALLOWED_ORIGIN
    ? {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' };
}

export function onRequestGet({ request, env }) {
  return Response.json(
    {
      ok: true,
      service: 'wechat-video-proxy',
      directConfigured: Boolean(String(env.YUANBAO_COOKIE || '').trim()),
    },
    { status: 200, headers: corsHeaders(request) },
  );
}

export function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
