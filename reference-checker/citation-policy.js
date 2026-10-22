/* Shared by the website and the verification cloud function. No network calls. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CitationPolicy = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const VERSION = '2026.10.22-v23';
  const norm = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '');
  const groups = [
    ['IFLA', 'International Federation of Library Associations and Institutions'],
    ['ALA', 'American Library Association'],
    ['UNESCO', 'United Nations Educational, Scientific and Cultural Organization'],
    ['WHO', 'World Health Organization'],
    ['OECD', 'Organisation for Economic Co-operation and Development']
  ];
  function corporate(value) {
    return /\b(?:association|federation|organization|organisation|university|institute|council|committee|commission|unesco|ifla|ala|who|oecd)\b/i.test(String(value || ''));
  }
  function groupIdentity(value) {
    const text = String(value || '').trim(), key = norm(text);
    for (const [abbr, full] of groups) {
      if ([abbr, full, `${full} (${abbr})`].some(item => norm(item) === key)) return {key: norm(full), root: abbr};
      if (new RegExp(`^${abbr}\\s+`, 'i').test(text)) return {key, root: abbr, subordinate: true};
    }
    const expansion = text.match(/^(.+?)\s*\(([A-Z][A-Z0-9]{1,10})\)$/);
    return {key: expansion ? norm(expansion[1]) : key, abbreviation: expansion?.[2] || ''};
  }
  function splitAuthors(value) {
    const text = String(value || '').replace(/\bet\s+al\.?/ig, '').replace(/(?:,|，|、|;|；)?\s*等\.?\s*$/, '').trim();
    if (corporate(text)) return text.split(/\s*[;；]\s*/).filter(Boolean);
    // A comma followed by initials belongs to that person, including C., & ...
    return text.replace(/([^,;&，；]+),\s*((?:[A-ZÀ-ÖØ-Þ]\.?(?:\s*[- ]\s*|(?=[,;&]|$))){1,6})(?=\s*(?:[,;&]|\band\b|$))/g, (all,family,initials) => /^(?:[A-Z]\s+)+[A-Z]$|^[A-Z]$/.test(family.trim()) ? all : family + '\ue000 ' + initials)
      .split(/\s*(?:[,，、;；&]|\band\b)\s*/i).map(name => name.replace(/\ue000/g, ',').trim().replace(/[.\s]+$/, '')).filter(Boolean);
  }
  function person(value, natural = false) {
    const text = String(value || '').trim().replace(/[’‘]/g, "'");
    if (/^[\u3400-\u9fff\s·]+$/.test(text)) return {family: norm(text), given: []};
    const comma = text.indexOf(',');
    let family, given;
    if (comma >= 0) { family = text.slice(0, comma); given = text.slice(comma + 1); }
    else {
      const tokens = text.split(/\s+/).filter(Boolean);
      const trailing=text.match(/^(.+?)\s+((?:\p{Lu}\.?){1,6}|(?:\p{Lu}\.?(?:[ -]|$))+)$/u);
      if (!natural && trailing) { family = trailing[1]; given = trailing[2]; }
      else {
        let start = tokens.length - 1;
        while (start > 0 && /^(?:de|del|der|den|van|von|di|du|la|le|da|dos)$/i.test(tokens[start - 1])) start--;
        family = tokens.slice(start).join(' '); given = tokens.slice(0,start).join(' ');
      }
    }
    const givenTokens = String(given).split(/[\s.\-]+/).filter(Boolean).flatMap(token => /^\p{Lu}{2,6}$/u.test(token) ? token.split('') : [token]);
    return {family: norm(family), familyRaw: family, given: givenTokens.map(norm).filter(Boolean)};
  }
  function compareName(a, b) {
    if (norm(a) === norm(b)) return 'equivalent';
    if (corporate(a) || corporate(b)) {
      const left = groupIdentity(a), right = groupIdentity(b);
      if (left.key === right.key || left.abbreviation && norm(left.abbreviation) === norm(b) || right.abbreviation && norm(right.abbreviation) === norm(a)) return 'equivalent';
      if (left.root && left.root === right.root) return 'related';
      return 'conflict';
    }
    const inverted=value=>{const comma=String(value).indexOf(',');return comma>=0?norm(String(value).slice(comma+1)+' '+String(value).slice(0,comma)):norm(value);};
    if(inverted(a)===inverted(b))return 'equivalent';
    const optionsA=[person(a),person(a,true)],optionsB=[person(b),person(b,true)];
    const align=(value,known)=>{if(String(value).includes(',')||!known.familyRaw)return null;const tokens=String(value).split(/\s+/).filter(Boolean),n=known.familyRaw.trim().split(/\s+/).length;if(tokens.length<=n||norm(tokens.slice(-n).join(' '))!==known.family)return null;return person(known.familyRaw+', '+tokens.slice(0,-n).join(' '));};
    for(const known of optionsB.slice()){const aligned=align(a,known);if(aligned)optionsA.push(aligned);}
    for(const known of optionsA.slice()){const aligned=align(b,known);if(aligned)optionsB.push(aligned);}
    const matches=[];
    for(const left of optionsA)for(const right of optionsB){
      if(!left.family||left.family!==right.family)continue;
      if(!left.given.length||!right.given.length){matches.push('ambiguous');continue;}
      const count=Math.min(left.given.length,right.given.length);
      if(left.given.slice(0,count).every((l,i)=>{const r=right.given[i];return l===r||l.length===1&&r.startsWith(l)||r.length===1&&l.startsWith(r);}))matches.push(left.given.length===right.given.length?'equivalent':'ambiguous');
    }
    if(matches.includes('equivalent'))return 'equivalent';if(matches.includes('ambiguous'))return 'ambiguous';
    const left = person(a), right = person(b);
    if (!left.family || left.family !== right.family) return 'conflict';
    if (!left.given.length || !right.given.length) return 'ambiguous';
    const length = Math.min(left.given.length, right.given.length);
    for (let i = 0; i < length; i++) {
      const l = left.given[i], r = right.given[i];
      if (l !== r && !(l.length === 1 && r.startsWith(l) || r.length === 1 && l.startsWith(r))) return 'conflict';
    }
    return left.given.length === right.given.length ? 'equivalent' : 'ambiguous';
  }
  function authorsRelation(submitted, actual) {
    const left = splitAuthors(submitted), right = Array.isArray(actual) ? actual : splitAuthors(actual);
    const trimmed=String(submitted||'').replace(/\bet\s+al\.?/ig,'').replace(/(?:,|，|、|;|；)?\s*等\.?\s*$/,'').trim();
    const abbreviated=/\bet\s+al\b|等|…/i.test(String(submitted));
    // Preserve commas inside full inverted names and organizational names when
    // the submitted author sequence is an exact serialization of source names.
    if(right.length&&[right.length,...(abbreviated?right.map((_,i)=>i+1):[])].some(n=>norm(trimmed)===norm(right.slice(0,n).join(', '))))return {kind:'equivalent',score:1};
    if (!left.length || !right.length) return {kind: 'unknown', score: .5};
    if (left.every(name=>!corporate(name) && /^(?:[A-Z]\s*){2,6}$/.test(name))) return {kind:'ambiguous',score:.55};
    const ordered = left.map((name, i) => i < right.length ? compareName(name, right[i]) : 'conflict');
    const truncated = /\bet\s+al\b|等|…|\.\s*\.\s*\./i.test(String(submitted));
    if (ordered.every(kind => kind === 'equivalent') && (left.length === right.length || truncated && left.length < right.length)) return {kind: 'equivalent', score: 1};
    if (ordered.every(kind => ['equivalent', 'ambiguous'].includes(kind)) && left.length <= right.length) return {kind: 'ambiguous', score: .7};
    if (left.length === 1 && right.length === 1 && ordered[0] === 'related') return {kind: 'related', score: .7};
    if (left.length === right.length && left.every(name => right.some(other => compareName(name, other) === 'equivalent'))) return {kind: 'order', score: .85};
    const matched = left.filter(name => right.some(other => ['equivalent', 'ambiguous'].includes(compareName(name, other)))).length;
    return {kind: 'conflict', score: matched ? .65 + .35 * matched / Math.max(left.length, right.length) : 0};
  }
  function detectStyle(raw) {
    const text = String(raw || '').replace(/^\s*\[\d+\]\s*/, '');
    if (/\[(?:J|M|R|D|C|EB|DB|N|S|P)(?:\/OL)?\]/i.test(text)) return {label: 'GB/T 7714 类格式（推测，未判定版年）', certainty: 'family'};
    if (/\((?:18|19|20)\d{2}[a-z]?(?:[,，][^)]*)?\)\s*[.。]/.test(text)) return {label: '作者—年份制，近似 APA（推测）', certainty: 'family'};
    if (/\b(?:18|19|20)\d{2}\b/.test(text)) return {label: '格式未确定（可能为 Harvard、Chicago、MLA 等或自定义格式）', certainty: 'unknown'};
    return {label: '格式未确定', certainty: 'unknown'};
  }
  function evidence(candidate) {
    const source = [candidate.source, ...(candidate.sources || [])].filter(Boolean).join(' + ');
    return {
      authority: candidate.evidenceStrength !== 'search-snippet' && (!!candidate.officialRecord || candidate.registry===true || /官方|官网|原文|正式题录|DOI 注册元数据|Crossref/.test(source)),
      authors: candidate.authors || [],
      acceptedYears: candidate.acceptedYears || [],
      partialFields: candidate.partialFields || [],
      publicationDateRole: candidate.publicationDateRole || ''
      ,record: Object.fromEntries(['title','authors','container','year','publicationDate','citationDate','volume','issue','pages','doi','isbn','type','online','sourceUrl','edition','version','publicationPlace','acceptedYears','partialFields'].map(key => [key, candidate[key]]))
    };
  }
  function equivalentSource(a, b) {
    if (corporate(a) && corporate(b) && compareName(a,b)==='equivalent') return true;
    const clean = value => norm(String(value || '').replace(/\b(?:the|ebooks?|inc|ltd|limited)\b/ig, ''));
    if (clean(a) && clean(a) === clean(b)) return true;
    const words = value => String(value || '').toLowerCase().replace(/[.]/g,'').split(/[^a-z0-9]+/).filter(word => word && !['of','and','the','for','in'].includes(word));
    const left = words(a), right = words(b);
    return left.length >= 2 && left.length === right.length && left.every((word,i)=> (word==='j' && right[i]==='journal' || word==='journal' && right[i]==='j') || word.length>=2 && right[i].length>=2 && (word.startsWith(right[i]) || right[i].startsWith(word)));
  }
  function pagesCompatible(submitted, actual) {
    if (norm(submitted) === norm(actual)) return true;
    const range = String(actual).match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (!range) return false;
    return String(submitted).split(/[,，]/).every(part => {
      const match = part.trim().match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
      return match && Number(match[1])>=Number(range[1]) && Number(match[2]||match[1])<=Number(range[2]) && Number(match[1])<=Number(match[2]||match[1]);
    });
  }
  function gbType(record, parsed) {
    const type = String(record.type || '').toLowerCase();
    const code = /preprint|posted-content/.test(type) ? 'PP' : /dataset/.test(type) ? 'DS' : /webpage|web-site/.test(type) ? 'EB' : /book/.test(type) ? 'M' : /dissertation|thesis/.test(type) ? 'D' : /report/.test(type) ? 'R' : /standard/.test(type) ? 'S' : /patent/.test(type) ? 'P' : /newspaper/.test(type) ? 'N' : /proceedings|conference/.test(type) ? 'C' : /article|journal/.test(type) ? 'J' : String(parsed.type || '').split('/')[0];
    return code && (record.online || parsed.url && code==='R' || String(parsed.type || '').includes('/OL') || ['EB','PP','DS'].includes(code)) ? code + '/OL' : code;
  }
  function gbName(value) {
    if (/[\u3400-\u9fff]/.test(value) || corporate(value)) return value;
    const text = String(value).trim(), p = person(text);
    // Preserve surname spelling/capitalization; the 2025 rule does not require all caps.
    const family = p.familyRaw || text;
    return family + (p.given.length ? ' ' + p.given.map(token => token[0].toUpperCase()).join(' ') : '');
  }
  function formatGb2025(record, parsed) {
    const type = gbType(record, parsed), base = type.split('/')[0], warnings = [];
    if (!['J','M','D','R','EB','PP','DS','S','C','N'].includes(base)) return {text: '', warnings: ['当前文献类型尚不能可靠生成国标格式，请按原始文献著录']};
    const names = record.authors?.length ? record.authors : splitAuthors(parsed.authors);
    let authors = names.slice(0,3).map(gbName).join(', ');
    if (names.length > 3 || /\bet\s+al\b|等/i.test(parsed.authors || '')) authors += /[\u3400-\u9fff]/.test(authors) ? ', 等' : ', et al';
    const title = record.title || parsed.title;
    if (!title) return {text:'',warnings:['题名不足，未生成国标格式']};
    const source = record.container || parsed.container || '', year = record.year || parsed.year || '';
    const date = record.citationDate || record.publicationDate || year;
    const edition = record.edition || parsed.edition || '', version = record.version || parsed.version || '';
    const volume = record.volume || parsed.volume || '', issue = record.issue || parsed.issue || '';
    // Citation pages and article page ranges are not interchangeable (8.5.1.1).
    const pages = base==='J' && record.pages && !pagesCompatible(parsed.pages,record.pages) ? record.pages : parsed.pages || (base === 'J' ? record.pages : '') || '';
    const url = /\/OL$/.test(type) ? record.sourceUrl || parsed.url || (record.doi ? 'https://doi.org/' + record.doi : '') : '';
    let text = `${authors ? authors + '. ' : ''}${title}[${type}]`;
    const place = record.publicationPlace || (/^[^:：]{1,45}[:：]/.test(parsed.container || '') ? parsed.container.split(/[:：]/)[0] : '');
    const publisher = source.replace(place ? new RegExp('^' + place.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '[:：]\\s*') : /^\b\B/, '');
    if (['EB','PP','DS'].includes(base)) {
      if (version) text += `. V${version}`;
      if (base !== 'EB' && source) text += '. ' + source;
      text += date ? `. (${date})` : '.';
      if (parsed.accessDate) text += `[${parsed.accessDate}]`; else warnings.push('引用日期必备；请填写实际引用日期，系统不代填（7.6、8.11/8.14/8.15）');
    } else if (base === 'R') {
      if (version) text += `. V${version}`;
      text += date ? '. ' + date : '';
      if (pages) text += ':' + pages;
      if (String(date).length < 10) warnings.push('报告发布日期未完整，需以原文核对（7.5.4.2、8.8）');
    } else if (base === 'S') {
      // Standards use number + name under 8.9, not publisher/year of a book.
      if (parsed.standardNumber && !norm(title).includes(norm(parsed.standardNumber))) text = `${parsed.standardNumber} ${title}[${type}]`;
    } else if (['M','D'].includes(base)) {
      if (edition) text += '. ' + edition.replace(/[.。]+$/, '');
      if (publisher) text += '. ' + (place ? place + ':' : '') + publisher;
      if (year) text += (publisher ? ', ' : '. ') + year;
      if (pages) text += ':' + pages;
      if (!place) warnings.push('出版地或学位授予单位所在地待原文补核，不能由检索缺项推断为“出版地不详”（8.2/8.7）');
      if (!publisher) warnings.push('出版者或学位授予单位待补核（8.2/8.7）');
    } else {
      if (source) text += (base === 'C' ? '//' : '. ') + source;
      if (year) text += (source ? ', ' : '. ') + year;
      if (volume) text += ', ' + volume;
      if (issue) text += '(' + issue + ')';
      if (pages) text += ':' + pages;
      if (base === 'C') warnings.push('会议录与会议析出文献须按实际出版形态核对会议名称、年份和出处（8.6）');
    }
    text = text.replace(/[.。]+$/, '') + '.';
    if (url) text += ' ' + url.replace(/[.。]+$/, '') + '.';
    if (record.doi && !String(url).toLowerCase().includes(String(record.doi).toLowerCase())) text += ' DOI:' + record.doi + '.';
    if (/\/OL$/.test(type) && !url) warnings.push('电子资源获取路径待补核（7.8）');
    return {text, warnings};
  }
  function sourceCitation(record, parsed) {
    // A source citation must not silently inherit unverified submitted fields.
    const partial=record.partialFields||[];
    if(partial.includes('其余作者'))record={...record,authors:[]};
    if(partial.includes('末页'))record={...record,pages:''};
    const journal=/article|journal/i.test(String(record.type||''));
    const supportedPages=journal&&record.pages&&parsed.pages&&pagesCompatible(parsed.pages,record.pages)?parsed.pages:'';
    const safe={raw:'',authors:'',title:'',type:'',container:record.container||'',pages:supportedPages,accessDate:parsed.accessDate||''};
    const formatted=formatGb2025(record,safe),warnings=formatted.warnings.slice();
    if(!record.authors?.length)warnings.push('作者尚未取得，请核对原文。');
    if(!record.year&&!record.publicationDate&&!record.citationDate)warnings.push('出版年份或日期尚未取得。');
    if(journal&&!record.container)warnings.push('刊名尚未取得。');
    if(journal&&!record.pages)warnings.push('页码或文章编号尚未取得。');
    for(const [field,label]of [['edition','版次'],['version','版本'],...(journal?[['volume','卷号'],['issue','期号']]:[])])if(parsed[field]&&!record[field])warnings.push(`提交的${label}尚未核实，下列著录不代填该项。`);
    if(parsed.pages&&!journal)warnings.push('原著录引文页码尚未核实，未纳入下列来源著录。');
    if(record.partialFields?.length)warnings.push('来源信息待补：'+record.partialFields.join('、')+'。');
    return {...formatted,warnings:[...new Set(warnings)]};
  }
  function sameCitation(a,b) {
    const key=value=>{
      const text=String(value||'').normalize('NFKC').replace(/^\s*(?:\[\s*\d+\s*\]|[（(]\s*\d+\s*[）)]|\d+[.、)])\s*/,'');
      const doi=(text.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0]||'').replace(/[.,;:]+$/,'').toLowerCase();
      const urls=(text.match(/https?:\/\/[^\s<>]+/ig)||[]).filter(u=>!/^https?:\/\/(?:dx\.)?doi\.org\//i.test(u)).map(u=>u.replace(/[.,;。]+$/,'')).join('|');
      return [norm(text.replace(/\(\s*0+(\d+)\s*\)/g,'($1)')),doi,urls].join('\u0000');
    };
    return key(a)===key(b);
  }
  function citationPresentation(result,parsed,e,formatted,factual,confirmed) {
    const text=formatted.text,review=result.status==='review',chinese=/[\u3400-\u9fff]/.test(parsed.title||'');
    const changes=factual.map(d=>d.field),record=e.record||{};
    for(const [field,label]of [['authors','作者'],['container','来源'],['year','年份'],['volume','卷号'],['issue','期号'],['pages','页码'],['doi','DOI'],['edition','版次'],['version','版本']]){
      const absent=field==='authors'?!splitAuthors(parsed.authors).length:!parsed[field];
      if(absent&&(Array.isArray(record[field])?record[field].length:record[field]))changes.push('补充'+label);
    }
    if(!parsed.type&&record.type)changes.push('补充文献类型');
    const unchanged=!!text&&!review&&!factual.length&&sameCitation(parsed.raw||result.submitted,text);
    const optional=confirmed&&!chinese&&!factual.length&&!changes.length;
    const complete=!!text&&!!e.authority&&!formatted.warnings.length;
    const label=review?'匹配记录的著录':optional?'可选国标格式':complete?'核对后的著录':'来源参考著录（待补核）';
    return {showCanonical:!!text&&!unchanged,canonicalOpen:!!text&&!unchanged&&(review||!optional),canonicalUnchanged:unchanged,
      canonicalLabel:label,canonicalComplete:complete,canonicalCopyLabel:review?'复制匹配记录':complete?'复制著录':'复制草稿',
      canonicalWarnings:formatted.warnings,canonicalChanges:[...new Set(changes)],
      canonicalNote:review?'请先确认这是否是您要引用的文献。':optional?'按国标转换，原有英文格式可保留。':changes.length?'已核对并整理：'+[...new Set(changes)].join('、')+'。':complete?'依据来源记录整理，可复制使用。':'仅列出来源中已取得的信息。',
      canonicalPurpose:review?'candidate-record':optional?'optional-conversion':'source-citation'};
  }
  function applyResult(result, parsed) {
    if (result.citationPolicy === VERSION) return result;
    const e = result.citationEvidence || {authority: /官方|官网|原文|正式题录|DOI 注册元数据|Crossref/.test(result.source || '')};
    const factual = [], observations = [], equivalent = [];
    for (const difference of result.differences || []) {
      const d = {...difference};
      if (d.field === '作者') {
        const relation = authorsRelation(d.submitted, e.authors?.length ? e.authors : d.verified);
        if (relation.kind === 'equivalent') { equivalent.push('作者全写、缩写或姓名顺序写法等价'); continue; }
        if (['ambiguous', 'related'].includes(relation.kind)) {
          observations.push({...d, reason: relation.kind === 'related' ? '机构与下属机构的责任关系需核对，不能视为普通缩写，也不直接判错' : '姓名缩写、作者名单或中间名信息不完整，不能据此确认有误'}); continue;
        }
      }
      if (d.field==='页码' && pagesCompatible(d.submitted,d.verified)) { equivalent.push('引文页码在文章页码范围内（8.5.1.1）'); continue; }
      if (/来源|刊名/.test(d.field) && equivalentSource(d.submitted, d.verified)) { equivalent.push('出版者或来源名称的常见写法等价'); continue; }
      if (/网址/.test(d.field) || /官网全称/.test(d.field)) { observations.push({...d, reason: '最终网址或网页标题显示差异，不直接视为著录错误'}); continue; }
      if (/年份|发布日期/.test(d.field) && (e.acceptedYears || []).map(String).includes(String(d.submitted).slice(0, 4))) { equivalent.push('年份与同一记录提供的出版日期之一相符'); continue; }
      const missing = !d.submitted || d.submitted === '未提供';
      if (d.field!=='DOI' && (missing || !e.authority || /文献类型/.test(d.field) && !/\[(?:J|M|R|D|C|EB|DB|N|S|P)/i.test(parsed.raw || ''))) {
        observations.push({...d, reason: missing ? '来源提供了补充字段；是否必填取决于采用的规范' : '当前来源不足以确证原著录有误，保留原文供核对'});
      } else factual.push({...d, evidence: result.source || '原始记录'});
    }
    const confirmed = ['verified', 'partial', 'corrected'].includes(result.status);
    const formatted = e.record && (confirmed||result.status==='review') ? sourceCitation({...e.record,partialFields:e.record.partialFields||e.partialFields||[]}, parsed) : {text: '', warnings: []};
    const chinese = /[\u3400-\u9fff]/.test(parsed.title || '');
    const formatChecks = formatted.warnings.slice();
    if (chinese) for (const d of observations.filter(item=>item.submitted==='未提供' && ['卷号','期号','页码'].includes(item.field))) formatChecks.push(`${d.field}：来源提供 ${d.verified}；按第8.5条结合实际引文页码核对补充，不据此判文献虚假`);
    if (chinese && !/\[(?:J|M|R|D|C|EB|DB|N|S|P|PP|DS)(?:\/OL)?\]/i.test(parsed.raw || '')) formatChecks.unshift('文献类型标识为必备项，请按实际文献类型补充（7.3及第8章）');
    const status = confirmed ? factual.length ? 'corrected' : observations.length || result.status === 'partial' ? 'partial' : 'verified' : result.status;
    const detailsNote = result.detailsNote || result.note || '';
    let note = detailsNote;
    if (confirmed) note = factual.length ? `已找到对应文献，请核对以下${factual.length}项。` : observations.length || result.status==='partial' ? `已找到对应文献，部分信息待核对。` : `已在${result.source || '公开来源'}找到对应文献。`;
    else if(status==='review')note='找到匹配记录，请确认是否为所引文献。';
    else if(status==='unverified')note=result.checkedSources?.length?'暂未找到足够证据，请查看复核链接。':'核验源暂未响应，请重试或查看复核链接。';
    else if(status==='error')note='服务暂不可用，请稍后重试。';
    return {...result, status, note, detailsNote, displayStyle: chinese ? "" : detectStyle(parsed.raw || result.submitted).certainty==="family" ? (detectStyle(parsed.raw || result.submitted).label.startsWith("作者")?"著者—出版年制（初步识别）":"GB/T 7714式") : "未识别", differences: factual, accuracyDifferences: factual, observations,
      equivalentForms: [...new Set(equivalent)], citationStyle: detectStyle(parsed.raw || result.submitted),
      canonical: formatted.text, formatChecks,
      canonicalStandard: formatted.text ? 'GB/T 7714—2025' : '',
      ...citationPresentation(result,parsed,e,formatted,factual,confirmed), citationPolicy: VERSION};
  }
  return {VERSION, splitAuthors, compareName, authorsRelation, detectStyle, evidence, applyResult, equivalentSource, formatGb2025, pagesCompatible,sourceCitation,sameCitation};
});
