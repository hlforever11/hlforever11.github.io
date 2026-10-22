#!/usr/bin/env python3
"""Freeze a disjoint reserve set AFTER development fixes; do not tune on its outcomes."""
import csv,gzip,hashlib,json,re
from pathlib import Path
from build import ROOT,make_records,norm,citation

out=ROOT/'holdout';out.mkdir(exist_ok=True)
main=[json.loads(s) for s in gzip.decompress((ROOT/'source-records.jsonl.gz').read_bytes()).decode().splitlines()]
seen={norm(r['title']) for r in main}
code=(ROOT.parent/'index.html').read_text();seed=code.split('const TRUSTED_REFERENCE_CACHE=[',1)[1].split(';\n    const $=',1)[0]
seen.update(norm(x) for x in re.findall(r'''["']?title["']?\s*:\s*['"]([^'"\n]+)['"]''',seed))
pool=[]
for r in make_records(reserve=True):
 r['authors']=[a for a in r['authors'] if a]
 key=norm(r['title'])
 if key in seen or len(key)<6 or not r['authors'] or not r['year'] or not 1900<=int(r['year'])<=2026 or not r['container'] or not(r.get('doi') or r.get('isbn')):continue
 seen.add(key);r['language']='zh' if re.search('[\u3400-\u9fff]',r['title']) else 'other';pool.append(r)
records=[]
for provider,n in [('crossref',40),('datacite',30),('europepmc',20),('openlibrary',10)]:
 candidates=sorted([r for r in pool if r['provider']==provider],key=lambda r:hashlib.sha256((r.get('doi') or r['url']).encode()).hexdigest())
 if len(candidates)<n:raise SystemExit(f'Insufficient reserve records for {provider}: {len(candidates)}')
 records.extend(candidates[:n])
for i,r in enumerate(records):r['id']=f'H{i+1:04d}'
cases=[]
def add(r,kind,text,**extra):
 cases.append(dict(id=f'T{len(cases)+1:04d}',workId=r['id'],kind=kind,reference=text,expectedDoi=r.get('doi'),expectedTitle=r['title'],language=r['language'],**extra))
for r in records:add(r,'standard',citation(r))
for r in records:add(r,'style-no-identifier',citation(r,apa=True,identifier=False))
for r in records[:50]:add(r,'wrong-year',citation({**r,'year':int(r['year'])-2}),expectedDifference='年份')
for i,r in enumerate(records[:50]):
 other=records[(i+53)%100];add(r,'identity-conflict',citation(r).replace(r['title'],other['title']),otherWorkId=other['id'])
manifest={'name':'Wenzheng disjoint reserve set v1','date':'2026-10-22','distinctWorks':len(records),'cases':len(cases),'overlapWithDevelopmentOrSeedTitles':0,'humanAdjudicationCompleted':False,'labelMethod':'Source metadata and controlled variants, not human-adjudicated truth labels. No further engine tuning on reserve outcomes.','sourceCounts':{p:sum(r['provider']==p for r in records) for p in sorted({r['provider'] for r in records})}}
for name,rows in [('source-records.jsonl.gz',records),('cases.jsonl.gz',cases)]:
 (out/name).write_bytes(gzip.compress(('\n'.join(json.dumps(r,ensure_ascii=False,separators=(',',':')) for r in rows)+'\n').encode(),mtime=0));manifest[name+'_sha256']=hashlib.sha256((out/name).read_bytes()).hexdigest()
manifest['engineSha256']={name:hashlib.sha256((ROOT.parent/name).read_bytes()).hexdigest() for name in ['index.html','citation-policy.js','open-sources.js']}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(manifest,ensure_ascii=False,indent=2))
