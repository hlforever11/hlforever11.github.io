#!/usr/bin/env python3
"""Source-record consistency benchmark, not a human-adjudicated population accuracy estimate."""
import csv,gzip,hashlib,html,json,re,unicodedata
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def norm(s):return ''.join(c for c in unicodedata.normalize('NFKC',str(s)).lower() if c.isalnum())
def clean(s):
 s=str(s or '')
 for _ in range(4):
  v=html.unescape(s)
  if v==s:break
  s=v
 return re.sub(r'\s+',' ',re.sub('<[^>]+>',' ',s)).strip().rstrip('.')
def han(s):return bool(re.search('[\u3400-\u9fff]',str(s)))
def date_year(i):
 for k in ['published-print','published-online','published','issued']:
  y=i.get(k,{}).get('date-parts',[[]])[0]
  if y:return y[0]
 return None
def load(name):
 p=ROOT/'snapshots'/(name+'.json')
 return json.loads(p.read_text()) if p.exists() else {}
def make_records(reserve=False):
 records=[]
 for name in ['crossref-china','crossref-science','crossref-hans']:
  for i in load(name).get('message',{}).get('items',[]):
   titles=[clean(t) for t in i.get('title',[])];title=next((t for t in titles if han(t)),titles[0] if titles else '')
   authors=[clean(a.get('name') or (''.join([a.get('family',''),a.get('given','')]) if han(a.get('family','')+a.get('given','')) else ' '.join([a.get('given',''),a.get('family','')]))) for a in i.get('author',[])]
   raw={k:i[k] for k in ['DOI','title','author','container-title','published','published-print','published-online','type','volume','issue','page'] if k in i}
   for a in raw.get('author',[]):
    for k in list(a):
     if k not in ['name','given','family']:del a[k]
   records.append(dict(provider='crossref',stratum=name,title=title,authors=authors,year=date_year(i),container=clean((i.get('container-title') or [''])[0]),type=i.get('type'),doi=i.get('DOI','').lower(),volume=str(i.get('volume','')),issue=str(i.get('issue','')),pages=str(i.get('page','')),url='https://doi.org/'+i.get('DOI',''),raw=raw))
 for name in ['datacite-zh-formal','datacite-reports']:
  for i in load(name).get('data',[]):
   a=i.get('attributes',{});ts=[clean(t.get('title')) for t in a.get('titles',[])];authors=[clean((''.join([v.get('familyName',''),v.get('givenName','')]) if han(v.get('givenName','')+v.get('familyName','')) else ' '.join([v.get('givenName',''),v.get('familyName','')])) if v.get('givenName') or v.get('familyName') else v.get('name')) for v in a.get('creators',[])]
   fields=['doi','titles','creators','publisher','publicationYear','language','types','dates','url','version','container']
   raw={'id':i.get('id'),'attributes':{k:a[k] for k in fields if k in a}}
   for author in raw['attributes'].get('creators',[]):
    for k in list(author):
     if k not in ['name','nameType','givenName','familyName']:del author[k]
   records.append(dict(provider='datacite',stratum=name,title=next((t for t in ts if han(t)),ts[0] if ts else ''),authors=authors,year=a.get('publicationYear'),container=clean(a.get('publisher',{}).get('name') if isinstance(a.get('publisher'),dict) else a.get('publisher')),type=a.get('types',{}).get('resourceTypeGeneral',''),doi=a.get('doi','').lower(),volume='',issue='',pages='',url=a.get('url') or 'https://doi.org/'+a.get('doi',''),raw=raw))
 for i in load('epmc').get('resultList',{}).get('result',[])+(load('epmc-reserve').get('resultList',{}).get('result',[]) if reserve else []):
  j=i.get('journalInfo',{});authors=[clean(' '.join([v.get('firstName',''),v.get('lastName','')]) or v.get('fullName')) for v in i.get('authorList',{}).get('author',[])]
  raw={k:i[k] for k in ['id','source','pmid','doi','title','authorList','pubYear','firstPublicationDate','journalInfo','pageInfo','pubTypeList'] if k in i}
  raw['authorList']={'author':[{k:a[k] for k in ['fullName','firstName','lastName','initials'] if k in a} for a in i.get('authorList',{}).get('author',[])]}
  records.append(dict(provider='europepmc',stratum='epmc',title=clean(i.get('title')),authors=authors,year=int(i.get('pubYear') or j.get('yearOfPublication') or 0),container=clean(j.get('journal',{}).get('title')),type='journal-article',doi=i.get('doi','').lower(),volume=str(j.get('volume','')),issue=str(j.get('issue','')),pages=clean(i.get('pageInfo')),url='https://pubmed.ncbi.nlm.nih.gov/'+i.get('pmid',i.get('id',''))+'/',raw=raw))
 for i in load('openlibrary').get('docs',[]):
  records.append(dict(provider='openlibrary',stratum='openlibrary',title=clean(i.get('title')),authors=i.get('author_name',[]),year=i.get('first_publish_year'),container=clean((i.get('publisher') or [''])[0]),type='book',doi='',isbn=(i.get('isbn') or [''])[0],volume='',issue='',pages='',url='https://openlibrary.org'+i.get('key',''),raw=i))
 return records
def citation(r,apa=False,identifier=True):
 names=r['authors'][:3];truncated=len(r['authors'])>3
 def initials(n,index):
  if han(n):return n
  if re.search(r'\b(organization|organisation|university|institute|council|committee|commission|association)\b',n,re.I):return n
  src=(r.get('raw',{}).get('author') or r.get('raw',{}).get('attributes',{}).get('creators') or [])
  a=src[index] if index<len(src) else {}
  family=a.get('family') or a.get('familyName');given=a.get('given') or a.get('givenName')
  if not family or not given:
   if ',' in n:family,given=n.split(',',1)
   else:return n # Do not invent the family-name boundary for unstructured names.
  return family+', '+''.join(w[0].upper()+'. ' for w in re.findall(r'[^\W\d_]+',given)).strip()
 kind=str(r['type']).lower();typ='M' if 'book' in kind else 'D' if 'dissertation' in kind else 'DS/OL' if 'dataset' in kind else 'R/OL' if any(k in kind for k in ['report','text']) else 'J'
 if apa:
  auth=', '.join(initials(n,index) for index,n in enumerate(names))+(', et al.' if truncated else '')
  text=f"{auth}. ({r['year']}). {r['title']}. {r['container']}"
 else:
  auth=', '.join(names)+(', 等' if han(''.join(names)) and truncated else ', et al.' if truncated else '')
  text=f"{auth}. {r['title']}[{typ}]. {r['container']}, {r['year']}"
 if r.get('volume'):text+=', '+r['volume']
 if r.get('issue'):text+='('+r['issue']+')'
 if r.get('pages'):text+=(':'+r['pages']) if not apa else ', '+r['pages']
 text=text.strip()+'.'
 if identifier and r.get('doi'):text+=' DOI:'+r['doi']+'.'
 if identifier and r.get('provider')!='openlibrary' and not r.get('doi') and r.get('isbn'):text+=' ISBN:'+r['isbn']+'.'
 return text
def main():
 # The seed titles are excluded as strings, not used to generate gold labels.
 code=(ROOT.parent/'index.html').read_text();seed_block=code.split('const TRUSTED_REFERENCE_CACHE=[',1)[1].split(';\n    const $=',1)[0]
 seeds={norm(x) for x in re.findall(r'''["']?title["']?\s*:\s*['"]([^'"\n]+)['"]''',seed_block)}
 eligible=[];seen=set()
 for r in make_records():
  r['authors']=[a for a in r['authors'] if a]
  if not r['title'] or len(norm(r['title']))<6 or not r['authors'] or not r['year'] or not 1900<=int(r['year'])<=2026 or not r['container']:continue
  if not (r.get('doi') or r.get('isbn')):continue
  key=norm(r['title'])
  if key in seeds or key in seen:continue
  seen.add(key);r['language']='zh' if han(r['title']) else 'other';eligible.append(r)
 # Deterministic stratified selection. This is a deliberately difficult corpus, not a population sample.
 quotas=[('crossref-china',120),('crossref-science',50),('datacite-zh-formal',80),('datacite-reports',40),('epmc',70),('openlibrary',40)]
 records=[]
 for stratum,n in quotas:records.extend(sorted([r for r in eligible if r['stratum']==stratum],key=lambda r:r.get('doi') or r['url'])[:n])
 if len(records)<400:
  known={norm(r['title']) for r in records}
  records.extend([r for r in eligible if norm(r['title']) not in known][:400-len(records)])
 if len(records)<250:raise SystemExit('Not enough distinct source records')
 records=records[:400]
 for i,r in enumerate(records):r['id']=f'W{i+1:04d}'
 cases=[]
 for i,r in enumerate(records):
  cases.append({'id':f'C{len(cases)+1:04d}','workId':r['id'],'kind':'standard','reference':citation(r),'expectedDoi':r.get('doi'),'expectedIsbn':r.get('isbn'),'expectedTitle':r['title'],'language':r['language']})
 for r in records[:300]:cases.append({'id':f'C{len(cases)+1:04d}','workId':r['id'],'kind':'style-no-identifier','reference':citation(r,apa=True,identifier=False),'expectedDoi':r.get('doi'),'expectedIsbn':r.get('isbn'),'expectedTitle':r['title'],'language':r['language']})
 for r in records[:200]:
  case={'id':f'C{len(cases)+1:04d}','workId':r['id'],'kind':'wrong-year','reference':citation({**r,'year':int(r['year'])-2}),'expectedDoi':r.get('doi'),'expectedIsbn':r.get('isbn'),'expectedTitle':r['title'],'expectedDifference':'年份','language':r['language']};cases.append(case)
 for i,r in enumerate(records[:100]):
  wrong=records[(i+137)%len(records)];ref=citation(r).replace(r['title'],wrong['title'])
  cases.append({'id':f'C{len(cases)+1:04d}','workId':r['id'],'otherWorkId':wrong['id'],'kind':'identity-conflict','reference':ref,'expected':'must-not-report-consistent','language':r['language']})
 # Exactly 1,000 entries when the targeted 400 distinct records were available.
 manifest={'name':'Wenzheng external source-record benchmark v1','date':'2026-10-22','distinctWorks':len(records),'cases':len(cases),'seedOverlap':0,'labelMethod':'External bibliographic metadata; controlled variants. Not independently double-annotated by humans.','retrievalReplayWarning':'Snapshot replay measures parsing/matching, not live retrieval recall.','sourceCounts':{p:sum(r['provider']==p for r in records) for p in sorted({r['provider'] for r in records})},'caseCounts':{p:sum(c['kind']==p for c in cases) for p in sorted({c['kind'] for c in cases})},'languages':{p:sum(c['language']==p for c in cases) for p in sorted({c['language'] for c in cases})},'excludedSeedTitles':len(seeds),'humanAdjudicationCompleted':False}
 for filename,rows in [('source-records.jsonl.gz',records),('cases.jsonl.gz',cases)]:
  data=''.join(json.dumps(x,ensure_ascii=False,separators=(',',':'))+'\n' for x in rows).encode();(ROOT/filename).write_bytes(gzip.compress(data,mtime=0));manifest[filename+'_sha256']=hashlib.sha256((ROOT/filename).read_bytes()).hexdigest()
 (ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 with (ROOT/'human-review.csv').open('w',newline='',encoding='utf-8-sig') as f:
  w=csv.writer(f);w.writerow(['case_id','work_id','kind','reference','source_url','source_title','reviewer_1','reviewer_2','adjudication']);lookup={r['id']:r for r in records}
  for c in cases:
   r=lookup[c['workId']];w.writerow([c['id'],r['id'],c['kind'],c['reference'],r['url'],r['title'],'','',''])
 print(json.dumps(manifest,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
