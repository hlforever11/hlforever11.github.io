const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const YUANBAO_PARSE_URL = 'https://yuanbao.tencent.com/api/weixin/get_parse_result';
const CHANNELS_FEED_URL = 'https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info';
const ALLOW_WORKER_FALLBACK = /^(1|true|yes)$/i.test(String(process.env.ALLOW_WORKER_FALLBACK || ''));
const FALLBACK_WORKER = process.env.WORKER_API_URL || 'https://sph.litao.workers.dev/api/fetch_video_profile';

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static('public', { maxAge: '10m' }));

function extractUrl(text = '') {
  const urls = String(text).match(/https?:\/\/[^\s<>"'，。；、）)】]+/gi) || [];
  return urls.find(raw => {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      return host === 'weixin.qq.com' || host === 'channels.weixin.qq.com' || host.endsWith('.weixin.qq.com');
    } catch { return false; }
  }) || '';
}

function rid() {
  return `${Math.floor(Date.now() / 1000).toString(16)}-${crypto.randomBytes(4).toString('hex')}`;
}

async function directParse(shareUrl, cookie) {
  const r1 = await fetch(YUANBAO_PARSE_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      origin: 'https://yuanbao.tencent.com',
      referer: 'https://yuanbao.tencent.com/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      cookie
    },
    body: JSON.stringify({ type: 'video_channel_url', url: shareUrl, scene: 1 })
  });

  if (!r1.ok) throw new Error(`腾讯解析接口错误（HTTP ${r1.status}）`);
  const parsed = await r1.json();
  const data = parsed && parsed.data;
  if (!data) throw new Error('腾讯解析接口没有返回有效数据，请更新服务器端授权信息。');

  let exportId = data.wx_export_id || '';
  let token = '';
  if (data.playable_url) {
    try {
      const u = new URL(data.playable_url);
      token = u.searchParams.get('token') || '';
      exportId = u.searchParams.get('eid') || exportId;
    } catch {}
  }
  if (!exportId) throw new Error('没有取得视频标识，请更新服务器端授权信息。');

  const apiUrl = `${CHANNELS_FEED_URL}?_rid=${encodeURIComponent(rid())}&_pageUrl=${encodeURIComponent('https://channels.weixin.qq.com/finder-preview/pages/feed')}`;
  const referer = `https://channels.weixin.qq.com/finder-preview/pages/feed?entry_card_type=48&comment_scene=39&appid=0&token=${encodeURIComponent(token)}&entry_scene=0&eid=${encodeURIComponent(exportId)}`;

  const r2 = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      origin: 'https://channels.weixin.qq.com',
      referer,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36'
    },
    body: JSON.stringify({ baseReq: { generalToken: token }, exportId })
  });

  if (!r2.ok) throw new Error(`视频号接口错误（HTTP ${r2.status}）`);
  const result = await r2.json();
  if (result.errCode !== 0 || !result.data) {
    throw new Error(result.errMsg || '视频号接口没有返回有效数据。');
  }
  return result.data;
}

async function workerParse(shareUrl) {
  const r = await fetch(FALLBACK_WORKER, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ url: shareUrl })
  });
  if (!r.ok) throw new Error(`备用解析服务错误（HTTP ${r.status}）`);
  const j = await r.json();
  if (j.errCode !== 0 || !j.data) throw new Error(j.errMsg || '备用解析失败。');
  return j.data;
}

function normalize(data) {
  const feed = data.feedInfo || {};
  const author = data.authorInfo || {};
  const h264 = feed.h264VideoInfo || {};
  const h265 = feed.h265VideoInfo || {};
  const videoUrl = h264.videoUrl || feed.videoUrl || h265.videoUrl || '';
  if (!videoUrl) throw new Error('已经取得视频信息，但没有找到视频直链。');
  const desc = String(feed.description || '').trim();
  return {
    title: desc ? desc.split('\n')[0].slice(0, 100) : '微信视频号视频',
    author: author.nickname || '',
    cover: feed.coverUrl || h264.coverUrl || h265.coverUrl || '',
    videoUrl,
    codec: h264.videoUrl ? 'H.264 / MP4' : (h265.videoUrl && !feed.videoUrl ? 'H.265 / MP4' : 'MP4')
  };
}

app.post('/api/parse', async (req, res) => {
  const shareUrl = extractUrl(req.body && (req.body.url || req.body.input || ''));
  if (!shareUrl) {
    return res.status(400).json({ ok: false, message: '没有识别到有效的视频号分享链接。' });
  }

  const cookie = String(process.env.YUANBAO_COOKIE || '').trim();
  try {
    let data;
    let mode;

    if (cookie) {
      data = await directParse(shareUrl, cookie);
      mode = 'tencent-direct';
    } else if (ALLOW_WORKER_FALLBACK) {
      data = await workerParse(shareUrl);
      mode = 'worker-fallback';
    } else {
      return res.status(503).json({
        ok: false,
        message: '国内解析服务尚未配置服务器端授权信息，请管理员完成 YUANBAO_COOKIE 配置。'
      });
    }

    return res.json({ ok: true, mode, video: normalize(data) });
  } catch (e) {
    return res.status(502).json({ ok: false, message: e.message || '解析失败，请稍后再试。' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'wechat-video-downloader-cn',
    directConfigured: Boolean(String(process.env.YUANBAO_COOKIE || '').trim()),
    workerFallback: ALLOW_WORKER_FALLBACK
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`wechat-video-downloader-cn listening on ${PORT}`);
});
