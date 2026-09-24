/* ==========================================================================
   _harness.mjs — 测试公共设施
   --------------------------------------------------------------------------
   站点本身零依赖；这里用 jsdom 在 Node 里跑页面脚本，属于开发期工具。
   首次使用： npm i -D jsdom
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (e) {
  console.error('\n测试需要 jsdom（只有测试需要，站点本身零依赖）：\n\n  npm i -D jsdom\n');
  process.exit(2);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --- 断言 ---------------------------------------------------------------- */
const stats = { pass: 0, fail: 0, failures: [] };

export function ok(name, cond, extra) {
  if (cond) {
    stats.pass++;
    console.log(`  \u2713 ${name}`);
  } else {
    stats.fail++;
    stats.failures.push(name);
    console.log(`  \u2717 ${name}${extra ? '   \u2192 ' + extra : ''}`);
  }
}

/**
 * 直接记一条失败。
 * 给运行器用：套件抛出异常时也要计入失败数，否则退出码会是 0、报告显示全绿。
 */
export function fail(name, extra) {
  stats.fail++;
  stats.failures.push(name);
  console.log(`  \u2717 ${name}${extra ? '   \u2192 ' + extra : ''}`);
}

export function section(title) {
  console.log(`\n${title}`);
}

export function summary() {
  console.log('\n' + '\u2500'.repeat(54));
  if (stats.fail) {
    console.log(`\u2717  ${stats.pass} 通过 / ${stats.fail} 失败`);
    stats.failures.forEach((f) => console.log(`     失败：${f}`));
  } else {
    console.log(`\u2713  全部通过（${stats.pass} 项）`);
  }
  console.log('');
  return stats.fail;
}

/* --- 加载页面 ------------------------------------------------------------ */

/**
 * 把页面装进 jsdom 并按顺序执行它的外部脚本。
 * @param {string} rel  相对项目根的路径，例如 'tools/diff-checker/index.html'
 * @param {object} [opts]
 * @param {string} [opts.url]        页面 URL，默认按路径推导
 * @param {number} [opts.wait]       脚本执行后等待的毫秒数
 * @param {boolean}[opts.secure]     是否伪造 isSecureContext（默认 true）
 * @param {Function}[opts.clipboard] 传入则伪造 navigator.clipboard
 * @param {object} [opts.storage]    预先写入 localStorage 的键值（模拟上次会话留下的草稿）
 */
export async function loadPage(rel, opts = {}) {
  const abs = path.join(ROOT, rel);
  const html = fs.readFileSync(abs, 'utf8');
  const errors = [];

  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  vc.on('error', (m) => errors.push(String(m)));

  const dir = path.dirname(rel).split(path.sep).join('/');
  const url = opts.url || `http://localhost:8080/${dir === '.' ? '' : dir + '/'}`;

  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,   /* 提供 requestAnimationFrame */
    virtualConsole: vc
  });
  const w = dom.window;

  /* jsdom 没有实现 matchMedia，补一个 */
  w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });

  if (opts.secure !== false) {
    Object.defineProperty(w, 'isSecureContext', { value: true, configurable: true });
  }
  if (opts.clipboard) {
    Object.defineProperty(w.navigator, 'clipboard', {
      value: { writeText: (t) => { opts.clipboard(t); return Promise.resolve(); } },
      configurable: true
    });
  }

  if (opts.storage) {
    for (const k of Object.keys(opts.storage)) w.localStorage.setItem(k, opts.storage[k]);
  }

  /* 页面里的资源引用带 ?v=<hash> 版本号（防缓存，见 build-pages.mjs），
     解析成文件路径时要把查询串去掉 */
  const srcs = [...html.matchAll(/<script src="([^"]+)"[^>]*><\/script>/g)]
    .map((m) => m[1].split('?')[0]);
  for (const s of srcs) {
    const p = s.startsWith('/') ? path.join(ROOT, s) : path.resolve(path.dirname(abs), s);
    let code;
    try {
      code = fs.readFileSync(p, 'utf8');
    } catch (e) {
      throw new Error(`页面引用的脚本不存在：${s}（解析为 ${p}）`);
    }
    try {
      w.eval(code);
    } catch (e) {
      throw new Error(`执行 ${relPath(p)} 时出错：${e.message}`);
    }
  }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  await sleep(opts.wait || 40);

  return { dom, w, d: w.document, errors, html, srcs };
}

/* --- 小工具 -------------------------------------------------------------- */
export const count = (d, sel) => d.querySelectorAll(sel).length;

export function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    /* 跳过 node_modules 与所有点开头的目录（.git / .workbuddy-ai / .temporary 等），
       它们不是站点页面 */
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** 在 Node 里加载 js/registry.js，拿到站点数据 */
export function loadRegistry() {
  const code = fs.readFileSync(path.join(ROOT, 'js/registry.js'), 'utf8');
  const win = {};
  new Function('window', code)(win);
  if (!win.TOOLBOX) throw new Error('js/registry.js 没有导出 window.TOOLBOX');
  return win.TOOLBOX;
}

export const relPath = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
