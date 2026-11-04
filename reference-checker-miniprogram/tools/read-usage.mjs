// Node.js 18+. Read-only: neither action runs a reference check nor records usage.
const endpoint = 'https://cloud1-d6gtx1retbc8754fa-1457855977.ap-shanghai.app.tcloudbase.com/api/verify-reference';
const action = process.argv.includes('--retained') ? 'usage.retainedHistory' : 'usage.read';
try {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }), signal: AbortSignal.timeout(15000) });
  let result = await response.json();
  if (typeof result?.body === 'string') result = JSON.parse(result.body);
  if (!response.ok || !result?.ok || result.kind !== 'wenzheng-usage-v1') throw Error('云端尚未部署统计版，或统计暂不可用；本次未取得有效数量。');
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
