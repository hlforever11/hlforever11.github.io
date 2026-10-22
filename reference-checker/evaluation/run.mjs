import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {browserApi} from '../tests/browser-api.mjs';

const root=new URL(process.argv.includes('--holdout')?'./holdout/':'./',import.meta.url);
const load=name=>gunzipSync(readFileSync(new URL(name,root))).toString().trim().split('\n').map(JSON.parse);
const records=load('source-records.jsonl.gz'),cases=load('cases.jsonl.gz'),byId=new Map(records.map(r=>[r.id,r]));
const normalized=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const mode=process.argv[2]||'replay';
let current,requests=[];
const replayFetch=async input=>{
 const u=new URL(input),r=byId.get(current.workId);
 // Correct source evidence plus unrelated candidates. This tests decisions once
 // evidence has been retrieved; it deliberately does not simulate search recall.
 const pool=[r,byId.get(current.otherWorkId),...records.filter(v=>v.provider===r.provider&&v.id!==r.id).slice(0,2)].filter(Boolean);
 const rows=pool.filter(v=>v.provider===r.provider),json=value=>new Response(JSON.stringify(value),{status:200});
 requests.push(u.hostname);
 if(u.hostname==='api.crossref.org'){
  if(u.pathname.startsWith('/works/')){
   const doi=decodeURIComponent(u.pathname.slice(7)).toLowerCase(),item=records.find(v=>v.provider==='crossref'&&v.doi===doi);
   if(!item)throw Error('Replay: DOI not registered in this source');
   return json({message:item.raw});
  }
  return json({message:{items:rows.filter(v=>v.provider==='crossref').map(v=>v.raw)}});
 }
 if(u.hostname==='api.datacite.org'){
  if(u.pathname.startsWith('/dois/')){
   const doi=decodeURIComponent(u.pathname.slice(6)).toLowerCase(),item=records.find(v=>v.provider==='datacite'&&v.doi===doi);
   if(!item)throw Error('Replay: DOI not registered in this source');
   return json({data:item.raw});
  }
  return json({data:rows.filter(v=>v.provider==='datacite').map(v=>v.raw)});
 }
 if(u.hostname==='www.ebi.ac.uk')return json({resultList:{result:rows.filter(v=>v.provider==='europepmc').map(v=>v.raw)}});
 if(u.hostname==='openlibrary.org')return json({docs:rows.filter(v=>v.provider==='openlibrary').map(v=>v.raw)});
 throw Error('Replay: this provider is not in the frozen snapshot');
};
const outcomes=[];
function assess(c,result,elapsed){
 const r=byId.get(c.workId),confirmed=['verified','partial','corrected'].includes(result.status);
 const title=normalized(c.expectedTitle),record=result.citationEvidence?.record||{},actualDoi=String(record.doi||'').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').toLowerCase(),actualTitle=normalized(record.title);
 const correctIdentity=confirmed&&(c.expectedDoi?actualDoi===c.expectedDoi.toLowerCase():!!title&&actualTitle===title);
 const differences=result.differences||[],observations=result.observations||[];
 let passed;
 if(c.kind==='identity-conflict')passed=!['verified','partial'].includes(result.status)||differences.some(d=>['篇名','DOI','作者'].includes(d.field));
 else if(c.kind==='wrong-year')passed=correctIdentity&&differences.some(d=>d.field==='年份');
 else passed=correctIdentity&&differences.length===0;
 return {id:c.id,workId:c.workId,kind:c.kind,language:c.language,provider:r.provider,status:result.status,passed,correctIdentity,actualDoi,actualTitle:record.title||'',differences,observations,source:result.source||'',sourceUrl:result.sourceUrl||'',checkedSources:result.checkedSources||[],note:result.note,elapsedMs:elapsed,parsedTitle:undefined};
}
const publicFetch=(input,options)=>{const u=new URL(input);if(u.searchParams.has('mailto')||u.searchParams.has('email')||String(input).includes('@'))throw Error('Evaluation request must not contain a personal contact address');return fetch(input,options);};
const api=browserApi(mode==='live'?publicFetch:replayFetch,{setTimeout,clearTimeout}).api;
const seeds=new Set(api.TRUSTED_REFERENCE_CACHE.map(r=>normalized(r.title)));
if(records.some(r=>seeds.has(normalized(r.title))))throw Error('Preloaded title leaked into benchmark');
let selected=cases;
if(mode==='live'){
 const perSource=Number(process.argv[3]||20),hash=c=>createHash('sha256').update(c.id).digest('hex');
 selected=[];
 for(const provider of ['crossref','datacite','europepmc','openlibrary'])selected.push(...cases.filter(c=>c.kind==='standard'&&byId.get(c.workId).provider===provider).sort((a,b)=>hash(a).localeCompare(hash(b))).slice(0,perSource));
}
let next=0;
async function worker(){
 while(next<selected.length){
  const c=selected[next++];if(mode!=='live')current=c;
  const start=Date.now();
  let result;
  try{result=await api.verifyOneLocal(c.reference);}catch(error){result={status:'error',note:error.message};}
  const row=assess(c,result,Date.now()-start);row.parsedTitle=api.parseReference(c.reference).title;
  outcomes.push(row);
  if(mode==='live'||outcomes.length%100===0)console.log(`${mode}: ${outcomes.length}/${selected.length} ${c.id} ${row.status} ${row.passed?'pass':'CHECK'}`);
  if(mode==='live'||outcomes.length%100===0)writeFileSync(new URL(`${mode}-progress.json`,root),JSON.stringify(outcomes,null,2));
 }
}
await Promise.all(Array.from({length:mode==='live'?2:1},worker));
const grouped=key=>Object.fromEntries([...new Set(outcomes.map(o=>o[key]))].sort().map(value=>{const rows=outcomes.filter(o=>o[key]===value);return[value,{total:rows.length,passed:rows.filter(o=>o.passed).length,confirmed:rows.filter(o=>o.correctIdentity).length}]}));
const report={date:'2026-10-22',mode,engineSha256:Object.fromEntries(['index.html','citation-policy.js','open-sources.js'].map(name=>[name,createHash('sha256').update(readFileSync(new URL('../'+name,import.meta.url))).digest('hex')])),engine:'Website local fallback; current source adapters and current rules; no application result cache or preloaded sample hits',scope:mode==='live'?'Live metadata retrieval in Codex execution environment. Not a WeChat production test; latency and availability are environment dependent.':'Frozen source evidence supplied with distractors. Measures parsing, matching and field checks, NOT live retrieval recall or population accuracy.',humanAdjudicated:false,total:outcomes.length,passed:outcomes.filter(o=>o.passed).length,byKind:grouped('kind'),bySource:grouped('provider'),byLanguage:grouped('language'),statuses:Object.fromEntries([...new Set(outcomes.map(o=>o.status))].map(s=>[s,outcomes.filter(o=>o.status===s).length])),outcomes};
writeFileSync(new URL(`${mode}-results.json`,root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,outcomes:undefined},null,2));
