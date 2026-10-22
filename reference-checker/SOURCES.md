# 核验来源与接入范围（2026-10-22）

本轮未接入大模型、付费数据库或需要购买的新服务。下列是实际调用范围，不等同于收录了这些数据库的全部文献。

| 来源 | 自动调用范围 | 本轮变化 |
| --- | --- | --- |
| Crossref | DOI、题名、作者、刊名的公开注册元数据 | 中文期刊无DOI时也查询；修正中文姓名顺序、转义题名和出版年份合并 |
| DataCite | 公开DOI注册元数据；DOI及题名查询 | 新增，补充报告、学位论文、数据集等；无DOI的未知类型也检索 |
| Europe PMC | DOI、PMID、完整题名查询公开题录 | 新增；保留其底层PubMed等来源标识，不当作相互独立的多份证据 |
| PubMed | PMID题录；医学主题的题录匹配接口 | 扩展无PMID匹配；按官方返回的对象型UID解析；串行限速 |
| OpenAlex、Semantic Scholar | 题名、DOI、作者、来源等开放元数据 | 保留；与Crossref等可能重叠，不能把多库命中次数当作独立真实性概率 |
| Open Library、Google Books | 图书题名、作者及ISBN查询 | 补充Google Books的ISBN路由；作品级目录不能替代具体版次证据 |
| arXiv | 已提供的arXiv标识符 | 保留；不声称完整全文检索 |
| UNESCO、机构和期刊原始网页/PDF | 支持的公开目录、结构化网页和可读取PDF | 保留；连接成功不等于题名身份相符 |
| DOI citation服务 | DOI返回的格式化题录 | 保留；修复英文作者列表拆分，并合并结构化来源提供的可接受出版年份 |
| 已核对原始证据索引 | 53条记录、52个不同题名 | 回归辅助；本轮外部评测全部排除，不当作数据库规模 |

万方、PubScholar和搜索引擎复核入口供用户打开继续核对；云端也会尝试公开搜索摘要。它们不代表已接入订阅全文库。没有新增中国知网、万方订阅库或WorldCat付费接口。

中文仍按现行GB/T 7714—2025生成参考著录。英文保留原有写法；只识别可辨认的格式体系，不声称仅凭题录就能判断APA版年。判断文献存在、核对事实字段、给出格式提示分别处理。

## 接口依据

- DataCite公开API：https://support.datacite.org/docs/api-get-lists
- Europe PMC API：https://europepmc.org/developers
- PubMed Citation Matcher API及限流：https://pubmed.ncbi.nlm.nih.gov/help/#citation-matcher-api
- Crossref REST API：https://www.crossref.org/documentation/retrieve-metadata/rest-api/
- Open Library Search API：https://openlibrary.org/dev/docs/api/search

接口的可用性、免费额度、限流和服务条款由提供方决定。本轮没有承诺无限量或永久免费的商业托管能力。
