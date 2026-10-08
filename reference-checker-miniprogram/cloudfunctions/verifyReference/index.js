const { verifyReference, normalizeText } = require("./lib/core");

const FUNCTION_BUILD = "2026.10.08-12";
const RESULT_CACHE = new Map();
const RESULT_CACHE_LIMIT = 300;
const RESULT_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const CORS_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

function isHttpEvent(event) {
  return Boolean(
    event?.httpMethod ||
    event?.requestContext ||
    Object.prototype.hasOwnProperty.call(event || {}, "isBase64Encoded")
  );
}

function eventPayload(event) {
  if (!isHttpEvent(event)) return event || {};
  if (!event?.body) return {};
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    return typeof body === "string" ? JSON.parse(body) : body;
  } catch (error) {
    return {};
  }
}

function httpResponse(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}

function withBuild(result) {
  return { ...result, build: FUNCTION_BUILD };
}

function cacheKey(reference) {
  return normalizeText(reference);
}

function cachedResult(reference) {
  const key = cacheKey(reference);
  const cached = RESULT_CACHE.get(key);
  if (!cached) return null;
  if (Date.now() - cached.storedAt > RESULT_CACHE_TTL) {
    RESULT_CACHE.delete(key);
    return null;
  }
  // 刷新 LRU 顺序。缓存仅存储已由公开来源确认的结果，不缓存失败。
  RESULT_CACHE.delete(key);
  RESULT_CACHE.set(key, cached);
  return {
    ...cached.result,
    submitted: reference,
    cacheHit: true,
    note: `已复用本云函数实例最近一次成功核验的公开书目证据。${cached.result.note || ""}`
  };
}

function rememberResult(reference, result) {
  const confidence = Number(
    result?.authenticityConfidence ?? result?.confidence ?? 0
  );
  if (
    !["verified", "partial", "corrected"].includes(result?.status) ||
    confidence < 0.8
  ) {
    return;
  }
  const key = cacheKey(reference);
  RESULT_CACHE.delete(key);
  RESULT_CACHE.set(key, {
    storedAt: Date.now(),
    result: { ...result, submitted: "" }
  });
  while (RESULT_CACHE.size > RESULT_CACHE_LIMIT) {
    RESULT_CACHE.delete(RESULT_CACHE.keys().next().value);
  }
}

exports.main = async (event) => {
  const http = isHttpEvent(event);
  if (http && String(event.httpMethod || "").toUpperCase() === "OPTIONS") {
    return httpResponse(204, {});
  }
  const payload = eventPayload(event);
  const reference = String(payload?.reference || "").replace(/\s+/g, " ").trim();
  if (!reference) {
    const result = withBuild({
      status: "error",
      confidence: 0,
      submitted: "",
      differences: [],
      note: "没有收到参考文献内容。",
      evidenceLinks: []
    });
    return http ? httpResponse(400, result) : result;
  }
  if (reference.length > 5000) {
    const result = withBuild({
      status: "error",
      confidence: 0,
      submitted: reference.slice(0, 5000),
      differences: [],
      note: "单条参考文献内容过长，无法核验。",
      evidenceLinks: []
    });
    return http ? httpResponse(413, result) : result;
  }

  try {
    const reused = cachedResult(reference);
    const verified = reused || await verifyReference(reference);
    if (!reused) rememberResult(reference, verified);
    const result = withBuild(verified);
    return http ? httpResponse(200, result) : result;
  } catch (error) {
    console.error("verifyReference failed", error);
    const result = withBuild({
      status: "error",
      confidence: 0,
      submitted: reference,
      differences: [],
      note: `核验服务发生错误：${error?.message || "未知错误"}。请稍后重试。`,
      evidenceLinks: []
    });
    return http ? httpResponse(500, result) : result;
  }
};
