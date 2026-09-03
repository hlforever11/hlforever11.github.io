import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const between=(startMarker,endMarker)=>{
  const start=html.indexOf(startMarker),end=html.indexOf(endMarker,start);
  assert.notEqual(start,-1,`未找到代码起点：${startMarker}`);
  assert.notEqual(end,-1,`未找到代码终点：${endMarker}`);
  return html.slice(start,end);
};

const parserBlock=between('    const normalizeText=','    const hasHan=');
const typeBlock=between('    function candidateGbType','    function scoreCandidate');
const citationBlock=between('    function displayName','    function missingMetadataFields');
const differenceBlock=between('    function differences','    async function verifyOneLocal');
const cacheBlock=between('    const TRUSTED_REFERENCE_CACHE=',';\n    const $=');
const api=new Function(`${parserBlock}\n${typeBlock}\n${citationBlock}\n${differenceBlock}\n${cacheBlock};return{parseReference,conventionalReference,canonicalCitation,differences,TRUSTED_REFERENCE_CACHE};`)();

const cases=[
  {raw:'[1] 我国刑事证据能力之理论归纳及思考[J]. 纵博.法学家,2015(03)',title:'我国刑事证据能力之理论归纳及思考',authors:'纵博',container:'法学家',year:2015,issue:'3',canonical:'纵博. 我国刑事证据能力之理论归纳及思考[J]. 法学家, 2015(3):72-85.'},
  {raw:'[2] “热”与“冷”:非法证据排除规则适用的实证研究[J]. 左卫民.法商研究,2015(03)',title:'“热”与“冷”:非法证据排除规则适用的实证研究',authors:'左卫民',container:'法商研究',year:2015,issue:'3',canonical:'左卫民. “热”与“冷”:非法证据排除规则适用的实证研究[J]. 法商研究, 2015, 32(3):151-160.'},
  {raw:'[3] 论侦查中心主义[J]. 陈瑞华.政法论坛,2017(02)',title:'论侦查中心主义',authors:'陈瑞华',container:'政法论坛',year:2017,issue:'2',canonical:'陈瑞华. 论侦查中心主义[J]. 政法论坛, 2017, 35(2):3-19.'},
  {raw:'[4] 《关于全面推进以审判为中心的刑事诉讼制度改革的实施意见》的理解与适用[J]. 戴长林;刘静坤.人民司法(应用),2017(10)',title:'《关于全面推进以审判为中心的刑事诉讼制度改革的实施意见》的理解与适用',authors:'戴长林;刘静坤',container:'人民司法(应用)',year:2017,issue:'10',canonical:'戴长林, 刘静坤. 《关于全面推进以审判为中心的刑事诉讼制度改革的实施意见》的理解与适用[J]. 人民司法(应用), 2017(10):22-34.'},
  {raw:'[5] 中国法语境中的“排除合理怀疑”[J]. 龙宗智.中外法学,2012(06)',title:'中国法语境中的“排除合理怀疑”',authors:'龙宗智',container:'中外法学',year:2012,issue:'6',canonical:'龙宗智. 中国法语境中的“排除合理怀疑”[J]. 中外法学, 2012, 24(6):1124-1144.'},
  {raw:'[6] 刑事证据审查的基本制度结构[J]. 吴洪淇.中国法学,2017(06)',title:'刑事证据审查的基本制度结构',authors:'吴洪淇',container:'中国法学',year:2017,issue:'6',canonical:'吴洪淇. 刑事证据审查的基本制度结构[J]. 中国法学, 2017(6):167-186.'},
  {raw:'[7] “不得作为定案根据”条款的学理解析[J]. 纵博.法律科学(西北政法大学学报),2014(04)',title:'“不得作为定案根据”条款的学理解析',authors:'纵博',container:'法律科学(西北政法大学学报)',year:2014,issue:'4',canonical:'纵博. “不得作为定案根据”条款的学理解析[J]. 法律科学(西北政法大学学报), 2014, 32(4).'},
  {raw:'[8] 论无证据能力的证据——兼评我国的证据能力规则[J]. 万毅.现代法学,2014(04)',title:'论无证据能力的证据——兼评我国的证据能力规则',authors:'万毅',container:'现代法学',year:2014,issue:'4',canonical:'万毅. 论无证据能力的证据——兼评我国的证据能力规则[J]. 现代法学, 2014, 36(4):131-145.'},
  {raw:'[9] 西方自我宽恕模型研究进展[J]. 刘凌;马旭颖;沈悦.辽宁师范大学学报(社会科学版),2013(02)',title:'西方自我宽恕模型研究进展',authors:'刘凌;马旭颖;沈悦',container:'辽宁师范大学学报(社会科学版)',year:2013,issue:'2',canonical:'刘凌, 马旭颖, 沈悦. 西方自我宽恕模型研究进展[J]. 辽宁师范大学学报(社会科学版), 2013, 36(2):211-215.'},
  {raw:'[10] 证据属性层次论——基于证据规则结构体系的理论反思[J]. 郑飞.法学研究,2021(02)',title:'证据属性层次论——基于证据规则结构体系的理论反思',authors:'郑飞',container:'法学研究',year:2021,issue:'2',canonical:'郑飞. 证据属性层次论——基于证据规则结构体系的理论反思[J]. 法学研究, 2021, 43(2):123-137.'}
];

test('识别 CNKI 篇名在前的期刊导出格式',()=>{
  for(const item of cases){
    const parsed=api.parseReference(item.raw);
    assert.equal(parsed.cnkiTitleFirst,true,item.title);
    assert.equal(parsed.title,item.title);
    assert.equal(parsed.authors,item.authors);
    assert.equal(parsed.container,item.container);
    assert.equal(parsed.year,item.year);
    assert.equal(Number(parsed.issue),Number(item.issue));
    assert.match(api.conventionalReference(parsed),new RegExp(`^${item.authors.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\. `));
  }
});

test('生成 GB/T 7714—2015 期刊建议著录并指出缺项',()=>{
  for(const item of cases){
    const parsed=api.parseReference(item.raw),record=api.TRUSTED_REFERENCE_CACHE.find(candidate=>candidate.title===item.title);
    assert.ok(record,`缺少可靠题录：${item.title}`);
    assert.equal(api.canonicalCitation(record,parsed),item.canonical);
    const differences=api.differences(parsed,record,{titleScore:1,authorScore:1,containerScore:1});
    if(record.pages)assert.ok(differences.some(difference=>difference.field==='页码'&&difference.submitted==='未提供'),`未提示页码缺失：${item.title}`);
  }
});
