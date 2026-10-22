#!/usr/bin/env python3
"""Package measured results and describe their limits, without changing the engine."""
import csv,gzip,hashlib,html,json
from pathlib import Path
from urllib.parse import unquote
ROOT=Path(__file__).resolve().parent
def rows(p):return [json.loads(s) for s in gzip.decompress(p.read_bytes()).decode().splitlines()]
def load(p):return json.loads(p.read_text())
def grouped(outcomes,key):
 return {v:{'total':sum(o[key]==v for o in outcomes),'passed':sum(o[key]==v and o['passed'] for o in outcomes),'confirmed':sum(o[key]==v and o['correctIdentity'] for o in outcomes)} for v in sorted({o[key] for o in outcomes})}

# Audit the first live batch against the actual returned source URL as well as
# its earlier citation-based check. Every confirmed item must point to the
# independently saved gold record, not merely repeat an input DOI in output.
p=ROOT/'live-results.json';live=load(p);records={r['id']:r for r in rows(ROOT/'source-records.jsonl.gz')}
for o in live['outcomes']:
 r=records[o['workId']];url=unquote(o['sourceUrl']).lower().rstrip('/');expected=unquote(r['url']).lower().rstrip('/')
 identity=bool(url and (url==expected or r.get('doi') and url=='https://doi.org/'+r['doi'].lower()))
 o['identityAudit']='Returned source record URL matches frozen gold URL or exact DOI URL' if identity else 'No exact source record link match'
 o['correctIdentity']=bool(o['status'] in ['verified','partial','corrected'] and identity)
 o['passed']=o['correctIdentity'] and not o['differences']
live['passed']=sum(o['passed'] for o in live['outcomes'])
for key,target in [('kind','byKind'),('provider','bySource'),('language','byLanguage')]:live[target]=grouped(live['outcomes'],key)
live['identityAudit']='Rechecked every returned source link against frozen source URLs or exact DOI URLs; not based only on a DOI echoed in a citation.'
p.write_text(json.dumps(live,ensure_ascii=False,indent=2)+'\n')
dev=load(ROOT/'replay-results.json');reserve=load(ROOT/'holdout/replay-results.json');reserve_live=load(ROOT/'holdout/live-results.json')
manifest=load(ROOT/'holdout/manifest.json')
assert all(hashlib.sha256((ROOT.parent/k).read_bytes()).hexdigest()==v for k,v in manifest['engineSha256'].items()),'Engine changed after reserve set was frozen'
main_titles={r['title'] for r in records.values()};assert not main_titles.intersection(r['title'] for r in rows(ROOT/'holdout/source-records.jsonl.gz'))

# Blank reviewer fields are intentional; these are not invented human labels.
hold_records={r['id']:r for r in rows(ROOT/'holdout/source-records.jsonl.gz')}
with (ROOT/'holdout/human-review.csv').open('w',newline='',encoding='utf-8-sig') as f:
 w=csv.writer(f);w.writerow(['case_id','work_id','kind','reference','source_url','source_title','reviewer_1','reviewer_2','adjudication'])
 for c in rows(ROOT/'holdout/cases.jsonl.gz'):
  r=hold_records[c['workId']];w.writerow([c['id'],r['id'],c['kind'],c['reference'],r['url'],r['title'],'','',''])
for base in [ROOT,ROOT/'holdout']:
 for name in ['replay-results.json','live-results.json','human-review.csv']:(base/(name+'.gz')).write_bytes(gzip.compress((base/name).read_bytes(),mtime=0))

def pct(p,n):return f'{p/n*100:.1f}%'
total_live=live['total']+reserve_live['total'];matched=sum(o['correctIdentity'] for r in [live,reserve_live] for o in r['outcomes'])
summary={'date':'2026-10-22','distinctWorks':500,'replayInputs':1300,'development':{k:dev[k] for k in ['total','passed','byKind']},'reserve':{k:reserve[k] for k in ['total','passed','byKind']},'live':{'total':total_live,'matched':matched,'development':live['total'],'reserve':reserve_live['total']},'codeChecks':{'website':117,'miniprogram':78},'humanAdjudicated':False,'populationAccuracyClaimed':False}
(ROOT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
readme=f'''# 文证外部评测记录（2026-10-22）

本轮完成公开来源扩展、外部样本自动评测和结论简化。未接入付费AI服务。网页与小程序源码同步；小程序仍须按随包UPDATE.md部署云函数并完成微信发布。

## 样本和结果

共500篇不同作品，生成1,300条输入。开发集400篇、1,000条；保留集100篇、300条，两组及原有52个预置题名之间没有题名交集。开发集曾用于修正规则；保留集在修正规则后冻结，未再用其结果调整网站引擎。

| 评测 | 输入数 | 符合本次检查预期 | 解释 |
| --- | ---: | ---: | --- |
| 开发集快照回放 | {dev['total']} | {dev['passed']}（{pct(dev['passed'],dev['total'])}） | 诊断与回归结果，已用于修正规则 |
| 保留集快照回放 | {reserve['total']} | {reserve['passed']}（{pct(reserve['passed'],reserve['total'])}） | 未用于调参的来源记录一致性检查 |
| 实时检索抽测 | {total_live} | {matched}篇取得对应记录 | 开发集80篇、保留集20篇；均为正常输入 |
| 两端代码回归 | 195项 | 195项通过 | 网站117项、小程序78项，不属于外部样本准确率 |

这些百分比不是任意参考文献的“真假准确率”。快照回放预先提供相应来源记录和干扰候选，检验解析、匹配与字段检查；它不测数据库覆盖率或实时召回率。实时抽测运行于本次执行环境的网站本地核验引擎，不是微信生产环境或国内不同网络的服务可用率。

## 保留集分项

| 输入类型 | 数量 | 符合预期 |
| --- | ---: | ---: |
| 标准输入 | 100 | {reserve['byKind']['standard']['passed']} |
| 著者年份写法、去除标识符 | 100 | {reserve['byKind']['style-no-identifier']['passed']} |
| 受控年份错误 | 50 | {reserve['byKind']['wrong-year']['passed']} |
| 题名与DOI等身份字段冲突 | 50 | {reserve['byKind']['identity-conflict']['passed']} |

冲突项要求不能显示“字段一致”的确认结果；返回复核或暂未证实也计入安全处理。它们是受控构造的冲突，不是已经人工鉴定的50篇虚假文献。保留集剩余10项包括9项无标识符图书未匹配、1项数据集字段差异；详见逐条结果。未为追求高分将这些样本加入生产索引或修改结果。

## 来源、判据与边界

开发集来源记录：Crossref170篇、DataCite120篇、Europe PMC70篇、Open Library40篇；保留集分别40、30、20、10篇。各来源规模是本次抽样数，不是系统数据库总量。Europe PMC可能转引PubMed，OpenAlex也可能使用Crossref；多库命中不必然是多份独立证据。

金标准由独立Python脚本从公开来源的书目字段提取，再构造格式变化和受控冲突。未完成双人原文标注，来源元数据本身也可能有错；因此这是外部来源记录一致性评测，不能证明所有文献的真实性、学术质量或引用是否恰当。人工标注表的两名审核者和仲裁栏保持空白。

真实性确认依据文献身份字段及来源记录；年份、卷期页等差异另列。中文参考著录继续采用GB/T 7714—2025；英文保留可接受写法，不因姓名缩写或不同引用规范直接判错。新增DataCite、Europe PMC和PubMed题录匹配等实际范围见[来源说明](../SOURCES.md)。

## 后续优先改进

1. 无ISBN、无类型标识的图书识别：利用更多出版者和目录线索调用图书来源，并确认具体版次，避免强行套用作品级年份。
2. 双人独立原文标注：优先核对尚有差异的20项及跨库作者/年份冲突，仲裁后冻结新标签，再评价误确认率、漏确认率与字段纠错精度。
3. 新收集的自然错误和真实用户输入：与现有生成式用例分开，覆盖中文期刊、学位论文、网页、报告和不同英文规范。报告分类型覆盖率与时延，不用一个总数代替所有能力。

## 复现和审计

公开来源请求与摘要在collection-log.json；分享的source-records只保留书目字段，不发布原始完整API响应。manifest含压缩数据SHA-256。源记录不写入生产预置索引。

```bash
# 解压results.json.gz可以阅读本轮逐条结果。复现快照测试不需要联网：
node reference-checker/evaluation/run.mjs replay
node reference-checker/evaluation/run.mjs replay --holdout
# 联网抽测会重新访问公开服务，结果可能变化：
node reference-checker/evaluation/run.mjs live 20
node reference-checker/evaluation/run.mjs live 5 --holdout
```

重新采集数据需运行collect.py；build.py构建开发集，holdout.py构建排除开发集及预置题名的保留集。原始采集响应不入库，后续接口更新可能使重新构建的数据发生变化；本轮冻结的gz文件与摘要才是本轮结果的依据。

## 可用于答辩的表述

“系统联查公开书目来源，以可追溯记录和身份字段匹配确认文献存在，并把事实差异与格式问题分别处理。目前已用500篇外部作品形成1,300条测试输入；其中独立保留集300条，有290条符合预期，100条标准输入全部匹配。另做100篇实时抽测，99篇取得对应记录。这些是限定样本下的自动评测结果，还没有完成双人原文标注，不能直接称为普遍适用的真实性准确率。当前通过公开接口与规则提高效率，没有要求每次调用付费AI；AI可留作后续可选辅助。”
'''
(ROOT/'README.md').write_text(readme)
content=html.escape(readme)
# A self-contained readable report; Markdown source is retained for exact audit.
import re
paragraphs=[];table=[];code=False
for line in readme.splitlines():
 if line.startswith('```'):
  if code:paragraphs.append('</code></pre>')
  else:paragraphs.append('<pre><code>')
  code=not code;continue
 if code:paragraphs.append(html.escape(line)+'\n');continue
 if line.startswith('|'):
  cells=[c.strip() for c in line.strip('|').split('|')]
  if all(re.fullmatch('[: -]+',c) for c in cells):continue
  if not table:paragraphs.append('<div class="table"><table>');table.append(True)
  tag='th' if len(table)==1 else 'td';paragraphs.append('<tr>'+''.join(f'<{tag}>{html.escape(c)}</{tag}>' for c in cells)+'</tr>');table.append(True);continue
 if table:paragraphs.append('</table></div>');table=[]
 if not line:continue
 if line.startswith('# '):paragraphs.append('<h1>'+html.escape(line[2:])+'</h1>')
 elif line.startswith('## '):paragraphs.append('<h2>'+html.escape(line[3:])+'</h2>')
 else:paragraphs.append('<p>'+html.escape(line)+'</p>')
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>文证 · 外部评测记录</title><style>body{margin:0;background:#f4efe7;color:#182640;font:16px/1.85 system-ui,"Microsoft YaHei",sans-serif}main{max-width:920px;margin:48px auto;padding:36px;background:#fffdfa;border:1px solid #ded6c9;border-radius:16px}h1{font-size:30px;line-height:1.4}h2{margin-top:36px;font-size:21px;color:#883e36}p{margin:14px 0}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #ded6c9;padding:10px 12px;text-align:left;vertical-align:top}th{background:#f4efe7}pre{white-space:pre-wrap;background:#f4efe7;padding:18px;border-radius:8px;font-size:13px}.table{overflow:auto}a{color:#883e36}nav{display:flex;gap:15px;flex-wrap:wrap;font-size:14px}@media(max-width:650px){main{margin:12px;padding:20px}h1{font-size:25px}}</style><main><nav><a href="../">返回核验工具</a><a href="README.md">下载文字说明</a><a href="replay-results.json.gz">开发集逐条结果</a><a href="holdout/replay-results.json.gz">保留集逐条结果</a><a href="human-review.csv.gz">待人工标注表</a></nav>'''+''.join(paragraphs)+'</main></html>'
(ROOT/'report.html').write_text(page)
print(json.dumps(summary,ensure_ascii=False,indent=2))
