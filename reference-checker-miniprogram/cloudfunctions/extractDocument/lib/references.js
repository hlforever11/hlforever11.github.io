const NUMBERED_START = /^(?:\[\s*\d{1,3}\s*\]|[（(]\s*\d{1,3}\s*[）)]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|\d{1,3}[.、)]|\d{1,3}\s+(?=[A-Za-z\u00c0-\u024f\u3400-\u9fff]))\s*/;

function bibliographicCue(value) {
  return /(?:18|19|20)\d{2}|\[[A-Z/]+\]|https?:\/\/|10\.\d{4,9}\//i.test(String(value || ""));
}

function looksLikeEnglishAuthorHead(value) {
  const head = String(value || "")
    .match(/^(.{2,140}?)[.。](?:\s|$)/)?.[1]
    ?.trim()
    .replace(/\bet\s+al\.?$/i, "")
    .trim();
  if (!head || /\d/.test(head)) return false;
  const parts = head
    .split(/\s*(?:,|;|&|\band\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return false;
  return parts.every((part) =>
    /^[A-Z][A-Za-z\u00c0-\u024f'’\-]+(?:\s+[A-Z]{1,5}){1,5}$/.test(part) ||
    /^(?:[A-Z]\s+){1,5}[A-Z]$/.test(part) ||
    (
      /^[A-Z][A-Za-z\u00c0-\u024f'’\-]+(?:\s+[A-Z][A-Za-z\u00c0-\u024f'’\-]+){1,8}$/.test(part) &&
      /\b(?:Association|Organization|Organisation|University|Institute|Council|Committee|Academy|Library|Libraries)\b/i.test(part)
    )
  );
}

function looksLikeReferenceStart(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (NUMBERED_START.test(text)) return true;
  if (looksLikeEnglishAuthorHead(text)) return true;
  const apa = text.match(/^(.{1,140}?)\(\s*((?:18|19|20)\d{2})[a-z]?\s*\)\s*[.。]/);
  if (apa && /^[A-Za-z\u00c0-\u024f]/.test(apa[1].trim())) return true;
  const chineseHead = text.match(/^(.{2,48}?)[.。]/)?.[1]?.trim();
  return Boolean(
    chineseHead &&
    /^[\u3400-\u9fff·]{2,}(?:\s*[,，、]\s*[\u3400-\u9fff·]{2,}){0,12}$/.test(chineseHead) &&
    bibliographicCue(text)
  );
}

function extractReferences(text) {
  const normalized = String(text || "")
    .replace(/\s*(参考文献|主要参考文献|引用文献|references|bibliography|works cited)\s*[:：]?\s*/gi, "\n$1\n")
    .replace(/\s+(?=(?:\[\s*\d{1,3}\s*\]|[（(]\s*\d{1,3}\s*[）)]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|\d{1,3}[.、)])\s*)/g, "\n")
    .replace(
      /([。.;；])\s+(?=(?!(?:18|19|20)\d{2}\b)\d{1,3}\s+[A-Za-z\u00c0-\u024f\u3400-\u9fff])/g,
      "$1\n"
    );
  const lines = normalized
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim());

  let heading = -1;
  lines.forEach((line, index) => {
    if (/^(?:参考文献|主要参考文献|引用文献|references|bibliography|works cited)\s*[:：]?$/i.test(line)) {
      heading = index;
    }
  });
  const source = (heading >= 0 ? lines.slice(heading + 1) : lines).filter(Boolean);
  const output = [];
  let current = "";

  if (source.some((line) => NUMBERED_START.test(line))) {
    source.forEach((line) => {
      if (NUMBERED_START.test(line) || looksLikeReferenceStart(line)) {
        if (current) output.push(current.trim());
        current = line;
      } else if (current) {
        current += ` ${line}`;
      }
    });
    if (current) output.push(current.trim());
  } else {
    source.forEach((line) => {
      if (looksLikeReferenceStart(line)) {
        if (current) output.push(current.trim());
        current = line;
      } else if (current) {
        current += ` ${line}`;
      }
    });
    if (current) output.push(current.trim());
    if (!output.length) {
      output.push(...source.filter(
        (line) => bibliographicCue(line) && (/[.。]/.test(line) || /10\.\d{4,9}\//i.test(line))
      ));
    }
  }

  if (!output.length) {
    throw new Error("未识别出参考文献。请确认文档含“参考文献”标题和完整条目。");
  }
  return output;
}

module.exports = {
  extractReferences
};
