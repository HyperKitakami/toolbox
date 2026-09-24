# 工具箱 Toolbox

> 一个纯静态、零依赖的个人在线工具箱。所有工具都在浏览器本地运行，输入不会被上传到任何服务器。

## 站点定位

- **100% 客户端**：没有后端，没有接口调用，断网可用。
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
├── robots.txt / sitemap.xml   由脚本生成
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
│   ├── vendor/                自托管的第三方库（见 THIRD-PARTY.md）
│   │   ├── marked.umd.js      Markdown 解析
│   │   ├── purify.min.js      HTML 净化
│   │   └── vendor.json        版本、来源与 sha256 记录
│   └── tools/
│       ├── _template.js       工具逻辑模板
│       ├── word-counter.js    自研
│       ├── diff-checker.js    自研
│       ├── regex-tester.js    移植
│       ├── json-formatter.js  移植
│       ├── markdown-to-html.js 移植
│       ├── csv-viewer.js     移植
│       └── markdown-preview.js 移植
├── hubs/<id>/index.html       六个分类页（由脚本生成，不要手改）
├── tools/
│   ├── _template/index.html   工具页模板：复制这个目录开新工具
│   └── <slug>/index.html      每个工具一个目录
├── about/  privacy/
└── scripts/
    ├── chrome.mjs             页头页脚的唯一来源
    ├── build-pages.mjs        生成分类页 + 同步页头页脚 + 生成 sitemap
    ├── test.mjs               测试运行器
    └── tests/                 测试套件：site.mjs 管全站，每个工具一个文件
```

## 工具状态

| 分类 | 已上线 | 规划中 | 已挂起 |
|---|---|---|---|
| 开发者 | JSON 格式化、CSV 查看器、Markdown 预览、Markdown 转 HTML、文本差异对比、正则表达式测试 | 0 | 5 |
| 安全 | — | 8 | 0 |
| 颜色 | 颜色格式转换、取色器、颜色混合、对比度检查、调色板生成、渐变生成器 | 0 | 0 |
| 转换 | — | 6 | 0 |
| 生成器 | 二维码生成 | 5 | 0 |
| 文本 | 字数统计 | 6 | 0 |

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
| 文本差异对比 | 自研 | — |
| 字数统计 | 自研 | — |

## 内置的第三方库

自托管在 `js/vendor/`，不通过 CDN 加载。版本与校验和记录在 `js/vendor/vendor.json`。

| 库 | 版本 | 用途 | 许可 |
|---|---|---|---|
| [marked](https://github.com/markedjs/marked) | 18.0.13 | Markdown 解析 | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.15 | HTML 净化 | Apache-2.0 OR MPL-2.0 |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 2.0.4 | 二维码编码 | MIT |

> 注意 DOMPurify **不是 MIT**。再分发本项目时需同时遵守它的许可条款。

完整的来源、改动清单与校验方法见 **[THIRD-PARTY.md](THIRD-PARTY.md)**。

## 加一个新工具（三步）

1. **建页面**：复制 `tools/_template/` 为 `tools/<slug>/`，改掉 `<title>`、
   `description`、`data-tool`、`data-hub`、面包屑、`<h1>` 与描述文字。
2. **写逻辑**：复制 `js/tools/_template.js` 为 `js/tools/<slug>.js`，写自己的逻辑，
   然后在页面底部按顺序引入它（`registry.js` → `site.js` → 你的脚本）。
3. **注册**：打开 `js/registry.js`，在 `TOOLS` 数组里把对应那一行的状态
   从 `'planned'` 改成 `'ready'`。首页、分类页、搜索会自动收录。

`slug` 必须与目录名一致，用短横线小写英文。

## 维护脚本

改了页头或页脚（`scripts/chrome.mjs`）之后跑一次：

```bash
node scripts/build-pages.mjs
```

它会：
1. 依据 `js/registry.js` 重新生成 `hubs/<id>/index.html`；
2. 把页头页脚同步进所有 HTML 的 `<!-- chrome:header:start -->` 标记区间；
3. 重新生成 `sitemap.xml` 与 `robots.txt`。

部署前记得把 `scripts/build-pages.mjs` 顶部的 `SITE_URL` 改成真实域名。

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
目前有十二个工具是基于它移植而来：

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

十二者都做了中文化、设计系统统一，并修复了上游缺陷 ——
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
顺手换掉了上游那份删掉版权声明、又无法用哈希校验的内置库。

**库的作者们**：[marked](https://github.com/markedjs/marked)（MarkedJS、Christopher Jeffrey）
与 [DOMPurify](https://github.com/cure53/DOMPurify)（Cure53）。

也感谢所有坚持把工具做成「数据不出浏览器」的人。
