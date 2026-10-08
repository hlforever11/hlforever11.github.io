const crypto = require('node:crypto');
const COUNTER_ID = 'wenzheng-miniprogram-visits';
const COLLECTION = 'reference_users';
const BASE_VISITS = 1000;

function historicalBase(value) {
  if(value === undefined || value === null || String(value).trim() === '')return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function createVisitRecorder(db) {
  return async function recordVisit(owner, event = {}) {
    const increment = event.action === 'visit';
    const token = String(event.visitId || '');
    if(increment && !/^[A-Za-z0-9_-]{8,100}$/.test(token))return {ok:false,message:'访问标识无效'};
    const key = crypto.createHash('sha256').update(owner + ':' + token).digest('hex');
    const response = await db.runTransaction(async transaction => {
      const doc = transaction.collection(COLLECTION).doc(COUNTER_ID);
      let old = null;
      try { old = (await doc.get()).data; } catch(error) {
        if(!/not.?exist|不存在|not.?found|DATABASE_DOCUMENT_NOT_EXIST/i.test(String(error.errCode || error.code || '') + ' ' + error.message))throw error;
      }
      if(Array.isArray(old))old = old[0];
      const data = old || {newVisits:0,legacyBase:null,recentVisits:[]};
      // The owner explicitly selected 1000. Replace any earlier placeholder
      // base, but preserve every already-recorded new visit.
      const base = BASE_VISITS;
      const recent = Array.isArray(data.recentVisits) ? data.recentVisits.slice(-1000) : [];
      const previous = historicalBase(data.newVisits) ?? 0;
      const next = previous + (increment && !recent.includes(key) ? 1 : 0);
      if(!Number.isSafeInteger(base + next))throw new Error('访问计数超出安全整数范围');
      if(increment && !recent.includes(key))recent.push(key);
      await doc.set({data:{...data,newVisits:next,legacyBase:base,recentVisits:recent.slice(-1000),updatedAt:Date.now()}});
      return {ok:true,platform:'miniprogram',build:'2026.10.08-visits-1000',newVisits:next,legacyBase:base,historyPending:false,total:base+next};
    });
    return response.result || response;
  };
}

module.exports = {createVisitRecorder,historicalBase,COUNTER_ID,BASE_VISITS};
