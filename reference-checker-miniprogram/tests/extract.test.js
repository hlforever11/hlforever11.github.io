const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const https = require("node:https");
const { Readable } = require("node:stream");
const { main, _test } = require("../cloudfunctions/extractDocument");

const originalFetch = global.fetch;
const originalHttpsGet = https.get;

test.afterEach(() => {
  global.fetch = originalFetch;
  https.get = originalHttpsGet;
});

function createMockTransport(body) {
  return {
    get(url, options, callback) {
      const request = new EventEmitter();
      request.setTimeout = () => {};
      request.destroy = (error) => {
        if (error) queueMicrotask(() => request.emit("error", error));
      };
      const response = Readable.from([body]);
      response.statusCode = 200;
      response.headers = {
        "content-length": String(body.length)
      };
      queueMicrotask(() => callback(response));
      return request;
    }
  };
}

test("临时 TXT 文档可提取参考文献且最多返回二十条", async () => {
  const text = `参考文献
[1] 李书宁,刘一鸣.ChatGPT类智能对话工具兴起对图书馆行业的机遇与挑战[J].图书馆论坛,2023,43(05):104-110.
[2] RADFORD A, WU J, CHILD R, et al. Language models are unsupervised multitask learners[J]. OpenAI Blog, 2019, 1(8):9.`;
  https.get = createMockTransport(Buffer.from(text)).get;

  const result = await main({
    tempUrl: "https://reference-checker.tcb.qcloud.la/temporary/test.txt",
    fileName: "test.txt"
  });
  assert.equal(result.ok, true);
  assert.equal(result.build, "2026.07.25-4");
  assert.equal(result.total, 2);
  assert.match(result.references[1], /RADFORD/);
});

test("超过二十条时返回总数但只载入前二十条", async () => {
  const text = `参考文献\n${Array.from(
    { length: 22 },
    (_, index) => `${index + 1} 作者${index + 1}. 测试题名${index + 1}. 测试期刊, 2024, 1(1): 1-2.`
  ).join("\n")}`;
  https.get = createMockTransport(Buffer.from(text)).get;

  const result = await main({
    tempUrl: "https://reference-checker.tcb.qcloud.la/temporary/long.txt",
    fileName: "long.txt"
  });
  assert.equal(result.ok, true);
  assert.equal(result.total, 22);
  assert.equal(result.references.length, 20);
  assert.match(result.references[0], /^1 作者1/);
  assert.match(result.references[19], /^20 作者20/);
});

test("没有序号且自动换行的英文文献可完整提取", async () => {
  const text = `参考文献
Nieuwenhuysen P. International cooperation towards the development
of technology in university libraries. Proceedings of the IATUL
Conferences, 2012.
Scherlen A, Shao X. Bridges to China: Developing partnerships
between serials librarians in the United States and China.
Serials Review, 2009, 35(2): 75-79.`;
  https.get = createMockTransport(Buffer.from(text)).get;

  const result = await main({
    tempUrl: "https://reference-checker.tcb.qcloud.la/temporary/unnumbered.txt",
    fileName: "unnumbered.txt"
  });
  assert.equal(result.ok, true);
  assert.equal(result.total, 2);
  assert.equal(result.references.length, 2);
  assert.match(result.references[0], /Conferences, 2012/);
  assert.match(result.references[1], /Serials Review, 2009/);
});

test("文档函数拒绝读取非腾讯云临时地址", async () => {
  global.fetch = async () => {
    throw new Error("不应发起网络请求");
  };
  const result = await main({
    tempUrl: "https://example.com/private.docx",
    fileName: "private.docx"
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /临时文件地址无效/);
});

test("云函数运行环境没有原生 fetch 时仍可下载临时文件", async () => {
  global.fetch = undefined;
  const text = "[1] 测试作者. 测试文献[J]. 测试期刊, 2026(1):1-2.";
  const body = Buffer.from(text);
  const transport = createMockTransport(body);

  const downloaded = await _test.downloadTemporaryFile(
    "https://reference-checker.tcb.qcloud.la/temporary/test.txt",
    transport
  );
  assert.equal(downloaded.toString("utf8"), text);
});
