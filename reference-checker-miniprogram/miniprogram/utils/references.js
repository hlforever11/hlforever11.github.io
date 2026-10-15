    function normalizeReferenceInput(value){
      return String(value??'').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/[０-９Ａ-Ｚａ-ｚ［］．－]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0));
    }
    const numberedReferenceStart=/^(?:\[\s*\d{1,3}\s*\]|[\(（]\s*\d{1,3}\s*[\)）]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|\d{1,3}[.、)]|\d{1,3}\s+(?=[A-Za-z\u00c0-\u024f\u3400-\u9fff]))\s*/;
    const bibliographicCue=value=>/(?:18|19|20)\d{2}|\[[A-Z/]+\]|https?:\/\/|10\.\d{4,9}\//i.test(String(value||''));
    function normalizeReferenceChunk(value){return String(value||'').replace(/\s*\n\s*/g,' ').replace(/[\t\u00a0 ]+/g,' ').trim()}
    function looksLikeEnglishAuthorHead(value){
      const head=String(value||'').match(/^(.{2,140}?)[.。](?:\s|$)/)?.[1]?.trim().replace(/\bet\s+al\.?$/i,'').trim();
      if(!head||/\d/.test(head))return false;
      const parts=head.split(/\s*(?:,|;|&|\band\b)\s*/i).map(part=>part.trim()).filter(Boolean);if(!parts.length)return false;
      return parts.every(part=>/^[A-Z][A-Za-z\u00c0-\u024f'’\-]+(?:\s+[A-Z]{1,5}){1,5}$/.test(part)||/^(?:[A-Z]\s+){1,5}[A-Z]$/.test(part)||(/^[A-Z][A-Za-z\u00c0-\u024f'’\-]+(?:\s+[A-Z][A-Za-z\u00c0-\u024f'’\-]+){1,8}$/.test(part)&&/\b(?:Association|Organization|Organisation|University|Institute|Council|Committee|Academy|Library|Libraries)\b/i.test(part)));
    }
    function looksLikeReferenceStart(value){
      const text=String(value||'').trim();if(!text)return false;if(numberedReferenceStart.test(text)||looksLikeEnglishAuthorHead(text))return true;
      const apa=text.match(/^(.{1,140}?)\(\s*((?:18|19|20)\d{2})[a-z]?\s*\)\s*[.。]/u);
      if(apa){
        const author=apa[1].trim().replace(/[.。]\s*$/,'');
        if(/^[A-Za-z\u00c0-\u024f\u3400-\u9fff]/.test(author)&&(/[,，;&；]/.test(author)||/\b(?:and)\b|&/i.test(author)||/^[A-Z][A-Z0-9 .&'’\/-]{1,100}$/.test(author)||/^[A-Z\u00c0-\u00de][A-Za-z\u00c0-\u024f'’.-]*(?:\s+[A-Z\u00c0-\u00de][A-Za-z\u00c0-\u024f'’.-]*){0,7}$/u.test(author)))return true;
      }
      const chineseHead=text.match(/^(.{2,48}?)[.。]/u)?.[1]?.trim().replace(/[,，、]\s*等$/, '');
      return!!(chineseHead&&/^[\u3400-\u9fff·]{2,}(?:\s*[,，、]\s*[\u3400-\u9fff·]{2,}){0,12}$/u.test(chineseHead)&&bibliographicCue(text));
    }
    function inlineNumberedMarkers(clean){
      const bracketed=[...clean.matchAll(/\[\s*(\d{1,3})\s*\]/g)].filter(match=>match.index===0||/[\s。.;；]/.test(clean[match.index-1]||''));
      const bare=[...clean.matchAll(/(^|[。.;；]\s*)(\d{1,3})\s+(?=[A-Za-z\u00c0-\u024f\u3400-\u9fff])/g)]
        .map(match=>({index:match.index+match[1].length}));
      const styled=[...clean.matchAll(/(^|[\s。.;；])(?:\d{1,3}[.、)]|[（(]\d{1,3}[）)]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])\s*(?=[A-Za-z\u00c0-\u024f\u3400-\u9fff])/g)]
        .filter(match=>looksLikeReferenceStart(clean.slice(match.index+match[0].length)))
        .map(match=>({index:match.index+match[1].length}));
      const markers=[...bracketed,...bare,...styled].sort((a,b)=>a.index-b.index).filter((item,index,all)=>!index||item.index!==all[index-1].index);
      return markers.length>=2?markers:[];
    }
    function refs(value){
      let clean=normalizeReferenceInput(value).replace(/\r/g,'').replace(/^\s*(?:参考文献|主要参考文献|引用文献|references|bibliography|works cited)\s*[:：]?\s*/i,'').trim();if(!clean||!clean.replace(/\[\s*\d+\s*\]/g,'').trim())return[];
      const starts=new Set([0]);inlineNumberedMarkers(clean).forEach(marker=>starts.add(marker.index));
      for(const lineBreak of clean.matchAll(/\n+/g)){
        const index=lineBreak.index+lineBreak[0].length,nextLine=(clean.slice(index).split('\n',1)[0]||'').trim();
        if(nextLine&&(looksLikeReferenceStart(nextLine)||lineBreak[0].length>1&&bibliographicCue(nextLine)))starts.add(index);
      }
      const positions=[...starts].sort((a,b)=>a-b),segmented=positions.map((start,index)=>normalizeReferenceChunk(clean.slice(start,positions[index+1]??clean.length))).filter(value=>value&&!/^\s*(?:\[\s*\d+\s*\]|[（(]\d+[）)]|[①②③④⑤⑥⑦⑧⑨⑩]|\d+[.、)])\s*$/.test(value));
      if(segmented.length>1)return segmented;
      const paragraphs=clean.split(/\n\s*\n+/).map(normalizeReferenceChunk).filter(value=>value&&!/^\s*(?:\[\s*\d+\s*\]|[（(]\d+[）)]|[①②③④⑤⑥⑦⑧⑨⑩]|\d+[.、)])\s*$/.test(value));if(paragraphs.length>1)return paragraphs;
      const lines=clean.split('\n').map(normalizeReferenceChunk).filter(value=>value&&!/^\s*(?:\[\s*\d+\s*\]|[（(]\d+[）)]|[①②③④⑤⑥⑦⑧⑨⑩]|\d+[.、)])\s*$/.test(value));if(lines.length>1&&lines.every(line=>looksLikeReferenceStart(line)||bibliographicCue(line)))return lines;
      return[normalizeReferenceChunk(clean)];
    }
    function extractReferences(text){
      const normalized=normalizeReferenceInput(text).replace(/\r\n?/g,'\n')
        .replace(/(^|\n)\s*(参考文献|主要参考文献|引用文献|references|bibliography|works cited)\s*[:：]?\s*(?=\n|$|\[\s*\d+\s*\])/gi,'$1$2\n')
        .replace(/\s+(?=\[\s*\d+\s*\]\s*)/g,'\n')
        .replace(/([。.;；])\s+(?=(?!(?:18|19|20)\d{2}\b)\d{1,3}\s+[A-Za-z\u00c0-\u024f\u3400-\u9fff])/g,'$1\n');
      const lines=normalized.replace(/\u00a0/g,' ').split('\n').map(x=>x.replace(/\s+/g,' ').trim());
      let heading=-1;lines.forEach((x,i)=>{/^(?:参考文献|主要参考文献|引用文献|references|bibliography|works cited)\s*[:：]?$/i.test(x)&&(heading=i)});
      const tail=heading>=0?lines.slice(heading+1):lines;
      const end=tail.findIndex(x=>/^(?:致谢|附录(?:\s*[A-Z0-9一二三四五六七八九十])?|acknowledg(?:e)?ments|appendi(?:x(?:\s+[A-Z0-9])?|ces))\s*[:：]?$/i.test(x));
      const source=(end>=0?tail.slice(0,end):tail).filter(Boolean).flatMap(line=>refs(line)),out=[];let current='';
      if(source.some(x=>numberedReferenceStart.test(x))){
        source.forEach(x=>{if(numberedReferenceStart.test(x)||looksLikeReferenceStart(x)){if(current)out.push(current.trim());current=x}else if(current)current+=' '+x});
        if(current)out.push(current.trim());
      }else{
        source.forEach(x=>{if(looksLikeReferenceStart(x)){if(current)out.push(current.trim());current=x}else if(current)current+=' '+x});
        if(current)out.push(current.trim());
        if(!out.length)out.push(...source.filter(x=>bibliographicCue(x)&&(/[.。]/.test(x)||/10\.\d{4,9}\//i.test(x))));
      }
      if(!out.length)throw Error('未识别出参考文献。请确认文档含“参考文献”标题及完整条目，扫描版 PDF 请先做文字识别。');
      return out;
    }

module.exports = { splitReferences: refs, extractReferencesFromDocument: extractReferences, extractReferences };
