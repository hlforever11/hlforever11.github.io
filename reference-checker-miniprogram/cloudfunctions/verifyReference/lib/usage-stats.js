const crypto = require('node:crypto');
const KIND = 'wenzheng-usage-v1';
const COLLECTION = 'verification_usage';
const TOTALS_ID = 'totals-v1';
const STATUSES = ['verified', 'partial', 'corrected', 'review', 'unverified', 'error'];
const missing = error => /DOCUMENT_NOT_EXIST|COLLECTION_NOT_EXIST|not.?exist|not.?found|不存在/i.test(String(error?.errCode || error?.code || '') + ' ' + String(error?.message || ''));

async function readDoc(ref) {
  try { const r = await ref.get(); return Array.isArray(r.data) ? r.data[0] || null : r.data || null; }
  catch (error) { if (missing(error)) return null; throw error; }
}
function counter(value) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) throw Error('Invalid stored usage counter');
  return value;
}
function platformTotals(old = {}) {
  return { checked: counter(old.checked), errors: counter(old.errors), cacheHits: counter(old.cacheHits), batches: counter(old.batches),
    byStatus: Object.fromEntries(STATUSES.map(s => [s, counter(old.byStatus?.[s])])) };
}
function normalizedBatch(payload) {
  if (!['website', 'miniprogram'].includes(payload.platform)) throw Error('Invalid platform');
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(payload.batchId || '')) throw Error('Invalid batch ID');
  if (!Number.isSafeInteger(payload.createdAt) || payload.createdAt < 946684800000 || payload.createdAt > Date.now() + 86400000) throw Error('Invalid batch time');
  if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 20) throw Error('Invalid item count');
  const seen = new Set();
  const items = payload.items.map(item => {
    if (!Number.isInteger(item?.index) || item.index < 0 || item.index >= 20 || !STATUSES.includes(item.status) || seen.has(item.index)) throw Error('Invalid usage item');
    seen.add(item.index);
    return { index: item.index, status: item.status, cached: item.cached === true };
  });
  // Do not persist reference text, author, URL, OpenID, IP or any supplied extra fields.
  return { platform: payload.platform, batchId: payload.batchId, createdAt: payload.createdAt, items };
}

function createUsageStore(db) {
  let ready;
  async function ensureCollection() {
    if (!ready) ready = (async () => {
      if (typeof db.createCollection === 'function') {
        try { await db.createCollection(COLLECTION); }
        catch (error) { if (!/already.?exist|COLLECTION_EXIST|已存在/i.test(String(error?.errCode || error?.code || '') + ' ' + error.message)) throw error; }
      }
    })().catch(error => { ready = null; throw error; });
    return ready;
  }
  async function record(payload) {
    const batch = normalizedBatch(payload);
    await ensureCollection();
    const id = 'batch-' + crypto.createHash('sha256').update(batch.platform + ':' + batch.batchId).digest('hex');
    const now = Date.now();
    const response = await db.runTransaction(async tx => {
      const root = tx.collection(COLLECTION).doc(TOTALS_ID);
      const receipt = tx.collection(COLLECTION).doc(id);
      const previous = await readDoc(receipt);
      const old = await readDoc(root);
      if (old && old.schemaVersion !== 1) throw Error('Unknown usage schema');
      const totals = { schemaVersion: 1, startedAt: old?.startedAt || now, updatedAt: now,
        website: platformTotals(old?.website), miniprogram: platformTotals(old?.miniprogram) };
      const saved = { ...(previous?.items || {}) };
      const target = totals[batch.platform];
      let added = 0;
      for (const item of batch.items) {
        if (Object.prototype.hasOwnProperty.call(saved, item.index)) continue;
        saved[item.index] = { status: item.status, cached: item.cached };
        target.byStatus[item.status]++;
        if (item.status === 'error') target.errors++; else target.checked++;
        if (item.cached && item.status !== 'error') target.cacheHits++;
        added++;
      }
      if (added) {
        if (!previous) target.batches++;
        for (const p of ['website', 'miniprogram']) platformTotals(totals[p]);
        counter(totals.website.checked + totals.miniprogram.checked);
        await receipt.set({ data: { platform: batch.platform, createdAt: previous?.createdAt || batch.createdAt,
          firstReceivedAt: previous?.firstReceivedAt || now, updatedAt: now, items: saved } });
        await root.set({ data: totals });
      }
      return { ok: true, kind: KIND, added, acknowledged: batch.items.map(i => i.index) };
    });
    return response.result || response;
  }
  async function read() {
    // Read-only: never initializes, creates, increments or imports a counter.
    const old = await readDoc(db.collection(COLLECTION).doc(TOTALS_ID));
    const website = platformTotals(old?.website), miniprogram = platformTotals(old?.miniprogram);
    const total = counter(website.checked + miniprogram.checked);
    return { ok: true, kind: KIND, initialized: Boolean(old), startedAt: old?.startedAt || null,
      updatedAt: old?.updatedAt || null, website, miniprogram, total,
      historicalTotal: null, unit: 'reference-check occasions',
      scope: 'Received completion reports since tracking was enabled; repeated user runs count again; retries of the same batch item do not. Errors are separate. Historical lifetime total remains unknown.' };
  }
  async function retainedHistory(before) {
    const $ = db.command.aggregate;
    const result = await db.collection('verification_history').aggregate()
      .match({ createdAt: db.command.lt(before || Date.now()) })
      .group({ _id: null, referenceSlots: $.sum('$referenceCount'), batches: $.sum(1), earliest: $.min('$createdAt'), latest: $.max('$createdAt') }).end();
    const row = (result.list || result.data || [])[0] || {};
    return { referenceSlots: counter(row.referenceSlots), batches: counter(row.batches), earliest: row.earliest || null, latest: row.latest || null,
      scope: 'Only currently retained opt-in mini-program history before the cutoff, including failed-result slots; never added to measured totals.' };
  }
  return { record, read, retainedHistory };
}

let runtime;
function validateReporter(payload, { http, origin = '', nativeOpenId = '' }) {
  if (http) {
    if (origin !== 'https://hlforever11.github.io' || payload.platform !== 'website') throw Error('Invalid website reporting origin');
  } else if (!nativeOpenId || payload.platform !== 'miniprogram') throw Error('Invalid mini-program report');
}
function getRuntime() {
  if (!runtime) {
    const cloud = require('wx-server-sdk');
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
    runtime = { cloud, store: createUsageStore(cloud.database()) };
  }
  return runtime;
}
async function handleUsage(payload, { http, origin = '' }) {
  if (!['usage.read', 'usage.record', 'usage.retainedHistory'].includes(payload.action)) return null;
  const { cloud, store } = getRuntime();
  if (payload.action === 'usage.read') return store.read();
  if (payload.action === 'usage.retainedHistory') {
    const snapshot = await store.read();
    return { ok: true, kind: KIND, measured: snapshot, retainedHistory: await store.retainedHistory(snapshot.startedAt) };
  }
  validateReporter(payload, { http, origin, nativeOpenId: http ? '' : cloud.getWXContext().OPENID });
  return store.record(payload);
}
module.exports = { createUsageStore, normalizedBatch, validateReporter, handleUsage, KIND, COLLECTION, TOTALS_ID };
