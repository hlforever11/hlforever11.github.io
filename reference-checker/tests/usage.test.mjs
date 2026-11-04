import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserApi } from './browser-api.mjs';
const pause = () => new Promise(resolve => setImmediate(resolve));
test('网站和小程序共用相同的匿名上报与断网队列实现', () => {
  assert.equal(readFileSync(new URL('../usage-client.js', import.meta.url), 'utf8'), readFileSync(new URL('../../reference-checker-miniprogram/miniprogram/utils/usage.js', import.meta.url), 'utf8'));
});
test('网站缓存返回也上报条次，重开同一条文献的新一轮分别计数，页面无新统计展示', async () => {
  const packets = [];
  const { api, context, nodes } = browserApi(async (url, options) => {
    const p = JSON.parse(options.body); packets.push(p);
    return { ok: true, json: async () => ({ ok: true, kind: 'wenzheng-usage-v1', acknowledged: p.items.map(i => i.index) }) };
  });
  context.window.WENZHENG_API_URL = 'https://example.org';
  const raw = '[1] SMITH J. Example[J]. Review, 2024, 1(1):1-8.';
  api.rememberVerification(raw, { status: 'verified', confidence: .99, authenticityConfidence: .99, differences: [], canonical: raw });
  nodes.get('#input').value = raw;
  await nodes.get('#verifyBtn').onclick();
  await new Promise(resolve => setTimeout(resolve, 300)); await pause();
  await nodes.get('#verifyBtn').onclick();
  await new Promise(resolve => setTimeout(resolve, 300)); await pause();
  assert.equal(packets.length, 2); assert.equal(packets[0].platform, 'website'); assert.equal(packets[0].items.length, 1);
  assert.equal(packets[0].items[0].cached, true); assert.notEqual(packets[0].batchId, packets[1].batchId);
  assert.doesNotMatch(JSON.stringify(packets), /SMITH|Review|reference"|submitted/);
  assert.equal(nodes.get('#results').innerHTML, '');
});
