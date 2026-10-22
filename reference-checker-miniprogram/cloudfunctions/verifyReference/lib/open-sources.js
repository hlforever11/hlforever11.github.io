/* Public metadata adapters. No model API, account key, or paid service. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WenzhengSources=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const clean=v=>String(v??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
 const han=v=>/[\u3400-\u9fff]/.test(String(v||''));
 const sameDoi=(a,b)=>String(a||'').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').toLowerCase()===String(b||'').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').toLowerCase();
 function create({fetchJson,authorKey}){
  function dataCiteCandidate(item,parsed={}){
   const a=item?.attributes||item||{},titles=(a.titles||[]).map(v=>clean(v.title)).filter(Boolean);
   const authors=(a.creators||[]).map(v=>clean(v.givenName||v.familyName?(han(String(v.givenName||'')+String(v.familyName||''))?[v.familyName,v.givenName].filter(Boolean).join(''):[v.givenName,v.familyName].filter(Boolean).join(' ')):v.name)).filter(Boolean);
   const kind=a.types?.resourceTypeGeneral||'',type=/JournalArticle/i.test(kind)?'journal-article':/BookChapter/i.test(kind)?'book-chapter':/Book/i.test(kind)?'book':/Dissertation/i.test(kind)?'dissertation':/Dataset/i.test(kind)?'dataset':/Preprint/i.test(kind)?'preprint':/Report|Text/i.test(kind)?'report':kind;
   const issued=(a.dates||[]).filter(d=>/^(?:Issued|Published)$/i.test(d.dateType||'')).map(d=>clean(d.date));
   const doi=clean(a.doi||item.id).toLowerCase(),date=issued[0]||String(a.publicationYear||'');
   return{source:'DataCite',sources:['DataCite'],registry:true,origin:'DataCite',title:titles.find(t=>han(t)===han(parsed.title))||titles[0]||'',alternateTitles:titles,authors,authorKeys:authors.map(authorKey),year:Number(a.publicationYear)||Number(date.slice(0,4))||null,publicationDate:date,acceptedYears:[a.publicationYear,...issued.map(v=>Number(v.slice(0,4)))].filter(Boolean),container:clean(a.publisher?.name||a.publisher||a.container?.title),edition:clean(a.version),version:clean(a.version),type,online:!/^book$/i.test(type),doi,exactDoi:!!(parsed.doi&&sameDoi(parsed.doi,doi)),sourceUrl:a.url||`https://doi.org/${doi}`,volume:clean(a.container?.volume),issue:clean(a.container?.issue),pages:clean(a.container?.firstPage)+(a.container?.lastPage?'-'+a.container.lastPage:''),provenance:{provider:'DataCite',original:'DataCite',recordId:doi}};
  }
  async function queryDataCite(parsed,signal){
   const jobs=[];
   if(parsed.doi)jobs.push(`https://api.datacite.org/dois/${encodeURIComponent(parsed.doi)}`);
   if(parsed.title){const u=new URL('https://api.datacite.org/dois');u.searchParams.set('query','titles.title:"'+String(parsed.title).replace(/["\\]/g,' ')+'"');u.searchParams.set('page[size]','5');jobs.push(u.href);}
   const checks=await Promise.allSettled(jobs.map(u=>fetchJson(u,signal)));
   if(jobs.length&&checks.every(x=>x.status==='rejected'))throw Error('DataCite 暂不可用');
   const seen=new Set(),candidates=[];
   for(const r of checks)if(r.status==='fulfilled')for(const item of Array.isArray(r.value?.data)?r.value.data:r.value?.data?[r.value.data]:[]){const c=dataCiteCandidate(item,parsed);if(c.title&&c.doi&&!seen.has(c.doi)){seen.add(c.doi);candidates.push(c);}}
   return{source:'DataCite',candidates};
  }
  function europePmcCandidate(item,parsed={}){
   const authors=(item.authorList?.author||[]).map(a=>clean(a.firstName&&a.lastName?a.lastName+', '+a.firstName:a.fullName||[a.firstName,a.lastName].filter(Boolean).join(' '))).filter(Boolean);
   const j=item.journalInfo||{},doi=clean(item.doi).toLowerCase(),pmid=clean(item.pmid||((item.source==='MED')?item.id:''));
   return{source:'Europe PMC',sources:['Europe PMC'],origin:item.source==='MED'?'PubMed':item.source||'Europe PMC',title:clean(item.title),authors,authorKeys:authors.map(authorKey),year:Number(item.pubYear)||Number(String(item.firstPublicationDate||j.yearOfPublication||'').slice(0,4))||null,publicationDate:item.firstPublicationDate||'',container:clean(j.journal?.title||j.journal?.medlineAbbreviation),volume:clean(j.volume),issue:clean(j.issue),pages:clean(item.pageInfo),doi,pmid,type:/preprint/i.test((item.pubTypeList?.pubType||[]).join(' '))?'preprint':'journal-article',exactDoi:!!(parsed.doi&&sameDoi(parsed.doi,doi)),sourceUrl:pmid?`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`:doi?`https://doi.org/${doi}`:`https://europepmc.org/article/${encodeURIComponent(item.source||'MED')}/${encodeURIComponent(item.id||'')}`,provenance:{provider:'Europe PMC',original:item.source==='MED'?'PubMed':item.source||'Europe PMC',recordId:pmid||doi||item.id}};
  }
  async function queryEuropePmc(parsed,signal){
   const q=parsed.doi?`DOI:"${parsed.doi}"`:parsed.pmid?`EXT_ID:${parsed.pmid} AND SRC:MED`:`TITLE:"${String(parsed.title||'').replace(/["\\]/g,' ')}"`;
   const u=new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');u.searchParams.set('query',q);u.searchParams.set('format','json');u.searchParams.set('resultType','core');u.searchParams.set('pageSize','5');
   const d=await fetchJson(u.href,signal);return{source:'Europe PMC',candidates:(d.resultList?.result||[]).map(i=>europePmcCandidate(i,parsed))};
  }
  let pubmedQueue=Promise.resolve(),pubmedNext=0;
  function pubmedRequest(url){
   const pending=pubmedQueue.catch(()=>{}).then(async()=>{const ms=Math.max(0,pubmedNext-Date.now());if(ms)await new Promise(r=>setTimeout(r,ms));pubmedNext=Date.now()+350;return fetchJson(url);});
   pubmedQueue=pending.then(()=>{},()=>{});return pending;
  }
  async function queryPubMed(parsed){
   let ids=parsed.pmid?[String(parsed.pmid)]:[];
   if(!ids.length&&parsed.title){const u=new URL('https://pubmed.ncbi.nlm.nih.gov/api/citmatch/');u.searchParams.set('method','auto');u.searchParams.set('raw-text',parsed.raw||parsed.work||parsed.title);const d=await pubmedRequest(u.href);ids=(d.result?.uids||d.uids||[]).slice(0,3).map(v=>String(v&&typeof v==='object'?(v.pubmed||v.pmid||v.id||''):v)).filter(v=>/^\d+$/.test(v));}
   if(!ids.length)return{source:'PubMed',candidates:[]};
   const u=new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi');u.searchParams.set('db','pubmed');u.searchParams.set('id',ids.join(','));u.searchParams.set('retmode','json');u.searchParams.set('tool','wenzheng');
   const d=await pubmedRequest(u.href),candidates=[];
   for(const id of ids){const i=d.result?.[id];if(!i)continue;const authors=(i.authors||[]).map(a=>clean(a.name)).filter(Boolean),doi=clean((i.articleids||[]).find(x=>x.idtype==='doi')?.value).toLowerCase();
    candidates.push({source:'PubMed',sources:['PubMed'],origin:'PubMed',title:clean(i.title),authors,authorKeys:authors.map(authorKey),year:Number(String(i.pubdate||'').match(/(?:18|19|20)\d{2}/)?.[0])||null,container:clean(i.fulljournalname||i.source),volume:clean(i.volume),issue:clean(i.issue),pages:clean(i.pages).replace(/[–—]/g,'-'),doi,pmid:id,type:'journal-article',sourceUrl:`https://pubmed.ncbi.nlm.nih.gov/${id}/`,exactDoi:!!(parsed.doi&&sameDoi(parsed.doi,doi)),provenance:{provider:'PubMed',original:'PubMed',recordId:id}});
   }return{source:'PubMed',candidates};
  }
  return{queryDataCite,queryEuropePmc,queryPubMed,dataCiteCandidate,europePmcCandidate};
 }
 return{create};
});
