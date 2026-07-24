const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const USERS = "reference_users";
const HISTORY = "verification_history";
const MAX_HISTORY = 50;
const MAX_INPUT_LENGTH = 60000;

function text(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
}

function cleanDifference(item) {
  return {
    field: text(item?.field, 80),
    submitted: text(item?.submitted, 1000),
    verified: text(item?.verified, 1000)
  };
}

function cleanResult(item) {
  const status = ["verified", "partial", "corrected", "review", "unverified", "error"].includes(item?.status)
    ? item.status
    : "error";
  return {
    submitted: text(item?.submitted, 5000),
    status,
    confidence: Math.max(0, Math.min(1, Number(item?.confidence || 0))),
    note: text(item?.note, 3000),
    canonical: text(item?.canonical, 5000),
    source: text(item?.source, 200),
    sourceUrl: text(item?.sourceUrl, 3000),
    differences: Array.isArray(item?.differences)
      ? item.differences.slice(0, 20).map(cleanDifference)
      : []
  };
}

function summarize(results) {
  const summary = { confirmed: 0, corrected: 0, review: 0, unresolved: 0 };
  results.forEach((item) => {
    if (item.status === "verified" || item.status === "partial") summary.confirmed += 1;
    else if (item.status === "corrected") summary.corrected += 1;
    else if (item.status === "review") summary.review += 1;
    else summary.unresolved += 1;
  });
  return summary;
}

async function recordsFor(owner) {
  const response = await db.collection(HISTORY)
    .where({ owner })
    .limit(100)
    .get();
  return response.data.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

async function ensureUser(owner, appid) {
  const found = await db.collection(USERS).where({ owner }).limit(1).get();
  const now = Date.now();
  if (found.data.length) {
    await db.collection(USERS).doc(found.data[0]._id).update({
      data: { lastActiveAt: now, appid }
    });
    return found.data[0]._id;
  }
  const created = await db.collection(USERS).add({
    data: {
      owner,
      appid,
      createdAt: now,
      lastActiveAt: now
    }
  });
  return created._id;
}

exports.main = async (event = {}) => {
  const context = cloud.getWXContext();
  const owner = context.OPENID;
  if (!owner) return { ok: false, message: "未能识别当前微信身份。" };

  const action = text(event.action, 30);

  try {
    if (action === "login") {
      await ensureUser(owner, context.APPID || "");
      const records = await recordsFor(owner);
      return { ok: true, historyCount: records.length };
    }

    if (action === "save") {
      await ensureUser(owner, context.APPID || "");
      const input = text(event.input, MAX_INPUT_LENGTH);
      const results = Array.isArray(event.results)
        ? event.results.slice(0, 20).map(cleanResult)
        : [];
      if (!input || !results.length) return { ok: false, message: "没有可保存的核验结果。" };

      const createdAt = Date.now();
      await db.collection(HISTORY).add({
        data: {
          owner,
          input,
          preview: input.slice(0, 360),
          referenceCount: results.length,
          summary: summarize(results),
          results,
          createdAt
        }
      });

      const records = await recordsFor(owner);
      const overflow = records.slice(MAX_HISTORY);
      await Promise.all(overflow.map((item) => db.collection(HISTORY).doc(item._id).remove()));
      return { ok: true, total: Math.min(records.length, MAX_HISTORY) };
    }

    if (action === "list") {
      const records = await recordsFor(owner);
      return {
        ok: true,
        total: records.length,
        records: records.slice(0, MAX_HISTORY).map((item) => ({
          _id: item._id,
          input: item.input,
          preview: item.preview,
          referenceCount: item.referenceCount,
          summary: item.summary,
          createdAt: item.createdAt
        }))
      };
    }

    if (action === "remove") {
      const id = text(event.id, 100);
      if (!id) return { ok: false, message: "记录编号无效。" };
      const found = await db.collection(HISTORY).doc(id).get();
      if (!found.data || found.data.owner !== owner) {
        return { ok: false, message: "记录不存在或无权删除。" };
      }
      await db.collection(HISTORY).doc(id).remove();
      return { ok: true };
    }

    if (action === "clear") {
      const records = await recordsFor(owner);
      await Promise.all(records.map((item) => db.collection(HISTORY).doc(item._id).remove()));
      return { ok: true };
    }

    return { ok: false, message: "不支持的操作。" };
  } catch (error) {
    console.error("userHistory failed", { action, error });
    return {
      ok: false,
      message: "历史记录服务暂时不可用，请稍后重试。"
    };
  }
};
