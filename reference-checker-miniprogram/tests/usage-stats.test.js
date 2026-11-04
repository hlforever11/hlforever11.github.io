const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUsageStore, normalizedBatch, validateReporter } = require('../cloudfunctions/verifyReference/lib/usage-stats');
const { createUsageTracker, KEY } = require('../miniprogram/utils/usage');
const { readFileSync } = require('node:fs');
function database() {
  let docs = new Map(), queue = Promise.resolve(), writes = 0, creates = 0, fail = false;
  const collection = (map, countWrites) => name => ({ doc(id) { return {
    async get() { return { data: structuredClone(map.get(name + '/' + id)) }; },
    async set({ data }) { if (fail && id === 'totals-v1') throw Error('database unavailable'); map.set(name + '/' + id, structuredClone(data)); if (countWrites) writes++; }
  }; } });
  const db = { collection: name => collection(docs, false)(name), async createCollection() { creates++; },
    runTransaction(fn) { const job = queue.then(async () => { const next = new Map(structuredClone([...docs])); const result = await fn({ collection: collection(next, true) }); docs = next; return { result }; }); queue = job.catch(() => {}); return job; } };
  return { db, docs: () => docs, counts: () => ({ writes, creates }), fail: value => { fail = value; } };
}
const batch = (id = 'batch_00000000000001', platform = 'website', items = [{ index: 0, status: 'verified', cached: false }]) => ({ batchId: id, platform, createdAt: Date.now(), items });
test('读统计不会创建、写入或虚构历史总数', async () => {
  const mock = database(), store = createUsageStore(mock.db), r = await store.read();
  assert.equal(r.initialized, false); assert.equal(r.historicalTotal, null); assert.equal(r.total, 0);
  assert.deepEqual(mock.counts(), { creates: 0, writes: 0 });
});
test('分平台累计，错误分列，重复批次重试只计一次；缓存结果计入', async () => {
  const mock = database(), store = createUsageStore(mock.db);
  const b = batch(undefined, 'website', [{ index: 0, status: 'verified', cached: true }, { index: 1, status: 'error' }]);
  assert.equal((await store.record(b)).added, 2); assert.equal((await store.record(b)).added, 0);
  await store.record(batch('batch_00000000000002', 'miniprogram', [{ index: 0, status: 'review' }, { index: 1, status: 'unverified' }]));
  const r = await createUsageStore(mock.db).read();
  assert.equal(r.total, 3); assert.equal(r.website.checked, 1); assert.equal(r.website.errors, 1); assert.equal(r.website.cacheHits, 1);
  assert.equal(r.miniprogram.checked, 2); assert.equal(r.website.batches, 1); assert.equal(r.historicalTotal, null);
});
test('停止时已完成部分可记录，晚到或重复槽位不增加；新一轮重复文献计新条次', async () => {
  const mock = database(), store = createUsageStore(mock.db);
  const b = batch(); await store.record(b);
  await store.record({ ...b, items: [{ index: 0, status: 'verified' }, { index: 1, status: 'corrected' }] });
  await store.record(batch('batch_00000000000003'));
  assert.equal((await store.read()).total, 3); assert.equal((await store.read()).website.batches, 2);
});
test('60次并发上报不丢数，重新实例化不会重置已收数据', async () => {
  const mock = database(), store = createUsageStore(mock.db);
  await Promise.all(Array.from({ length: 60 }, (_, i) => store.record(batch('batch_concurrent_' + String(i).padStart(4, '0')))));
  const r = await createUsageStore(mock.db).read(); assert.equal(r.total, 60); assert.equal(r.website.batches, 60);
});
test('事务中途失败不留下去重凭证，重试可完整补记', async () => {
  const mock = database(), store = createUsageStore(mock.db), b = batch(); mock.fail(true);
  await assert.rejects(store.record(b)); assert.equal(mock.docs().size, 0);
  mock.fail(false); await store.record(b); assert.equal((await store.read()).total, 1);
});
test('坏字段和非法槽位整批拒绝；存储中不含题录、OpenID或额外字段', async () => {
  for (const bad of [{ platform: 'other' }, { batchId: 'short' }, { items: [{ index: 20, status: 'verified' }] }, { items: [{ index: 0, status: 'toString' }] }, { items: [{ index: 0, status: 'verified' }, { index: 0, status: 'error' }] }]) assert.throws(() => normalizedBatch({ ...batch(), ...bad }));
  const mock = database(), store = createUsageStore(mock.db);
  await store.record({ ...batch(), reference: 'private title', OPENID: 'private owner', items: [{ index: 0, status: 'verified', reference: 'secret' }] });
  assert.doesNotMatch(JSON.stringify([...mock.docs()]), /private|secret|OPENID|reference/);
});
function tracker(send, storage = new Map()) {
  const timers = new Map(); let n = 0;
  const api = createUsageTracker({ platform: 'website', load: k => storage.get(k), save: (k, v) => storage.set(k, structuredClone(v)), send,
    schedule: fn => { timers.set(++n, fn); return n; }, cancel: id => timers.delete(id) });
  return { api, storage, timers };
}
test('服务失联保留匿名待报队列，重新打开后补报，清空业务历史不影响队列', async () => {
  const one = tracker(async () => { throw Error('offline'); }), b = one.api.newBatch();
  one.api.record(b, 0, { status: 'verified', cacheHit: true, submitted: 'private title' });
  await one.api.flush(); assert.equal(one.api.pendingCount(), 1); assert.doesNotMatch(JSON.stringify(one.storage.get(KEY)), /private|submitted/);
  one.storage.delete('wenzheng-verification-history-v1'); one.api.dispose();
  const mock = database(), store = createUsageStore(mock.db), two = tracker(p => store.record(p), one.storage);
  await two.api.flush(); assert.equal(two.api.pendingCount(), 0); assert.equal((await store.read()).total, 1);
});
test('服务器已提交但回包丢失，再报时不重复计数', async () => {
  const mock = database(), store = createUsageStore(mock.db); let lose = true;
  const t = tracker(async p => { const r = await store.record(p); if (lose) { lose = false; throw Error('lost reply'); } return r; });
  t.api.record(t.api.newBatch(), 0, { status: 'corrected' }); await t.api.flush(); await t.api.flush();
  assert.equal(t.api.pendingCount(), 0); assert.equal((await store.read()).total, 1);
});
test('一批持续完成时，早期回包不删除请求发出后新增的槽位', async () => {
  let finish, packet; const t = tracker(p => { packet = p; return new Promise(resolve => { finish = resolve; }); }), b = t.api.newBatch();
  t.api.record(b, 0, { status: 'verified' }); const first = t.api.flush();
  t.api.record(b, 1, { status: 'review' });
  finish({ ok: true, kind: 'wenzheng-usage-v1', acknowledged: [0] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(packet.items.map(i => i.index), [1]);
  finish({ ok: true, kind: 'wenzheng-usage-v1', acknowledged: [1] }); await first;
  assert.equal(t.api.pendingCount(), 0);
});
test('旧云函数响应不会被误当上报成功，设备存储失败不抛错到核验界面', async () => {
  const t = tracker(async () => ({ status: 'error', note: 'no reference' }));
  t.api.record(t.api.newBatch(), 0, { status: 'unverified' }); await t.api.flush(); assert.equal(t.api.pendingCount(), 1);
  const api = createUsageTracker({ platform: 'website', load() { throw Error('blocked'); }, save() { throw Error('full'); }, send: async () => { throw Error('offline'); }, schedule: () => 1, cancel() {} });
  assert.doesNotThrow(() => api.record(api.newBatch(), 0, { status: 'verified' })); await api.flush(); assert.equal(api.pendingCount(), 1);
});
test('小程序首页模板未增加统计或版本信息', () => {
  const footer = readFileSync(__dirname + '/../miniprogram/pages/index/index.wxml', 'utf8').split('<view class="footer">')[1];
  assert.doesNotMatch(footer, /访问量|累计访问|版本|日期/);
});
test('上报入口区分网站与微信调用，拒绝外站及跨平台冒报', () => {
  assert.doesNotThrow(() => validateReporter({ platform: 'website' }, { http: true, origin: 'https://hlforever11.github.io' }));
  assert.doesNotThrow(() => validateReporter({ platform: 'miniprogram' }, { http: false, nativeOpenId: 'user' }));
  for (const [p, context] of [
    [{ platform: 'website' }, { http: true, origin: 'https://hlforever11.github.io.evil.example' }],
    [{ platform: 'miniprogram' }, { http: true, origin: 'https://hlforever11.github.io' }],
    [{ platform: 'website' }, { http: false, nativeOpenId: 'user' }],
    [{ platform: 'miniprogram' }, { http: false }]
  ]) assert.throws(() => validateReporter(p, context));
});
test('两个离线标签页的待报数据互不覆盖，重开后可全部补报', async () => {
  const storage = new Map(), mock = database(), store = createUsageStore(mock.db);
  function client(send) { return createUsageTracker({ platform: 'website', load: k => storage.get(k), save: (k,v) => storage.set(k, structuredClone(v)),
    list: () => [...storage.keys()], remove: k => storage.delete(k), send, schedule: () => 1, cancel() {} }); }
  const offline = async () => { throw Error('offline'); }, a = client(offline), b = client(offline);
  a.record(a.newBatch(), 0, { status: 'verified' }); b.record(b.newBatch(), 0, { status: 'review' });
  await a.flush(); await b.flush(); assert.equal(storage.size, 2); a.dispose(); b.dispose();
  const reopened = client(p => store.record(p)); await reopened.flush();
  assert.equal((await store.read()).total, 2); assert.equal(storage.size, 0);
});
