const test = require("node:test");
const assert = require("node:assert/strict");
const {
  splitReferences,
  extractReferencesFromDocument
} = require("../miniprogram/utils/references");

test("连续粘贴的中英文混合内容可识别为六条参考文献", () => {
  const value = `[1] 李书宁,刘一鸣.ChatGPT类智能对话工具兴起对图书馆行业的机遇与挑战[J].图书馆论坛,2023,43(05):104-110. [2] 曹树金,曹茹烨.从ChatGPT看生成式AI对情报学研究与实践的影响[J].现代情报,2023,43(04):3-10. [3] 陈金榜.朱民博士畅谈ChatGPT与人工智能未来[EB/OL].(2023-03-13)[2023-04-18]. https://www.shanghaitech.edu.cn/2023/0313/c1001a1075770/page.htm.
Sinkinson, C. (2019). Reflective practice for librarians and teachers. In S. Hines & M. Wakimoto (Eds.), Instructional technologies in libraries: Practice, implementation, and management (pp. 14–28). ALA Editions.
UNESCO. (2021). Recommendation on the ethics of artificial intelligence. United Nations Educational, Scientific and Cultural Organization. https://unesdoc.unesco.org/ark:/48223/pf0000381137
Veletsianos, G., & Houlden, S. (2020). An analysis of flexible learning and flexibility over the last 40 years of Distance Education. Distance Education, 41(4), 471–487. https://doi.org/10.1080/01587919.2020.1821966`;

  const references = splitReferences(value);
  assert.equal(references.length, 6);
  assert.match(references[0], /李书宁/);
  assert.match(references[5], /Veletsianos/);
});

test("文档参考文献标题后的多行条目可正确合并", () => {
  const value = `正文内容

参考文献
[1] 李书宁,刘一鸣.ChatGPT类智能对话工具兴起
对图书馆行业的机遇与挑战[J].图书馆论坛,2023,43(05):104-110.
[2] 陈金榜.朱民博士畅谈ChatGPT与人工智能未来[EB/OL].
(2023-03-13)[2023-04-18]. https://www.shanghaitech.edu.cn/example`;
  const references = extractReferencesFromDocument(value);
  assert.equal(references.length, 2);
  assert.match(references[0], /机遇与挑战/);
  assert.match(references[1], /shanghaitech/);
});

test("无括号的纯数字序号可拆分中文和英文参考文献", () => {
  const value = `7 张红扬. 大学图书馆国际交流与合作的新趋势. 大学图书馆学报, 2002, 20(02): 58-60.
8 聂建霞. 图书馆国际合作与学术交流策略初探. 农业图书情报学刊, 2008, 20(06): 9-11.
21 Nieuwenhuysen P. International cooperation towards the development of technology in university libraries. Proceedings of the IATUL Conferences, 2012.
22 Scherlen A, Shao X. Bridges to China: Developing partnerships between serials librarians in the United States and China. Serials Review, 2009, 35(2): 75-79.
23 Lor PJ. Critical reflections on international librarianship. Mousaion, 2008, 25(1): 1-15.
24 Chao S J. Library cooperation on overseas Chinese studies: from resource sharing to the development of library collections. Collection Building, 2001, 20(3): 123-130.
25 L S T, G V L. Models, methods, concepts & applications of the analytic hierarchy process. New York: Springer Science & Business Media, 2012. 3-5.`;
  const references = splitReferences(value);
  assert.equal(references.length, 7);
  assert.match(references[0], /^7 张红扬/);
  assert.match(references[6], /^25 L S T/);
});

test("同一行连续出现纯数字序号时仍能准确拆分", () => {
  const value = "7 张红扬. 大学图书馆国际交流与合作的新趋势. 大学图书馆学报, 2002, 20(02): 58-60. 8 聂建霞. 图书馆国际合作与学术交流策略初探. 农业图书情报学刊, 2008, 20(06): 9-11.";
  const references = splitReferences(value);
  assert.equal(references.length, 2);
});

test("文档可统计超过二十条纯数字序号参考文献", () => {
  const value = `参考文献\n${Array.from(
    { length: 22 },
    (_, index) => `${index + 1} 作者${index + 1}. 测试题名${index + 1}. 测试期刊, 2024, 1(1): 1-2.`
  ).join("\n")}`;
  const references = extractReferencesFromDocument(value);
  assert.equal(references.length, 22);
});

test("没有序号的一行一条中英文参考文献可准确计数", () => {
  const value = `张红扬. 大学图书馆国际交流与合作的新趋势. 大学图书馆学报, 2002, 20(02): 58-60.
聂建霞. 图书馆国际合作与学术交流策略初探. 农业图书情报学刊, 2008, 20(06): 9-11.
Nieuwenhuysen P. International cooperation towards the development of technology in university libraries. Proceedings of the IATUL Conferences, 2012.
Scherlen A, Shao X. Bridges to China: Developing partnerships between serials librarians in the United States and China. Serials Review, 2009, 35(2): 75-79.
Lor PJ. Critical reflections on international librarianship. Mousaion, 2008, 26(1): 1-15.
American Library Association. Presidential Committee on Information Literacy: Final Report[R]. Chicago: American Library Association, 1989.
UNESCO. (2021). Recommendation on the ethics of artificial intelligence. United Nations Educational, Scientific and Cultural Organization. https://unesdoc.unesco.org/ark:/48223/pf0000381137`;
  const references = splitReferences(value);
  assert.equal(references.length, 7);
  assert.match(references[0], /^张红扬/);
  assert.match(references[6], /^UNESCO/);
});

test("没有序号且英文条目在文档中自动换行时仍能合并并计数", () => {
  const value = `参考文献
Nieuwenhuysen P. International cooperation towards the development
of technology in university libraries. Proceedings of the IATUL
Conferences, 2012.
Scherlen A, Shao X. Bridges to China: Developing partnerships
between serials librarians in the United States and China.
Serials Review, 2009, 35(2): 75-79.`;
  const pasted = splitReferences(value);
  const imported = extractReferencesFromDocument(value);
  assert.equal(pasted.length, 2);
  assert.equal(imported.length, 2);
  assert.match(imported[0], /Conferences, 2012/);
  assert.match(imported[1], /Serials Review, 2009/);
});

test("没有序号的二十二条参考文献可统计完整总数", () => {
  const value = `参考文献\n${Array.from(
    { length: 22 },
    (_, index) => `作者${index + 1}. 无序号测试题名${index + 1}. 测试期刊, 2024, 1(1): 1-2.`
  ).join("\n")}`;
  assert.equal(extractReferencesFromDocument(value).length, 22);
});
