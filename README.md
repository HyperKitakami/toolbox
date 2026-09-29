# 工具箱 Toolbox

> 一个纯静态、零依赖的个人在线工具箱。除「AI 辅助」一组要调用外部模型外，所有工具都在浏览器本地运行，输入不会离开本机。

## 站点定位

- **默认 100% 客户端**：没有后端、没有本站接口。除「AI 辅助」那一组外，断网也可用。
- **可审计**：全部是未压缩的静态文件，右键查看源码看到的就是实际运行的代码。
- **零构建、零依赖**：原生 HTML / CSS / JavaScript，没有框架，没有打包步骤。
- **无追踪**：不加载分析脚本、CDN、第三方字体或图标。

「AI 辅助」是站内**唯一会联网**的分类：那一组工具要用你自己的 API Key 调外部大模型，
输入（含音频）会发往第三方接口。其余分类的工具全部在浏览器本地运行。
接入新工具时请守住这条边界 —— 需要联网的一律进 `ai`，不要混进其他分类。

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
├── index.html                  首页：Hero + 分类 + 全部工具
├── 404.html                    用根绝对路径，不参与页头页脚同步
├── favicon.svg
├── LICENSE                     MIT 许可与版权声明
├── THIRD-PARTY.md              第三方代码的来源、版本、许可与改动清单
├── css/
│   ├── base.css                设计令牌、重置、排版与通用组件（改配色只改这里）
│   ├── site.css                页头 / 页脚 / 首页 / 分类页 / 搜索面板
│   └── tool.css                工具页骨架与各工具共用组件
├── js/
│   ├── registry.js             ★ 唯一数据源：分类 + 工具清单
│   ├── theme-init.js           深色模式预置，须在 <head> 同步加载
│   ├── site.js                 主题、导航、卡片渲染、搜索与公共工具方法
│   ├── color-utils.js          颜色换算、对比度与混合模式（颜色类工具共用）
│   ├── hash-utils.js           MD5 / SHA / HMAC / Base32（安全类工具共用）
│   ├── random-utils.js         随机取样与字符集（生成器类工具共用）
│   ├── password-utils.js       爆破时间、强度分档与强度估算
│   ├── qr-utils.js             二维码矩阵 → SVG / canvas 几何
│   ├── lorem-corpus.js         占位文本语料（拉丁 + 中文）
│   ├── mock-data-corpus.js     测试数据语料（姓氏、地名、公司词…）
│   ├── tools/                  每个工具一个脚本，与 tools/<slug>/ 一一对应
│   └── vendor/                 自托管的第三方资源（见 THIRD-PARTY.md）
├── hubs/<id>/index.html        分类页，由 registry.js 生成，请勿手改
├── tools/
│   ├── _template/              工具页模板：复制这个目录开新工具
│   └── <slug>/index.html       每个工具一个目录
├── about/                      关于页
├── privacy/                    隐私说明
└── scripts/                    构建与测试脚本
```

`registry.js` 是全站的数据源：分类、工具清单、名称与描述都在这里，首页、
分类页与搜索都由它驱动，不要另建一份清单。

## 代码约定

- 事件一律在 JavaScript 里绑定，**不写内联 `onclick`**。
- 颜色只用 `css/base.css` 里的 CSS 变量，不写死色值。
- 工具页复用 `css/tool.css` 的 `.panel` / `.stat` / `.output` / `.freq-list` 结构。
- 工具逻辑写在 `js/tools/<slug>.js`，页面里只保留结构。
- 不引入 CDN。需要第三方库时，从 npm 官方包取产物放进 `js/vendor/`，
  在 `js/vendor/vendor.json` 记录版本、来源与 sha256，并更新 `THIRD-PARTY.md`。

## 部署

纯静态站点，把整个目录推到 GitHub Pages / Cloudflare Pages / Netlify / 任意对象存储即可。
注意 `404.html` 依赖根绝对路径，请部署在域名根目录下（或子目录时同步调整它）。

## 许可与致谢

本项目以 [MIT 许可](LICENSE) 发布，Copyright (c) 2026 HyperKitakami。
引用的第三方代码与数据的来源、版本、许可与改动清单见 **[THIRD-PARTY.md](THIRD-PARTY.md)**。

本站的整体形态（纯静态、零依赖、100% 客户端运行、一个工具一个目录加一个脚本）
参考了 **[Praticulus](https://github.com/jamalofski/praticulus)** —— 由
[Jamal Tantaoui](https://tantaoui.com/) 与 [Iris Digital](https://irisdigital.tech/)
构建并维护的隐私优先工具集，同样以 MIT 许可开源；其中移植自它的工具，
逐个的改动清单同样记在 THIRD-PARTY.md。也感谢
[marked](https://github.com/markedjs/marked)、[DOMPurify](https://github.com/cure53/DOMPurify)、
[EFF](https://www.eff.org/dice) 与 [Unicode](https://www.unicode.org/) 等库与数据的作者。

也感谢所有坚持把工具做成「数据不出浏览器」的人。
