#!/usr/bin/env node
/* ==========================================================================
   build-pages.mjs — 维护脚本（不是运行时构建，站点本身仍是纯静态）
   --------------------------------------------------------------------------
   做三件事：
     1. 依据 js/registry.js 生成 6 个分类页 hubs/<id>/index.html
     2. 把 scripts/chrome.mjs 里的页头/页脚同步进所有 HTML 的标记区间
     3. 给所有 CSS / JS 引用补上内容版本号（?v=<sha256 前 8 位>）

   第 3 步是防缓存用的：浏览器缓存按 URL 走，文件改了但 URL 没变时，
   可能拿到「新 HTML + 旧 JS」的组合 —— 页面会**静默出错**。
   踩过一次：给 site.js 加了 T.util.readInt，两个生成器工具的结果区直接空白，
   控制台只有一行 TypeError，光看页面完全看不出问题在哪。
   版本号取文件内容哈希，所以只有文件真的变了 URL 才变，diff 不会天天翻。

   用法：  node scripts/build-pages.mjs
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { header, footer } from './chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* --- 读取 registry.js 作为唯一数据源 -------------------------------------- */
function loadRegistry() {
  const code = fs.readFileSync(path.join(ROOT, 'js/registry.js'), 'utf8');
  const win = {};
  new Function('window', code)(win);
  if (!win.TOOLBOX) throw new Error('registry.js 没有导出 window.TOOLBOX');
  return win.TOOLBOX;
}

/* --- 工具函数 ------------------------------------------------------------ */
const MARK = {
  hs: '<!-- chrome:header:start -->',
  he: '<!-- chrome:header:end -->',
  fs: '<!-- chrome:footer:start -->',
  fe: '<!-- chrome:footer:end -->'
};

const toPosix = (p) => p.split(path.sep).join('/');

/* 不参与页头页脚自动同步的文件（相对路径 404 会失效，故单独处理） */
const SKIP_CHROME = new Set(['404.html']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    /* 跳过 node_modules 与所有点开头的目录（.git / .workbuddy-ai / .temporary 等） */
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** 由相对路径推出站点根前缀，例如 hubs/text/index.html -> '../../' */
function prefixFor(rel) {
  return '../'.repeat(rel.split('/').length - 1);
}

function replaceRegion(html, startMark, endMark, content) {
  const i = html.indexOf(startMark);
  const j = html.indexOf(endMark);
  if (i < 0 || j < 0 || j < i) return null;
  return html.slice(0, i + startMark.length) + '\n' + content + '\n' + html.slice(j);
}

/* --- 1. 生成分类页 ------------------------------------------------------- */

/** 带版本号的资源 URL；rel 相对站点根，p 是页面到根的相对前缀 */
function assetUrl(p, rel) {
  return p + rel + '?v=' + assetHash(path.join(ROOT, rel));
}

function hubPage(hub) {
  const p = '../../';
  const total = hub.totalCount;
  const ready = hub.readyCount;
  const suspended = hub.tools.filter((t) => t.status === 'suspended').length;
  const planned = total - ready - suspended;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${hub.name}工具 · 工具箱</title>
<meta name="description" content="${hub.desc}">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0b0e14" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${p}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${assetUrl(p, 'css/base.css')}">
<link rel="stylesheet" href="${assetUrl(p, 'css/site.css')}">
<script src="${assetUrl(p, 'js/theme-init.js')}"></script>
</head>
<body data-hub="${hub.id}">
<a class="skip-link" href="#main">跳到主要内容</a>

${MARK.hs}
${header(p)}
${MARK.he}

<main id="main">
  <section class="hub-hero">
    <div class="container">
      <nav class="breadcrumb" aria-label="面包屑">
        <a href="${p}">首页</a>
        <span class="sep">/</span>
        <span aria-current="page">${hub.name}</span>
      </nav>
      <div class="hub-hero-top">
        <span class="hub-hero-icon" data-hub-icon aria-hidden="true"></span>
        <h1>${hub.name}工具</h1>
      </div>
      <p class="lead">${hub.desc}</p>
    </div>
  </section>

  <section class="hub-section">
    <div class="container">
      <div class="filter-row" role="group" aria-label="按状态筛选工具">
        <button class="chip" type="button" data-filter="all" aria-pressed="true">全部 <span class="chip-count" data-chip-count>${total}</span></button>
        <button class="chip" type="button" data-filter="ready" aria-pressed="false">已上线 <span class="chip-count" data-chip-count>${ready}</span></button>
        <button class="chip" type="button" data-filter="planned" aria-pressed="false">规划中 <span class="chip-count" data-chip-count>${planned}</span></button>
        <button class="chip" type="button" data-filter="suspended" aria-pressed="false">已挂起 <span class="chip-count" data-chip-count>${suspended}</span></button>
      </div>

      <div class="tool-grid" id="tool-grid"></div>

      <p class="hub-back"><a href="${p}">← 返回首页</a></p>
    </div>
  </section>
</main>

${MARK.fs}
${footer(p)}
${MARK.fe}

<script src="${assetUrl(p, 'js/registry.js')}" defer></script>
<script src="${assetUrl(p, 'js/site.js')}" defer></script>
</body>
</html>
`;
}

/* --- 2. 同步页头页脚 ----------------------------------------------------- */
function syncChrome(files) {
  let changed = 0;
  for (const file of files) {
    if (!/\.html?$/i.test(file)) continue;
    const rel = toPosix(path.relative(ROOT, file));
    const p = prefixFor(rel);
    const before = fs.readFileSync(file, 'utf8');

    let after = replaceRegion(before, MARK.hs, MARK.he, header(p));
    if (after === null) continue;
    after = replaceRegion(after, MARK.fs, MARK.fe, footer(p));
    if (after === null) continue;

    if (after !== before) {
      fs.writeFileSync(file, after, 'utf8');
      changed++;
      console.log(`  页头页脚已更新  ${rel}`);
    }
  }
  return changed;
}

/* --- 3. 给资源引用加内容版本号 ------------------------------------------- */

const hashCache = new Map();

/** 文件内容的 sha256 前 8 位；同一个文件只算一次 */
function assetHash(abs) {
  if (!hashCache.has(abs)) {
    hashCache.set(abs, crypto.createHash('sha256')
      .update(fs.readFileSync(abs)).digest('hex').slice(0, 8));
  }
  return hashCache.get(abs);
}

/* 只认 href / src 且以 .css / .js 结尾的本地引用。
   已带的 ?v= 会被替换掉，所以这一步是幂等的。 */
const ASSET_RE = /(\s(?:href|src)=")([^"]*?\.(?:css|js))(?:\?v=[0-9a-f]+)?(")/g;

function stampAssets(html, file) {
  return html.replace(ASSET_RE, (whole, pre, ref, post) => {
    if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(ref)) return whole;   /* 外链不动 */
    const abs = ref.startsWith('/')
      ? path.join(ROOT, ref.slice(1))
      : path.resolve(path.dirname(file), ref);
    if (!fs.existsSync(abs)) return whole;   /* 找不到就不动，缺文件由测试去报 */
    return pre + ref + '?v=' + assetHash(abs) + post;
  });
}

function syncAssets(files) {
  let changed = 0;
  for (const file of files) {
    if (!/\.html?$/i.test(file)) continue;
    const before = fs.readFileSync(file, 'utf8');
    const after = stampAssets(before, file);
    if (after !== before) {
      fs.writeFileSync(file, after, 'utf8');
      changed++;
      console.log(`  资源版本号已更新  ${toPosix(path.relative(ROOT, file))}`);
    }
  }
  return changed;
}

/* --- 主流程 ------------------------------------------------------------- */
function main() {
  const T = loadRegistry();

  console.log('1) 生成分类页');
  for (const hub of T.hubs) {
    const dir = path.join(ROOT, 'hubs', hub.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), hubPage(hub), 'utf8');
    console.log(`   hubs/${hub.id}/index.html  (${hub.totalCount} 个工具)`);
  }

  console.log('2) 同步页头页脚');
  const changed = syncChrome(walk(ROOT));
  if (!changed) console.log('   已是最新，无需改动');

  console.log('3) 给 CSS / JS 引用补版本号');
  const stamped = syncAssets(walk(ROOT));
  if (!stamped) console.log('   已是最新，无需改动');

  console.log(`\n完成。已上线 ${T.readyTools().length} 个工具，规划中 ${T.tools.length - T.readyTools().length} 个。`);
}

main();
