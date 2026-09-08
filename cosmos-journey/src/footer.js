const value = document.getElementById('site-visit-count');
const label = document.getElementById('site-visit-label');
const key = 'cosmos-journey-local-visits-v1';
let localCount = null;
try {
  localCount = (Number(localStorage.getItem(key)) || 0) + 1;
  localStorage.setItem(key, String(localCount));
} catch {}
const fallback = () => {
  label.textContent = localCount === null ? '累计访问' : '本机访问';
  value.textContent = localCount === null ? '—' : localCount.toLocaleString('zh-CN');
};
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);
(async () => {
  try {
    const response = await fetch('https://api.counterapi.dev/v1/hlforever11-cosmos-journey/pageviews/up', {cache:'no-store',signal:controller.signal});
    if (!response.ok) throw new Error('Counter unavailable');
    const data = await response.json();
    const count = data.count ?? data.value ?? data.data?.count ?? data.data?.value;
    if (!Number.isFinite(count)) throw new Error('Invalid count');
    value.textContent = count.toLocaleString('zh-CN');
  } catch { fallback(); }
  finally { clearTimeout(timeout); }
})();
