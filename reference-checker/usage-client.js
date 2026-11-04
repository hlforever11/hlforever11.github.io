(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WenzhengUsage = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KEY = 'wenzheng-usage-outbox-v1';
  const STATUSES = ['verified', 'partial', 'corrected', 'review', 'unverified', 'error'];
  function createUsageTracker(options) {
    const now = options.now || Date.now;
    const schedule = options.schedule || ((fn, ms) => setTimeout(fn, ms));
    const cancel = options.cancel || clearTimeout;
    const newId = options.newId || (() => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'batch_' + now().toString(36) + '_' + Math.random().toString(36).slice(2) + '_' + Math.random().toString(36).slice(2));
    const granular = typeof options.list === 'function' && typeof options.remove === 'function';
    const prefix = KEY + ':' + options.platform + ':';
    const itemKey = (batch, item) => prefix + batch.batchId + ':' + item.index;
    const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
    let queue = [], timer, running = false, stopped = false, failures = 0;
    try {
      const parsed = granular ? [] : decode(options.load(KEY));
      if (granular) {
        for (const key of options.list().filter(k => k.startsWith(prefix))) {
          try {
            const value = decode(options.load(key));
            if (!value || !value.item || key !== itemKey(value, value.item)) continue;
            let b = parsed.find(b => b.batchId === value.batchId);
            if (!b) { b = { batchId: value.batchId, createdAt: value.createdAt, platform: options.platform, items: [] }; parsed.push(b); }
            b.items.push(value.item);
          } catch (_) {}
        }
      }
      if (Array.isArray(parsed)) queue = parsed.filter(b => /^[A-Za-z0-9_-]{16,100}$/.test(b.batchId) && b.platform === options.platform && Array.isArray(b.items) && Number.isSafeInteger(b.createdAt))
        .map(b => ({ batchId: b.batchId, platform: b.platform, createdAt: b.createdAt,
          items: b.items.filter(i => Number.isInteger(i?.index) && i.index >= 0 && i.index < 20 && STATUSES.includes(i.status)).map(i => ({ index: i.index, status: i.status, cached: i.cached === true })) })).filter(b => b.items.length);
    } catch (_) {}
    function persist() { if (!granular) { try { options.save(KEY, queue); } catch (_) {} } }
    function later(delay) {
      if (timer || stopped || !queue.length) return;
      timer = schedule(() => { timer = null; void flush(); }, delay);
      timer?.unref?.();
    }
    function newBatch() { return { batchId: newId(), createdAt: now() }; }
    function record(batch, index, result) {
      if (stopped || !batch || !Number.isInteger(index) || index < 0 || index >= 20 || !STATUSES.includes(result?.status)) return;
      let entry = queue.find(b => b.batchId === batch.batchId);
      if (!entry) { entry = { ...batch, platform: options.platform, items: [] }; queue.push(entry); }
      if (!entry.items.some(i => i.index === index)) {
        const item = { index, status: result.status, cached: result.cacheHit === true };
        entry.items.push(item);
        // Each immutable completed slot has its own key: two offline tabs cannot overwrite each other's outbox.
        if (granular) try { options.save(itemKey(entry, item), { batchId: entry.batchId, createdAt: entry.createdAt, platform: options.platform, item }); } catch (_) {}
      }
      persist(); later(250);
    }
    async function flush() {
      if (running || stopped || !queue.length) return;
      if (timer) { cancel(timer); timer = null; }
      running = true;
      let failed = false;
      try {
        // One receipt covers at most 20 completed references. Acknowledge only the sent slots.
        while (queue.length && !stopped) {
          const entry = queue[0], sent = entry.items.slice(0, 20).map(i => ({ ...i }));
          const response = await options.send({ action: 'usage.record', platform: options.platform, batchId: entry.batchId, createdAt: entry.createdAt, items: sent });
          if (!response?.ok || response.kind !== 'wenzheng-usage-v1' || !Array.isArray(response.acknowledged) || !sent.every(i => response.acknowledged.includes(i.index))) throw Error('Usage report not acknowledged');
          failures = 0;
          const indices = new Set(sent.map(i => i.index));
          if (granular) for (const item of sent) { try { options.remove(itemKey(entry, item)); } catch (_) {} }
          entry.items = entry.items.filter(i => !indices.has(i.index));
          queue = queue.filter(b => b !== entry || b.items.length);
          persist();
        }
      } catch (_) { failed = true; failures++; }
      finally { running = false; if (queue.length) later(failed ? Math.min(1800000, 30000 * 2 ** Math.min(failures - 1, 6)) : 250); }
    }
    function dispose() { stopped = true; if (timer) cancel(timer); timer = null; persist(); }
    function pendingCount() { return queue.reduce((n, b) => n + b.items.length, 0); }
    if (queue.length) later(250);
    return { newBatch, record, flush, dispose, pendingCount };
  }
  return { createUsageTracker, KEY };
});
