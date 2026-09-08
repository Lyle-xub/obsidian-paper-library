# Paper Library Web Importer 2.1.0

从论文详情页、出版社全文页或浏览器内置 PDF 阅读器，一键将论文 PDF 导入 Obsidian Paper Library。

## 功能

- 识别 Highwire `citation_*`、Dublin Core、PRISM、Open Graph 和 JSON-LD `ScholarlyArticle` 元数据；
- 自动定位 arXiv、ACM、IEEE、Springer、Nature、ScienceDirect、Wiley、Taylor & Francis、Optica 等页面公开的 PDF 链接；
- 页面没有 PDF 链接时，使用 DOI、arXiv ID 或标题查询 Semantic Scholar 的 Open Access PDF；
- 订阅网站使用当前浏览器的 Cookie 和登录会话下载，不读取或上传账号密码；
- 出版商拒绝 `fetch` 时，自动回退到浏览器原生下载通道；
- IEEE Xplore 会将 `stamp.jsp` 查看器自动转换为 `stampPDF/getPDF.jsp` 二进制端点；遇到 AWS WAF 时先执行一次隐藏的正常浏览器导航，再重试下载；
- Semantic Scholar 没有返回公开 PDF 或遇到限流时，会以严格题名匹配查询 arXiv 官方接口；
- 当前论文已经导入时，弹窗会隐藏导入按钮并直接展示本地分区、影响因子、引用、参考文献和分类数据；
- 直接打开在线 PDF 时，无需返回详情页即可导入；
- PDF 使用二进制流传给本机 Obsidian，不使用 Base64 JSON；
- 支持仅导入文献信息，后续可在 Paper Library 中补充全文。

## 安装扩展

1. 打开 `chrome://extensions`；Edge 使用 `edge://extensions`。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择当前 `browser-extension` 文件夹。

修改扩展代码后，在扩展管理页面点击一次「重新加载」。

## 连接 Obsidian

1. 打开 Obsidian → 设置 → Paper Library → 浏览器扩展。
2. 开启「启用浏览器扩展服务」。服务只监听 `127.0.0.1`，默认端口为 `23987`。
3. 点击「复制」获取访问令牌。
4. 点击浏览器工具栏中的扩展图标，展开「连接设置」，粘贴 Token 并保存。
5. 点击「测试连接」，确认弹窗底部显示「已连接」。

## 使用方式

### Open Access 论文

打开论文页面并点击扩展图标，再选择「下载 PDF 并导入」。扩展会优先使用页面给出的 PDF，必要时自动查找 Open Access 全文。

### 订阅论文

先在出版社或学校机构登录页面使用自己的账号完成登录，然后进入论文详情页或 PDF 全文页，再点击导入。扩展仅复用浏览器已有登录会话。

如果页面仍提示需要登录：

1. 手动点击网站的「PDF」「Full text」或「Download PDF」；
2. 确认 PDF 能在当前标签页中正常打开；
3. 在该 PDF 标签页再次点击扩展导入。

### 浏览器 PDF 页面

当地址栏显示在线 PDF 地址时，直接点击扩展图标即可。Chrome 内置 PDF 阅读器不允许内容脚本注入，因此扩展会使用标签页原始 URL 下载并交给 Obsidian 识别。

## 数据与安全

- PDF 和论文信息只发送到 `127.0.0.1` 上的 Obsidian 插件服务；
- 本地接口使用随机 Bearer Token 鉴权；
- 扩展不收集账号、密码和浏览历史；
- `downloads` 权限仅用于少数拒绝脚本下载的出版社，成功导入后临时下载文件会被清理；
- `<all_urls>` 权限用于识别当前论文页面和下载不同出版社域名上的 PDF。

## 文件结构

```text
browser-extension/
├── manifest.json       # Manifest V3 配置
├── detector.js         # 页面元数据与 PDF 链接识别
├── service-worker.js   # 下载策略与 Obsidian 通信
├── popup.html          # 导入确认界面
├── popup.js
├── popup.css
└── icons/
```

扩展仅支持桌面版 Obsidian，因为本地接收服务依赖桌面端 Node.js 环境。手机和平板可以查看已经同步的论文，但不能接收桌面浏览器扩展发送的 PDF。
