const ALLOWED_ORIGIN = 'https://hlforever11.github.io';
const ALLOWED_HOSTS = ['weixin.qq.com', 'channels.weixin.qq.com'];
const MAX_BODY_BYTES = 32 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const YUANBAO_API = 'https://yuanbao.tencent.com/api/weixin/get_parse_result';
const FEED_API = 'https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  return origin === ALLOWED_ORIGIN
    ? {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' };
}

function json(request, status, body) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

function isAllowedHost(hostname) {
  const host = hostname.toLowerCase();
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function extractShareUrl(value) {
  if (typeof value !== 'string') return '';
  const matches = value.match(/https:\/\/[^\s<>"']+/gi) || [];
  for (const raw of matches) {
    try {
      const url = new URL(raw.replace(/[，。；、）)]+$/g, ''));
      if (url.protocol === 'https:' && isAllowedHost(url.hostname)) return url.toString();
    } catch {
      // Continue looking for a valid URL.
    }
  }
  return '';
}

function generateRid() {
  const timestamp = Math.floor(Date.now() / 1000).toString(16);
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${timestamp}-${random}`;
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseWithYuanbao(shareUrl, cookie) {
  const response = await fetchWithTimeout(YUANBAO_API, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Content-Type': 'application/json',
      Origin: 'https://yuanbao.tencent.com',
      Referer: 'https://yuanbao.tencent.com/',
      'User-Agent': USER_AGENT,
      'Sec-CH-UA': '"Chromium";v="140", "Google Chrome";v="140", "Not_A Brand";v="99"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Source': 'web',
      'X-Language': 'zh-CN',
      'X-Web-Third-Source': 'main',
      Cookie: cookie,
    },
    body: JSON.stringify({ type: 'video_channel_url', url: shareUrl, scene: 1 }),
  });

  const result = await response.json().catch(() => null);
  const data = result && typeof result.data === 'object' ? result.data : null;
  console.log(
    JSON.stringify({
      stage: 'yuanbao',
      status: response.status,
      code: result && result.code,
      hasData: Boolean(data),
      hasPlayable: Boolean(data && data.playable_url),
      hasExport: Boolean(data && data.wx_export_id),
    }),
  );

  if (!response.ok || !result || result.code !== 0 || !data || !data.playable_url) {
    throw new Error('yuanbao_failed');
  }

  let token = '';
  let exportId = data.wx_export_id || '';
  try {
    const playableUrl = new URL(data.playable_url);
    token = playableUrl.searchParams.get('token') || '';
    exportId = playableUrl.searchParams.get('eid') || exportId;
  } catch {
    throw new Error('playable_url_invalid');
  }
  if (!token || !exportId) throw new Error('parse_identifiers_missing');
  return { token, exportId };
}

async function getFeedInfo(token, exportId) {
  const rid = generateRid();
  const pageUrl = 'https://channels.weixin.qq.com/finder-preview/pages/feed';
  const apiUrl = `${FEED_API}?_rid=${encodeURIComponent(rid)}&_pageUrl=${encodeURIComponent(pageUrl)}`;
  const referer =
    `${pageUrl}?entry_card_type=48&comment_scene=39&appid=0` +
    `&token=${encodeURIComponent(token)}&entry_scene=0&eid=${encodeURIComponent(exportId)}`;
  const response = await fetchWithTimeout(apiUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Content-Type': 'application/json',
      Origin: 'https://channels.weixin.qq.com',
      Referer: referer,
      'User-Agent': USER_AGENT,
      'Sec-CH-UA': '"Chromium";v="140", "Google Chrome";v="140", "Not_A Brand";v="99"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    },
    body: JSON.stringify({ baseReq: { generalToken: token }, exportId }),
  });
  const result = await response.json().catch(() => null);
  console.log(
    JSON.stringify({
      stage: 'feed',
      status: response.status,
      code: result && result.errCode,
      hasData: Boolean(result && result.data),
      hasFeed: Boolean(result && result.data && result.data.feedInfo),
    }),
  );
  if (!response.ok || !result || result.errCode !== 0 || !result.data) {
    throw new Error('feed_failed');
  }
  return result.data;
}

function normalizeVideo(data) {
  const feed = data.feedInfo || {};
  const author = data.authorInfo || {};
  const h264 = feed.h264VideoInfo || {};
  const h265 = feed.h265VideoInfo || {};
  const videoUrl = h264.videoUrl || feed.videoUrl || h265.videoUrl || '';
  if (!videoUrl) throw new Error('video_url_missing');
  const description = String(feed.description || '').trim();
  return {
    title: description ? description.split('\n')[0].slice(0, 100) : '微信视频号视频',
    author: author.nickname || '',
    cover: feed.coverUrl || h264.coverUrl || h265.coverUrl || '',
    videoUrl,
    codec: h264.videoUrl ? 'H.264 / MP4' : h265.videoUrl && !feed.videoUrl ? 'H.265 / MP4' : 'MP4',
  };
}

export async function onRequestPost({ request, env }) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json(request, 413, { ok: false, message: '请求体过大' });
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json(request, 413, { ok: false, message: '请求体过大' });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(request, 400, { ok: false, message: '请求格式不正确' });
  }

  const shareUrl = extractShareUrl(body && body.url);
  if (!shareUrl) {
    return json(request, 400, { ok: false, message: '请输入有效的微信视频号分享链接' });
  }

  const cookie = String(env.YUANBAO_COOKIE || '').trim();
  if (!cookie) {
    return json(request, 503, { ok: false, message: '服务器尚未配置解析授权' });
  }

  try {
    const { token, exportId } = await parseWithYuanbao(shareUrl, cookie);
    const data = await getFeedInfo(token, exportId);
    return json(request, 200, { ok: true, video: normalizeVideo(data) });
  } catch (error) {
    console.log(JSON.stringify({ stage: 'parse', failed: true, type: error && error.name }));
    return json(request, 502, { ok: false, message: '解析失败，请稍后重试' });
  }
}

export function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
