#!/usr/bin/env python3
"""Collect external bibliographic metadata; never imports the application's seed index."""
import concurrent.futures,hashlib,json,re,time,urllib.parse,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent
SNAP=ROOT/'snapshots';SNAP.mkdir(exist_ok=True)
HEADERS={'User-Agent':'Wenzheng-Evaluation/1.0','Accept':'application/json'}
SPECS=[
 ('crossref-hans','crossref','https://api.crossref.org/works?'+urllib.parse.urlencode({'filter':'prefix:10.12677,from-pub-date:2023-01-01,until-pub-date:2025-12-31','rows':250,'select':'DOI,title,author,container-title,published,published-print,published-online,type,volume,issue,page'})),
 ('crossref-china','crossref','https://api.crossref.org/works?'+urllib.parse.urlencode({'query.title':'图书馆 信息 服务 研究','rows':250,'select':'DOI,title,author,container-title,published,published-print,published-online,type,volume,issue,page'})),
 ('crossref-science','crossref','https://api.crossref.org/works?'+urllib.parse.urlencode({'filter':'prefix:10.1360,from-pub-date:2023-01-01,until-pub-date:2025-12-31','rows':180,'select':'DOI,title,author,container-title,published,published-print,published-online,type,volume,issue,page'})),
 ('datacite-zh-formal','datacite','https://api.datacite.org/dois?'+urllib.parse.urlencode({'query':'(language:zh OR language:zh-CN OR language:zh-TW) AND publicationYear:[2015 TO 2025] AND (types.resourceTypeGeneral:Dissertation OR types.resourceTypeGeneral:Dataset)','page[size]':200})),
 ('datacite-reports','datacite','https://api.datacite.org/dois?'+urllib.parse.urlencode({'query':'types.resourceTypeGeneral:Report AND publicationYear:[2020 TO 2025]','page[size]':80})),
 ('epmc','europepmc','https://www.ebi.ac.uk/europepmc/webservices/rest/search?'+urllib.parse.urlencode({'query':'FIRST_PDATE:[2023-01-01 TO 2025-12-31] AND (TITLE:education OR TITLE:information OR TITLE:library) AND HAS_DOI:Y','format':'json','resultType':'core','pageSize':100})),
 ('openlibrary','openlibrary','https://openlibrary.org/search.json?'+urllib.parse.urlencode({'q':'subject:library','limit':100,'fields':'key,title,author_name,first_publish_year,publisher,isbn'}))]
def get(spec):
 label,kind,url=spec;p=SNAP/(label+'.json');started=time.time()
 if p.exists():
  try:json.loads(p.read_text());return {'label':label,'kind':kind,'url':url,'cache':True,'path':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
  except Exception:pass
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers=HEADERS),timeout=50) as r:b=r.read()
  json.loads(b);p.write_bytes(b)
  return {'label':label,'kind':kind,'url':url,'path':p.name,'sha256':hashlib.sha256(b).hexdigest(),'retrievedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'seconds':round(time.time()-started,2)}
 except Exception as e:return {'label':label,'kind':kind,'url':url,'error':str(e),'seconds':round(time.time()-started,2)}
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  results=[]
  for r in pool.map(get,SPECS):results.append(r);print(json.dumps(r,ensure_ascii=False),flush=True);(ROOT/'collection-log.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
