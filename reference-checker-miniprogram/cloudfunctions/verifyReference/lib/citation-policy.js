/* Shared by the website and the verification cloud function. No network calls. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CitationPolicy = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const VERSION = '2026.10.22-gb2025-1';
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
    return text.replace(/([^,;&，；]+),\s*((?:[A-ZÀ-ÖØ-Þ]\.?(?:\s*[- ]\s*|(?=[,;&]|$))){1,6})(?=\s*(?:[,;&]|\band\b|$))/g, (all,family,initials) => /^(?:[A-Z]\s*)+$/.test(family.trim()) ? all : family + '\ue000 ' + initials)
      .split(/\s*(?:[,，、;；&]|\band\b)\s*/i).map(name => name.replace(/\ue000/g, ',').trim().replace(/[.\s]+$/, '')).filter(Boolean);
  }
  function person(value) {
    const text = String(value || '').trim().replace(/[’‘]/g, "'");
    if (/^[\u3400-\u9fff\s·]+$/.test(text)) return {family: norm(text), given: []};
    const comma = text.indexOf(',');
    let family, given;
    if (comma >= 0) { family = text.slice(0, comma); given = text.slice(comma + 1); }
    else {
      const tokens = text.split(/\s+/).filter(Boolean);
      const tail = tokens.slice(1).join(' ');
      if (tokens.length > 1 && /^(?:[A-Z]\.?(?:[ -]|$))+$/u.test(tail)) { family = tokens[0]; given = tail; }
      else {
        let start = tokens.length - 1;
        while (start > 0 && /^(?:de|del|der|den|van|von|di|du|la|le|da|dos)$/i.test(tokens[start - 1])) start--;
        family = tokens.slice(start).join(' '); given = tokens.slice(0,start).join(' ');
      }
    }
    const givenTokens = String(given).split(/[\s.\-]+/).filter(Boolean).flatMap(token => /^[A-Z]{2,5}$/.test(token) ? token.split('') : [token]);
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
      authority: candidate.evidenceStrength !== 'search-snippet' && (!!candidate.officialRecord || /官方|官网|原文|正式题录|DOI 注册元数据|Crossref/.test(source)),
      authors: candidate.authors || [],
      acceptedYears: candidate.acceptedYears || [],
      partialFields: candidate.partialFields || [],
      publicationDateRole: candidate.publicationDateRole || ''
      ,record: Object.fromEntries(['title','authors','container','year','publicationDate','citationDate','volume','issue','pages','doi','isbn','type','online','sourceUrl','edition','version','publicationPlace','acceptedYears'].map(key => [key, candidate[key]]))
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
    const formatted = e.record && confirmed ? formatGb2025(e.record, parsed) : {text: '', warnings: []};
    const chinese = /[\u3400-\u9fff]/.test(parsed.title || '');
    const formatChecks = formatted.warnings.slice();
    if (chinese) for (const d of observations.filter(item=>item.submitted==='未提供' && ['卷号','期号','页码'].includes(item.field))) formatChecks.push(`${d.field}：来源提供 ${d.verified}；按第8.5条结合实际引文页码核对补充，不据此判文献虚假`);
    if (chinese && !/\[(?:J|M|R|D|C|EB|DB|N|S|P|PP|DS)(?:\/OL)?\]/i.test(parsed.raw || '')) formatChecks.unshift('文献类型标识为必备项，请按实际文献类型补充（7.3及第8章）');
    const status = confirmed ? factual.length ? 'corrected' : observations.length || result.status === 'partial' ? 'partial' : 'verified' : result.status;
    let note = result.note || '';
    if (confirmed) {
      note = `已在 ${result.source || '公开来源'} 确认文献真实存在。`;
      if (factual.length) note += ' 原始或注册记录支持下列字段差异，建议核对；格式差异不影响真实性。';
      if (observations.length) note += ' 另有来源差异或补充信息待您判断，系统保留原著录，不直接判错。';
      if (equivalent.length) note += ' 已容忍姓名缩写或其他等价写法。';
      if (!factual.length && !observations.length) note += ' 已核对字段未见明确冲突；这不代表完整格式审校。';
      if (e.partialFields?.length) note += ` 来源未完整提供${e.partialFields.join('、')}。`;
    }
    if (status === 'error') note = `本次核验服务未完成，不代表文献虚假。${note.replace(/^核验失败[：:]?/, '')}`;
    return {...result, status, note, differences: factual, accuracyDifferences: factual, observations,
      equivalentForms: [...new Set(equivalent)], citationStyle: detectStyle(parsed.raw || result.submitted),
      canonical: formatted.text, formatChecks,
      canonicalStandard: formatted.text ? 'GB/T 7714—2025' : '',
      canonicalLabel: chinese ? '国标著录草稿' : '可选国标格式转换（不代表原格式有误）',
      canonicalComplete: formatChecks.length === 0 && !!e.record,
      canonicalPurpose: 'optional-conversion', citationPolicy: VERSION};
  }
  return {VERSION, splitAuthors, compareName, authorsRelation, detectStyle, evidence, applyResult, equivalentSource, formatGb2025, pagesCompatible};
});
