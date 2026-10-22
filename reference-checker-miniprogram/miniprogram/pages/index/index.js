const app = getApp();
const {
  splitReferences,
  extractReferencesFromDocument
} = require("../../utils/references");

const { withTimeout } = require("../../utils/cloud");
const MAX_REFERENCES = 20;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const VERIFICATION_CACHE_KEY = "wenzheng-success-cache-v8";
const VERIFICATION_CACHE_TTL = 180 * 24 * 60 * 60 * 1000;
const VERIFICATION_CACHE_LIMIT = 120;
const VISIT_BASE = 1000;
const VISIT_CACHE_KEY = 'wenzheng-mini-pv-base1000-20261008';
const SAMPLE = [
  "[1] 李书宁,刘一鸣.ChatGPT类智能对话工具兴起对图书馆行业的机遇与挑战[J].图书馆论坛,2023,43(05):104-110.",
  "[2] FLORIDI L. The Ethics of Information[M]. Oxford: Oxford University Press, 2014. ISBN 9780199641321.",
  "[3] Guidance for generative AI in education and research[R/OL]. 2023.",
  "[4] 王晨曦.生成式人工智能环境下大学生学术信息核验行为研究[D].武汉:武汉大学,2024."
].join("\n");

const STATUS_META = {
  verified: { label: "已确认真实", mark: "✓" },
  partial: { label: "已确认真实，信息待补", mark: "✓" },
  corrected: { label: "已确认真实，部分信息需核对", mark: "!" },
  review: { label: "需人工复核", mark: "?" },
  unverified: { label: "暂未证实", mark: "—" },
  error: { label: "服务暂不可用", mark: "—" }
};

function normalizedVerificationKey(reference) {
  // DOI and URL punctuation/case must not collapse into another document's key.
  return String(reference || "").replace(/\s+/g, " ").trim();
}

function verificationCache() {
  try {
    const value = wx.getStorageSync(VERIFICATION_CACHE_KEY);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch(error) { return {}; }
}

function cachedVerification(reference) {
  const key = normalizedVerificationKey(reference);
  const cache = verificationCache();
  const item = cache[key];
  if (!item) return null;
  if (!Number.isFinite(Number(item.storedAt)) || Number(item.storedAt) > Date.now() + 60000 || Date.now() - Number(item.storedAt || 0) > VERIFICATION_CACHE_TTL || !["verified", "partial", "corrected"].includes(item.result?.status)) {
    delete cache[key];
    try { wx.setStorageSync(VERIFICATION_CACHE_KEY, cache); } catch(error) {}
    return null;
  }
  return {
    ...item.result,
    submitted: reference,
    cacheHit: true,
    detailsNote: `已使用本机最近一次成功核验的公开书目证据。${item.result.detailsNote || item.result.note || ""}`
  };
}

function rememberVerification(reference, result) {
  const confidence = Number(
    result?.authenticityConfidence ?? result?.confidence ?? 0
  );
  if (
    !["verified", "partial", "corrected"].includes(result?.status) ||
    !Number.isFinite(confidence) || confidence < 0.8 || confidence > 1
  ) {
    return;
  }
  const cache = verificationCache();
  const key = normalizedVerificationKey(reference);
  cache[key] = {
    storedAt: Date.now(),
    result: { ...result, submitted: "" }
  };
  const entries = Object.entries(cache)
    .sort((a, b) => Number(b[1]?.storedAt || 0) - Number(a[1]?.storedAt || 0))
    .slice(0, VERIFICATION_CACHE_LIMIT);
  try { wx.setStorageSync(VERIFICATION_CACHE_KEY, Object.fromEntries(entries)); } catch(error) {}
}

function resultQuality(result) {
  const rank = {
    verified: 6,
    partial: 5,
    corrected: 5,
    review: 3,
    unverified: 2,
    error: 1
  }[result?.status] || 0;
  return rank * 10 + Number(
    result?.authenticityConfidence ?? result?.confidence ?? 0
  );
}

Page({
  data: {
    fileReading: false,
    inputValue: "",
    inputPlaceholder:
      "例如：\n[1] 作者. 篇名[J]. 刊名, 2024, 12(3):20-28.\n[2] Author. (2023). Title. Journal, 8(2), 10–19.",
    count: 0,
    maxReferences: MAX_REFERENCES,
    canVerify: false,
    loading: false,
    progressText: "",
    fileMessage: "",
    fileMessageType: "",
    results: [],
    summary: [],
    showResults: false,
    historyEnabled: false,
    accountLoading: false,
    visitTotal: VISIT_BASE,
    historyPending:false,
    visitNote: "",
    historyCount: 0
  },

  onLoad() {
    this.restoreHistoryState();
    this.refreshVisits();
  },

  async refreshVisits() {
    try {
      const cached=Number(wx.getStorageSync(VISIT_CACHE_KEY));
      if(Number.isSafeInteger(cached) && cached>=VISIT_BASE)this.setData({visitTotal:cached});
    }catch(error){}
    try {
      if(!app.globalData.visitId)app.globalData.visitId=Date.now().toString(36)+"_"+Math.random().toString(36).slice(2);
      const response=await this.callCloud("userHistory",{action:"visit",visitId:app.globalData.visitId});
      if(!response.ok)throw new Error(response.message || "访问统计暂不可用");
      const total=Number(response.total);
      if(response.platform!=='miniprogram' || response.legacyBase!==VISIT_BASE || !Number.isSafeInteger(total) || total<VISIT_BASE)throw new Error("请部署新版访问计数云函数");
      const latest=Math.max(Number(this.data.visitTotal)||VISIT_BASE,total);
      this.setData({visitTotal:latest,historyPending:false,visitNote:""});
      try{wx.setStorageSync(VISIT_CACHE_KEY,latest)}catch(error){}
    }catch(error){this.setData({visitNote:"统计暂不可用，显示起始基数或最近一次统计值"});}
  },

  onUnload() {
    this._documentVersion = (this._documentVersion || 0) + 1;
    this._activeBatch?.cancel();
    this._activeBatch = null;
  },

  cancelDocument() {
    this._documentVersion = (this._documentVersion || 0) + 1;
    this.setData({fileReading:false, canVerify:Boolean(this.data.count && !this.data.loading)});
  },

  onShow() {
    let replay;
    try { replay = wx.getStorageSync("historyReplay"); } catch(error) {}

    if (replay) {
      try { wx.removeStorageSync("historyReplay"); } catch(error) {}
      this.stopVerification();
      this.cancelDocument();
      this.resetResults();
      this.updateInput(replay);
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    }
    if (this.data.historyEnabled) this.refreshHistoryCount();
  },

  onShareAppMessage() {
    return {
      title: "文证：参考文献真实性与准确性核验",
      path: "/pages/index/index"
    };
  },

  onShareTimeline() {
    return {
      title: "文证：参考文献真实性与准确性核验"
    };
  },

  onInput(event) {
    if(this.data.loading)return;
    this.cancelDocument();
    this.resetResults();
    this.showFileMessage("", "");
    this.updateInput(event.detail.value);
  },

  updateInput(value) {
    const count = splitReferences(value).length;
    this.setData({
      inputValue: value,
      count,
      canVerify: Boolean(count && !this.data.loading && !this.data.fileReading)
    });
  },

  fillSample() {
    if(this.data.loading)return;
    this.cancelDocument();
    this.showFileMessage("", "");
    this.resetResults();
    this.updateInput(SAMPLE);
  },

  clearInput() {
    if(this.data.loading)return;
    this.cancelDocument();
    this.setData({
      inputValue: "",
      count: 0,
      canVerify: false,
      fileMessage: "",
      fileMessageType: ""
    });
    this.resetResults();
  },

  resetResults() {
    this.setData({
      results: [],
      summary: [],
      showResults: false,
      progressText: ""
    });
  },

  chooseDocument() {
    if (this.data.loading) return;
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["txt", "docx", "pdf"],
      success: ({ tempFiles }) => {
        const file = tempFiles?.[0];
        if (file) this.handleDocument(file);
      },
      fail: (error) => {
        if (!String(error?.errMsg || "").includes("cancel")) {
          this.showFileMessage("未能读取所选文件，请重试。", "error");
        }
      }
    });
  },

  async handleDocument(file) {
    if(this.data.loading)return;
    const version=(this._documentVersion || 0)+1;
    this._documentVersion=version;
    const current=()=>this._documentVersion===version && !this.data.loading;
    this.setData({fileReading:true,canVerify:false});
    try {
      const extension = String(file.name || "").split(".").pop().toLowerCase();
      if (!["txt", "docx", "pdf"].includes(extension)) {
        throw new Error("暂只支持 TXT、DOCX 和文字版 PDF。");
      }
      if (file.size > MAX_FILE_SIZE) {
        throw new Error("文件不能超过 10 MB。");
      }

      this.showFileMessage(`正在读取 ${file.name}…`, "working");
      let list;
      let detectedTotal = 0;
      if (extension === "txt") {
        const text = await withTimeout(()=>this.readTextFile(file.path),15000,"TXT 文件读取超时，请重试。");
        if(!current())return;
        list = extractReferencesFromDocument(text);
        detectedTotal = list.length;
      } else {
        this.ensureCloudAvailable();
        const cloudPath = `temporary/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
        let fileID = "";
        try {
          const upload = await withTimeout(()=>Promise.resolve(wx.cloud.uploadFile({cloudPath,filePath:file.path})).then(upload=>{
            if(!current()){
              if(upload.fileID)wx.cloud.deleteFile({fileList:[upload.fileID]}).catch(()=>{});
              throw new Error("文档读取已取消。");
            }
            return upload;
          }),30000,"文件上传超时，请重试。");
          fileID = upload.fileID;
          const temp = await withTimeout(()=>wx.cloud.getTempFileURL({fileList:[fileID]}),15000);
          if(!current())return;
          const tempUrl = temp.fileList?.[0]?.tempFileURL;
          if (!tempUrl) throw new Error("未能生成临时文件地址。");
          const response = await this.callCloud("extractDocument", {
            tempUrl,
            fileName: file.name
          });
          if (!response.ok) {
            const build = response.build ? `（文档服务 ${response.build}）` : "";
            throw new Error(`${response.message || "文档解析失败。"}${build}`);
          }
          list = response.references || [];
          detectedTotal = Number(response.total || list.length);
        } finally {
          if (fileID) {
            try {
              await withTimeout(()=>wx.cloud.deleteFile({fileList:[fileID]}),5000);
            } catch (cleanupError) {
              console.warn("temporary file cleanup failed", cleanupError);
            }
          }
        }
      }

      if(!current())return;
      list=Array.isArray(list)?list.filter(item=>typeof item==="string" && item.trim()):[];
      if (!list.length) throw new Error("文档中没有识别出参考文献。");
      const shown = list.slice(0, MAX_REFERENCES);
      this.resetResults();
      this.updateInput(shown.join("\n"));
      const suffix = detectedTotal > MAX_REFERENCES ? "，已载入前 20 条" : "";
      this.showFileMessage(`识别出 ${detectedTotal} 条参考文献${suffix}。`, "success");
    } catch (error) {
      if(current())this.showFileMessage(error?.message || "读取文档失败。", "error");
    } finally {
      if(this._documentVersion===version){
        this._documentVersion++;
        this.setData({fileReading:false,canVerify:Boolean(this.data.count && !this.data.loading)});
      }
    }
  },

  readTextFile(filePath) {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: "utf8",
        success: ({ data }) => resolve(data),
        fail: () => reject(new Error("TXT 文件读取失败，请确认文件编码为 UTF-8。"))
      });
    });
  },

  showFileMessage(message, type) {
    this.setData({
      fileMessage: message,
      fileMessageType: type
    });
  },

  ensureCloudAvailable() {
    if (!wx.cloud || !app.globalData.cloudAvailable) {
      throw new Error("核验服务尚未配置，请联系小程序管理员。");
    }
  },

  async callCloud(name, data) {
    this.ensureCloudAvailable();
    const response = await withTimeout(()=>wx.cloud.callFunction({ name, data }), name==="extractDocument"?30000:15000);
    return response.result || {};
  },

  async verifyReferenceStable(reference, batch) {
    const cached = cachedVerification(reference);
    if (cached) return cached;

    const first = await this.callCloud("verifyReference", { reference });
    if(batch?.cancelled)throw new Error("核验已停止。");
    let best = first;
    if (["review", "unverified", "error"].includes(first?.status)) {
      await new Promise((resolve) => setTimeout(resolve, 160));
      if(batch?.cancelled)throw new Error("核验已停止。");
      try {
        const second = await this.callCloud("verifyReference", { reference });
        best = resultQuality(second) > resultQuality(first) ? second : first;
        best = { ...best, attemptCount: 2 };
      } catch (error) {
        console.warn("verifyReference retry failed", error);
      }
    }
    if(batch?.cancelled)throw new Error("核验已停止。");
    rememberVerification(reference, best);
    return best;
  },

  restoreHistoryState() {
    let historyEnabled=false;
    try{historyEnabled=wx.getStorageSync("historyEnabled")===true}catch(error){}
    this.setData({ historyEnabled });
    if (historyEnabled) this.refreshHistoryCount();
  },

  async enableHistory() {
    if (this.data.accountLoading) return;
    try {
      this.ensureCloudAvailable();
      this.setData({ accountLoading: true });
      const result = await this.callCloud("userHistory", { action: "login" });
      if (!result.ok) throw new Error(result.message || "登录失败。");
      wx.setStorageSync("historyEnabled", true);
      this.setData({
        historyEnabled: true,
        historyCount: Number(result.historyCount || 0)
      });
      wx.showToast({ title: "历史记录已启用", icon: "success" });
    } catch (error) {
      wx.showModal({
        title: "暂时无法启用",
        content: error?.message || "请稍后重试。",
        showCancel: false
      });
    } finally {
      this.setData({ accountLoading: false });
    }
  },

  disableHistory() {
    wx.showModal({
      title: "停止保存历史记录？",
      content: "已有记录不会被删除，重新启用后仍可查看。",
      confirmText: "停止保存",
      success: ({ confirm }) => {
        if (!confirm) return;
        wx.removeStorageSync("historyEnabled");
        this.setData({ historyEnabled: false });
      }
    });
  },

  openHistory() {
    wx.navigateTo({ url: "/pages/history/history" });
  },

  async refreshHistoryCount() {
    try {
      const result = await this.callCloud("userHistory", { action: "list" });
      if (result.ok) this.setData({ historyCount: Number(result.total || 0) });
    } catch (error) {
      console.warn("history count refresh failed", error);
    }
  },

  async saveHistory(references, results) {
    if (!this.data.historyEnabled) return;
    try {
      const result = await this.callCloud("userHistory", {
        action: "save",
        input: references.join("\n"),
        results
      });
      if (result.ok) {
        this.setData({ historyCount: Number(result.total || this.data.historyCount + 1) });
      }
    } catch (error) {
      console.warn("history save failed", error);
      wx.showToast({ title: "本次记录未能保存", icon: "none" });
    }
  },

  stopVerification() {
    const batch=this._activeBatch;
    if(!batch)return;
    batch.cancel();
    this._activeBatch=null;
    this.setData({loading:false,canVerify:Boolean(this.data.count && !this.data.fileReading),progressText:`已停止，完成 ${batch.done} / ${batch.total} 条`});
  },

  async verifyAll() {
    if(this.data.loading){this.stopVerification();return}
    if(this.data.fileReading)return;
    const references=splitReferences(this.data.inputValue).slice(0,MAX_REFERENCES);
    if(!references.length)return;
    if(this.data.count>MAX_REFERENCES)wx.showToast({title:"本次核验前 20 条",icon:"none"});
    try{this.ensureCloudAvailable()}catch(error){
      wx.showModal({title:"核验服务不可用",content:error.message,showCancel:false});return;
    }
    let cancel;
    const stopped=new Promise(resolve=>{cancel=resolve});
    const batch={cancelled:false,done:0,total:references.length,cancel(){this.cancelled=true;cancel(null)}};
    this._activeBatch=batch;
    const current=()=>this._activeBatch===batch && !batch.cancelled;
    this.setData({loading:true,canVerify:false,showResults:true,results:[],summary:this.buildSummary([]),progressText:`0 / ${references.length}`});
    const output=[];
    try{
      for(let index=0;index<references.length && current();index++){
        let result;
        try{
          result=await Promise.race([this.verifyReferenceStable(references[index],batch),stopped]);
        }catch(error){
          result={status:"error",confidence:0,note:error?.message || "核验服务暂时无法连接，请稍后重试。",differences:[],evidenceLinks:[]};
        }
        if(!current())return;
        output.push(this.prepareResult(result || {},references[index],index));
        batch.done++;
        this.setData({results:output.slice(),summary:this.buildSummary(output),progressText:`${batch.done} / ${references.length}`});
      }
      if(!current())return;
      this._activeBatch=null;
      this.setData({loading:false,canVerify:Boolean(this.data.count),progressText:`已完成 ${references.length} 条`});
      // Copy the arrays: a subsequent batch must not mutate a pending save.
      await this.saveHistory(references.slice(),output.slice());
      if(!this.data.loading)wx.pageScrollTo({selector:"#results",duration:260});
    }finally{
      if(this._activeBatch===batch){
        this._activeBatch=null;
        this.setData({loading:false,canVerify:Boolean(this.data.count && !this.data.fileReading)});
      }
    }
  },

  prepareResult(result, submitted, index) {
    const status = STATUS_META[result.status] ? result.status : "error";
    const meta = STATUS_META[status];
    const links = [];
    if (result.sourceUrl) {
      links.push({
        label: `复制${result.source || "来源"}链接`,
        url: result.sourceUrl
      });
    }
    (Array.isArray(result.evidenceLinks) ? result.evidenceLinks : []).forEach((link) => {
      if (link?.url && !links.some((item) => item.url === link.url)) links.push(link);
    });

    return {
      ...result,
      canonical: result.canonical ? `[${String(submitted).match(/^\s*\[\s*(\d+)\s*\]/)?.[1] || index + 1}] ${String(result.canonical).replace(/^\[\s*\d+\s*\]\s*/, '')}` : '',
      submitted: result.submitted || submitted,
      status,
      statusLabel: meta.label,
      statusMark: meta.mark,
      displayIndex: index + 1,
      confidencePercent: Math.round(Number(
        result.authenticityConfidence ?? result.confidence ?? 0
      ) * 100),
      canonicalOpen: Boolean(result.canonicalOpen),
      showCanonical: result.showCanonical !== false,
      canonicalWarnings: result.canonicalWarnings || result.formatChecks || [],
      differences: result.differences || [],
      links
    };
  },

  buildSummary(results) {
    const counts = {
      confirmed: 0,
      corrected: 0,
      review: 0,
      unresolved: 0
    };
    results.forEach((result) => {
      if (result.status === "verified" || result.status === "partial") counts.confirmed += 1;
      else if (result.status === "corrected") counts.corrected += 1;
      else if (result.status === "review") counts.review += 1;
      else counts.unresolved += 1;
    });
    return [
      { label: "已确认真实", value: counts.confirmed },
      { label: "已确认，有字段差异", value: counts.corrected },
      { label: "需人工复核", value: counts.review },
      { label: "暂未证实/服务异常", value: counts.unresolved }
    ];
  },

  toggleCanonical(event) {
    const index=Number(event.currentTarget.dataset.index);
    this.setData({results:this.data.results.map((r,i)=>i===index?{...r,canonicalOpen:!r.canonicalOpen}:r)});
  },

  copyUrl(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: "链接已复制", icon: "success" })
    });
  },

  copyCitation(event) {
    const citation = event.currentTarget.dataset.citation;
    if (!citation) return;
    wx.setClipboardData({
      data: citation,
      success: () => wx.showToast({ title: "著录已复制", icon: "success" })
    });
  }
});
