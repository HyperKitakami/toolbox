# 工具箱 Toolbox

> 一个纯静态、零依赖的个人在线工具箱。除「AI 辅助」一组要调用外部模型外，所有工具都在浏览器本地运行，输入不会离开本机。

## 站点定位

- **默认 100% 客户端**：没有后端、没有本站接口。除「AI 辅助」那一组外，断网也可用。
- **可审计**：全部是未压缩的静态文件，右键查看源码看到的就是实际运行的代码。
- **零构建、零依赖**：原生 HTML / CSS / JavaScript，没有框架，没有打包步骤。
- **无追踪**：不加载分析脚本、CDN、第三方字体或图标。

## 本地预览

任选一种静态服务器（不要直接双击打开 HTML，分类页依赖目录索引）：

```bash
# Python
python -m http.server 8080

# Node
npx serve -l 8080
```

然后访问 http://localhost:8080/ 。

## 目录结构

```
tools-box/
├── index.html                 首页：Hero + 分类 + 全部工具
├── 404.html                   注意：用根绝对路径，不参与页头页脚同步
├── favicon.svg
├── LICENSE                    MIT 许可与版权声明
├── THIRD-PARTY.md             ★ 第三方代码的来源、版本、许可与改动清单
├── css/
│   ├── base.css               设计令牌、重置、排版、通用组件（改配色只改这里）
│   ├── site.css               页头 / 页脚 / 首页 / 分类页 / 搜索面板
│   └── tool.css               工具页骨架 + 各工具共用组件（代码视图、差异视图…）
├── js/
│   ├── theme-init.js          必须在 <head> 同步加载，避免深色模式闪白
│   ├── registry.js            ★ 唯一数据源：分类 + 工具清单
│   ├── site.js                主题、导航、卡片渲染、搜索、公共工具方法
│   ├── color-utils.js         颜色换算、对比度与混合模式（颜色类工具共用）
│   ├── random-utils.js        随机取样与字符集（生成器类工具共用）
│   ├── password-utils.js      爆破时间、强度分档与强度估算（两个密码工具共用）
│   ├── hash-utils.js          MD5/SHA-1/256/384/512、HMAC、Base32（安全类共用）
│   ├── qr-utils.js            二维码的模块矩阵 → SVG / canvas 几何（两个工具共用）
│   ├── lorem-corpus.js        占位文本语料（拉丁 + 中文）
│   ├── mock-data-corpus.js    测试数据语料（姓氏、地名、公司词…）
│   ├── vendor/                自托管的第三方资源（见 THIRD-PARTY.md）
│   │   ├── marked.umd.js      Markdown 解析
│   │   ├── purify.min.js      HTML 净化
│   │   ├── eff-large-wordlist.js  EFF 长词表（口令短语用，7776 词）
│   │   ├── pinyin-common.js   Unihan 拼音表（中文转拼音用，6763 个常用汉字）
│   │   └── vendor.json        版本、来源与 sha256 记录
│   └── tools/
│       ├── _template.js       工具逻辑模板
│       ├── word-counter.js    自研
│       ├── diff-checker.js    自研
│       ├── random-string.js   自研
│       ├── mock-data.js       自研
│       ├── unit-converter.js  自研
│       ├── timestamp-converter.js 移植
│       ├── number-formatter.js 自研
│       ├── base-converter.js  自研
│       ├── whitespace-cleaner.js 自研
│       ├── text-case.js       移植
│       ├── slug-generator.js  自研
│       ├── password-generator.js 移植
│       ├── lorem-ipsum.js     移植
│       ├── uuid-generator.js  移植
│       ├── regex-tester.js    移植
│       ├── json-formatter.js  移植
│       ├── markdown-to-html.js 移植
│       ├── csv-viewer.js     移植
│       ├── markdown-preview.js 移植
│       ├── jwt-decoder.js     JWT 解码（自研）
│       ├── base64.js          Base64 编解码（移植）
│       ├── password-strength.js 密码强度检测（自研）
│       ├── totp-generator.js  TOTP 动态口令（移植）
│       ├── hash-generator.js  哈希摘要生成（移植）
│       ├── url-encoder.js     URL 编解码（移植）
│       ├── line-number.js     批量加行号（自研）
│       ├── kcwiki-voiceline.js KCWiki 语音台词（自研）
│       └── whisper-verifier.js 日语语音校对（自研）
├── hubs/<id>/index.html       七个分类页（由脚本生成，不要手改）
├── tools/
│   ├── _template/index.html   工具页模板：复制这个目录开新工具
│   └── <slug>/index.html      每个工具一个目录
├── about/  privacy/
└── scripts/
    ├── chrome.mjs             页头页脚的唯一来源
    ├── build-pages.mjs        生成分类页 + 同步页头页脚 + 给资源加版本号
    ├── test.mjs               测试运行器
    └── tests/                 测试套件：site.mjs 管全站，每个工具一个文件
```

## 工具状态

| 分类 | 已上线 | 规划中 | 已挂起 |
|---|---|---|---|
| 开发者 | JSON 格式化、CSV 查看器、Markdown 预览、Markdown 转 HTML、文本差异对比、正则表达式测试 | 0 | 5 |
| 安全 | Base64 编解码、JWT 解码、密码强度检测、TOTP 动态口令、哈希摘要生成、URL 编解码 | 0 | 2 |
| 颜色 | 颜色格式转换、取色器、颜色混合、对比度检查、调色板生成、渐变生成器 | 0 | 0 |
| 转换 | 时间戳转换、单位换算、数字格式化、进制转换 | 0 | 2 |
| 生成器 | 二维码生成、随机字符串、密码生成器、占位文本生成、UUID 生成器、测试数据生成 | 0 | 0 |
| 文本 | 字数统计、空白清理、文本大小写转换、Slug 生成、KCWiki 语音台词、批量加行号 | 2 | 0 |
| AI 辅助 | 日语语音校对 | 0 | 0 |

> 「AI 辅助」是站内**唯一会联网**的分类：那一组工具要用你自己的 API Key 调外部大模型，
> 输入（含音频）会发往第三方接口。其余分类的工具全部在浏览器本地运行。
> 接入新工具时请守住这条边界 —— 需要联网的一律进 `ai`，不要混进其他分类。

完整清单见 `js/registry.js`。三种状态在站点上的表现：

| 状态 | 含义 | 卡片样式 |
|---|---|---|
| `ready` | 已上线，可点击 | 实线边框，正常配色 |
| `planned` | 规划中，后续会做 | 虚线边框，灰底 |
| `suspended` | 已挂起，暂时不做 | 虚线边框，灰底 + 琥珀色徽章 |

首页与分类页的筛选胶囊支持按这三种状态过滤。

## 工具来源

自研工具与移植工具混用。移植类工具在上线时会做三件事：**中文化**、**改用本项目的
设计系统与组件类名**、**修复上游缺陷**，并在页面底部与 `THIRD-PARTY.md` 里注明来源。

| 工具 | 来源 | 许可 |
|---|---|---|
| JSON 格式化 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `json-formatter` | MIT |
| 正则表达式测试 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `regex-tester` | MIT |
| Markdown 转 HTML | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `markdown-to-html` | MIT |
| CSV 查看器 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `csv-viewer` | MIT |
| Markdown 预览 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `markdown-preview` | MIT |
| 取色器 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `color-picker` + `color-utils` | MIT |
| 颜色格式转换 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `color-converter` | MIT |
| 颜色混合 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `color-blender` | MIT |
| 对比度检查 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `contrast-checker` | MIT |
| 调色板生成 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `palette-generator` | MIT |
| 渐变生成器 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `gradient-generator` | MIT |
| 二维码生成 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `qr-generator` + `qrcode-generator` | MIT |
| 密码生成器 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `password-generator` + [EFF 长词表](https://www.eff.org/dice) | MIT / CC BY 3.0 US |
| 占位文本生成 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `lorem-ipsum` + Cicero 原文 | MIT / 公有领域 |
| UUID 生成器 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `uuid-generator` | MIT |
| 时间戳转换 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `timestamp-converter` | MIT |
| 文本大小写转换 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `text-case` | MIT |
| Base64 编解码 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `base64` | MIT |
| TOTP 动态口令 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `totp-generator` | MIT |
| 哈希摘要生成 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `hash-generator` | MIT |
| URL 编解码 | [jamalofski/praticulus](https://github.com/jamalofski/praticulus) `url-encoder` | MIT |
| 文本差异对比 | 自研 | — |
| 字数统计 | 自研 | — |
| 随机字符串 | 自研 | — |
| 测试数据生成 | 自研 | — |
| 单位换算 | 自研 | — |
| 数字格式化 | 自研 | — |
| 进制转换 | 自研 | — |
| JWT 解码 | 自研 | — |
| 密码强度检测 | 自研 | — |
| 空白清理 | 自研 | — |
| 批量加行号 | 自研 | — |
| Slug 生成 | 自研 + [Unihan 拼音数据](https://www.unicode.org/reports/tr38/) | — / Unicode License v3.0 |
| KCWiki 语音台词 | 自研（由本机旧版个人工具整理迁移） | — |
| 日语语音校对 | 自研（由本机旧版个人工具整理迁移） | — |

## 内置的第三方资源

自托管在 `js/vendor/`，不通过 CDN 加载。版本与校验和记录在 `js/vendor/vendor.json`。

| 资源 | 版本 | 用途 | 许可 |
|---|---|---|---|
| [marked](https://github.com/markedjs/marked) | 18.0.13 | Markdown 解析 | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.15 | HTML 净化 | Apache-2.0 OR MPL-2.0 |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 2.0.4 | 二维码编码 | MIT |
| [EFF 长词表](https://www.eff.org/dice) | 2016-07-18 | 口令短语的单词来源（7776 词） | CC BY 3.0 US |
| [Unihan 拼音数据](https://www.unicode.org/reports/tr38/) | Unicode 18.0.0 | 中文转拼音（GB2312 范围内 6763 个汉字） | Unicode License v3.0 |

> 注意 DOMPurify **不是 MIT**，EFF 词表要求**署名**，Unihan 拼音数据要求
> **保留版权声明**（© Unicode, Inc.）。再分发本项目时需同时遵守这三者的许可条款。

完整的来源、改动清单与校验方法见 **[THIRD-PARTY.md](THIRD-PARTY.md)**。

## 加一个新工具（三步）

1. **建页面**：复制 `tools/_template/` 为 `tools/<slug>/`，改掉 `<title>`、
   `description`、`data-tool`、`data-hub`、面包屑、`<h1>` 与描述文字。
2. **写逻辑**：复制 `js/tools/_template.js` 为 `js/tools/<slug>.js`，写自己的逻辑，
   然后在页面底部按顺序引入它（`registry.js` → `site.js` → 你的脚本）。
3. **注册**：打开 `js/registry.js`，在 `TOOLS` 数组里把对应那一行的状态
   从 `'planned'` 改成 `'ready'`。首页、分类页、搜索会自动收录。
4. **重建**：跑一次 `node scripts/build-pages.mjs`，把新页面的资源引用补上版本号
   （忘了跑的话 `node scripts/test.mjs` 会红）。

`slug` 必须与目录名一致，用短横线小写英文。

## 维护脚本

改了页头或页脚（`scripts/chrome.mjs`）、**或者改了任何 CSS / JS 文件**之后跑一次：

```bash
node scripts/build-pages.mjs
```

它会：

1. 依据 `js/registry.js` 重新生成 `hubs/<id>/index.html`；
2. 把页头页脚同步进所有 HTML 的 `<!-- chrome:header:start -->` 标记区间；
3. 给所有 CSS / JS 引用补上内容版本号（`?v=<sha256 前 8 位>`）。

第 3 步是防缓存用的。浏览器缓存按 URL 走，文件改了但 URL 不变时，
用户可能拿到「新 HTML + 旧 JS」的组合，页面会**静默出错** ——
曾经因为给 `site.js` 加了 `T.util.readInt`，两个生成器工具的结果区直接变成空白，
控制台只有一行 `TypeError`，光看页面完全看不出问题在哪。
版本号取文件内容哈希，所以只有文件真的变了 URL 才变。

`node scripts/test.mjs` 会校验版本号与文件内容是否对得上，
**改了资源却忘了重跑 `build-pages.mjs` 会直接红**。

## 测试

用 jsdom 在 Node 里真实执行页面脚本，覆盖 registry 一致性、首页/分类页渲染、
搜索、每个工具页的行为与边界。**jsdom 只有测试需要，站点本身依然零依赖。**

```bash
npm i -D jsdom          # 首次
node scripts/test.mjs   # 跑全部
node scripts/test.mjs diff   # 只跑文件名含 diff 的套件
```

新增工具的测试：在 `scripts/tests/` 下加一个 `<slug>.mjs`，默认导出一个 async 函数，
运行器会自动发现。公共设施（`ok` / `fail` / `loadPage` / `count` / `sleep`）在
`scripts/tests/_harness.mjs`。

套件抛出异常会被记为一条失败，并让退出码变成 1 —— 可以直接用退出码判断，不会出现
「套件崩了却报全部通过」的情况。

## 代码约定

- 事件一律在 JavaScript 里绑定，**不写内联 `onclick`**。
- 颜色只用 `css/base.css` 里的 CSS 变量，不写死色值。
- 工具页复用 `css/tool.css` 的 `.panel` / `.stat` / `.output` / `.freq-list` 结构。
- 不引入 CDN。需要第三方库时，从 npm 官方包取产物放进 `js/vendor/`，
  在 `js/vendor/vendor.json` 记录版本、来源与 sha256，并更新 `THIRD-PARTY.md`。
  取到后必须跑一次 `node --check`（见 THIRD-PARTY.md 里的校验方法）。
- 工具逻辑写在 `js/tools/<slug>.js`，页面里只保留结构。

## 部署

纯静态站点，把整个目录推到 GitHub Pages / Cloudflare Pages / Netlify / 任意对象存储即可。
注意 `404.html` 依赖根绝对路径，请部署在域名根目录下（或子目录时同步调整它）。

## 许可与致谢

本项目以 [MIT 许可](LICENSE) 发布，Copyright (c) 2026 HyperKitakami。
第三方代码的来源、版本、许可与改动清单见 **[THIRD-PARTY.md](THIRD-PARTY.md)**。

### 致谢

**[Praticulus](https://github.com/jamalofski/praticulus)** —— 由
[Jamal Tantaoui](https://tantaoui.com/) 与
[Iris Digital](https://irisdigital.tech/) 构建并维护的隐私优先工具集，
同样以 MIT 许可开源。本项目的整体形态（纯静态、零依赖、100% 客户端运行、
一个工具一个目录加一个脚本）直接参考了它的做法，
目前有二十一个工具是基于它移植而来：

- **正则表达式测试** ← `regex-tester`：沿用其模式解释算法、界面结构与交互流程
- **JSON 格式化** ← `json-formatter`：沿用其格式化 / 压缩 / 校验的功能划分与粘贴即格式化
- **Markdown 转 HTML** ← `markdown-to-html`：沿用其双视图、Tailwind 选项与草稿自动保存
- **CSV 查看器** ← `csv-viewer`：沿用其 RFC 4180 解析器、拖放上传与 JSON / TSV 导出
- **Markdown 预览** ← `markdown-preview`：沿用其双栏实时预览与草稿自动保存
- **取色器** ← `color-picker`：沿用其系统取色盘、屏幕吸管、明暗色阶与对比度检查
- **颜色格式转换** ← `color-converter`：沿用其五种格式换算、透明度开关与命名颜色提示
- **颜色混合** ← `color-blender`：沿用其两色输入、中间点滑杆与色阶条，
  并按 W3C 规范补上 16 种混合模式
- **对比度检查** ← `contrast-checker`：沿用其前后景交换、四档徽章与预览区，
  并修好建议修复算法的方向缺陷
- **调色板生成** ← `palette-generator`：沿用其六种配色方案与三种导出格式，
  并补上 11 级明暗色阶与 JSON 导出
- **渐变生成器** ← `gradient-generator`：沿用其三种渐变类型、色标编辑与 10 套预设，
  并修好添加色标的位置缺陷
- **二维码生成** ← `qr-generator`：沿用其九种内容类型、中心 Logo 与导出，
  预览改用 SVG，并把内置库换成 npm 官方产物
- **密码生成器** ← `password-generator`：沿用其双模式、长度滑杆、字符类别开关与批量生成，
  并把只覆盖 A–F 的上游词表换成 EFF 官方 7776 词长词表
- **占位文本生成** ← `lorem-ipsum`：沿用其四种单位、以经典开头与 HTML 包裹，
  补上中文语料与中文界面，结果区换成正文字体
- **UUID 生成器** ← `uuid-generator`：沿用其三个版本、三个格式开关、批量与校验器，
  并按 RFC 9562 补上 v7 的同毫秒单调计数器与 v1 的节点多播位
- **时间戳转换** ← `timestamp-converter`：沿用其双向输入、结果字段与批量表格，
  补上纳秒档与可手动覆盖的单位选择、多时区对照表
- **文本大小写转换** ← `text-case`：沿用其 10 种命名风格与整段大小写转换，
  并把驼峰切分补上缩写词那一遍、让非拉丁字母不再被静默丢弃
- **Base64 编解码** ← `base64`：沿用其编码/解码双按钮、URL 安全与自动判定开关、
  文件拖放与图片预览，并把「自动判定」从只看字符集改成要求解出合法 UTF-8 文本
- **TOTP 动态口令** ← `totp-generator`：沿用其 Base32 密钥 + 6/8 位 / 30、60 秒 /
  SHA-1 三组选项、实时倒计时、otpauth 链接与二维码的整套流程，
  并把 `crypto.subtle` 不可用时的降级路径补上、把二维码从 canvas 换成 SVG
- **哈希摘要生成** ← `hash-generator`：沿用其文本 + 文件两种输入、五种算法一次全算、
  hex / Base64 两种输出与「粘贴期望摘要反查算法」的比对框，
  并补上 SHA-384、把 MD5 的字节口径修正、给大文件加上限与替代方案
- **URL 编解码** ← `url-encoder`：沿用其输入即处理、结果换到输入与 URL 结构拆解面板，
  并把上游「编码 / 解码 / 编码组件」三个按钮改成「三种模式 × 两个方向」，
  补上空格与 `+` 的互换、逐个定位的解码报错、查询参数与常用字符两张表

二十一者都做了中文化、设计系统统一，并修复了上游缺陷 ——
正则工具修掉了空匹配死循环与分享链接 base64 填充导致的参数丢失；
JSON 工具重写了语法高亮（上游因为「先转义再匹配」导致键名与字符串值完全不着色）；
Markdown 工具移除了 Prism 依赖，改用内置的轻量 HTML 着色；
CSV 工具补上了 BOM 剥离与分隔符探测的引号处理，并新增编码探测与分页；
Markdown 预览补上了 localStorage 容错，修正了「清空」按钮的语义，并新增大纲与统计；
取色器让非法色值不再静默变黑，并把颜色解析扩展到颜色名与 CSS Color 4 语法；
颜色格式转换则靠交叉验证抓出命名颜色表里 `mediumpurple` 的数值笔误；
颜色混合修掉了 HSL 插值里无彩色绕经品红的错误路径与端点色漂移，
并把结果从全局变量收回模块内部；
对比度检查修掉了建议修复只朝一个方向调明度、导致中灰背景明明有解却报「无法修复」的方向缺陷；
调色板生成修掉了配色里主色偏一档的取整误差，并把劫持空格滚动的快捷键换成 R 键；
渐变生成器修掉了「添加色标落在 100%、与末尾完全重合」这个让按钮看起来失效的缺陷；
二维码生成补上了 iCalendar / vCard 的文本转义，并把预览从 canvas 换成 SVG，
顺手换掉了上游那份删掉版权声明、又无法用哈希校验的内置库；
密码生成器修掉了取字符的模偏差、字符集为空时静默给一串小写字母、
复制没有降级、自定义分隔符清不掉、非法数值不校验、批量条数静默截断，
以及爆破时间分档表只到「数十亿年」这几处，并把截断到 A–F 的词表换成 EFF 官方长词表；
占位文本生成修掉了会让整个脚本在旧 Safari 上加载失败的后行断言、
「单词」单位下 HTML 开关静默失效、超量时整块重复、数量不校验与复制没有降级，
并把被误标成 Cicero 原文的两段语料标注改准、补上中文语料；
UUID 生成器按 RFC 9562 补上了 v1 节点标识的单播/多播位（原文是 MUST）、
v7 在同一毫秒内的单调计数器（RFC 明确点名了批量场景）、
校验器对错位横线的放行，以及批量数量不校验，并把上游为规避 BigInt 字面量
而拆出的两个文件收成一个；
时间戳转换修掉了 19 位纳秒时间戳被当成微秒（会算出公元 56385 年且不报错）、
带小数的秒级时间戳解析不了而同样形态的短小数却被当成日期解析、`+` 开头的数字解析不了、
裸日期的时区口径不告知、自动判定的单位不允许覆盖、批量没有行数上限，
并把时区行改用 `formatToParts` 自己拼字符串以摆脱 locale 的影响；
文本大小写转换修掉了驼峰切分认不出缩写词尾巴（`getHTTPResponse` → `get_httpresponse`）、
非拉丁字母被当成分隔符静默丢弃（`café` → `caf`、中文整段变空串）、
Sentence case 不认中文标点、Title Case 把撇号当词边界（`don't` → `Don'T`）这几处；
Base64 修掉了自动判定把普通英文单词当 Base64（EFF 7776 个常用词实测误判 78.5%）、
把合法的二进制 Base64 报成「无效串」（报出来的原因不是真原因）、不认 MIME 折行
（于是自动判定把 Base64 又编码一遍）、复制裸调 `navigator.clipboard` 没有降级，
并把「代理项被静默替换成 U+FFFD」这件事显式报了出来；
TOTP 动态口令修掉了非安全上下文下 `crypto.subtle` 缺失导致整块不可用且只报一句
「Error」（现在优先用平台实现、回落自带纯 JS 实现，并写明走的是哪条路）、
Base32 解码过宽（`AB`、`ABC` 这类残留位非零或长度不合法、抄错一个字符的输入
会被解成一个「看起来正常」的密钥，于是口令永远对不上却没有任何提示）、
不检查密钥长度（RFC 4226 §4 R6 要求至少 128 位）、异步算口令没有防竞态
（改选项时先发的 Promise 可能后到、把过期的口令盖上去），以及 otpauth 链接的编码
（上游把账号与发行方里的「:」直接删掉 —— 那是静默改用户的输入）；
哈希摘要生成修掉了非 ASCII 文本的 MD5 算错（上游把 JS 字符串的 UTF-16 码元直接
按字节塞进 32 位字，而 SHA 走 UTF-8 —— 于是**同一个字符串粘进文本框和存成文件
拖进来，MD5 不一样**）、`crypto.subtle` 不可用时四个 SHA 静默空白、
MD5 与 SHA-1 已破却只字不提、异步结果没有防竞态、复制没有回退，
并给大文件补上 128 MB 上限与替代方案（WebCrypto 的摘要没有流式接口）；
URL 编解码修掉了「自动判定方向」把含字面 `%XX` 的普通文本当已编码串
（于是那种文本根本没法编码）、解码前 `trim()` 悄悄吃掉首尾空格、
`+` 从不被当作空格（表单来的查询串本来就解不对）、
解码失败只报一句 `Invalid encoded string`（不给位置也不给原因）、
`encodeURI` 编码配 `decodeURIComponent` 解码导致 `%2F` 被解成 `/`、
把占位文案写进结果元素当内容（复制按钮会把它一起复制走）。

**库与数据的作者们**：[marked](https://github.com/markedjs/marked)（MarkedJS、Christopher Jeffrey）、
[DOMPurify](https://github.com/cure53/DOMPurify)（Cure53），以及
[EFF](https://www.eff.org/dice) 整理的 Diceware 长词表（CC BY 3.0 US）。

也感谢所有坚持把工具做成「数据不出浏览器」的人。
