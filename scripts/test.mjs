#!/usr/bin/env node
/* ==========================================================================
   test.mjs — 测试运行器
   --------------------------------------------------------------------------
   用法：
     npm i -D jsdom          # 首次，仅测试需要
     node scripts/test.mjs            跑全部套件
     node scripts/test.mjs diff       只跑名字里含 diff 的套件
   --------------------------------------------------------------------------
   新增一个工具的测试：在 scripts/tests/ 下加一个 <slug>.mjs，
   默认导出一个 async 函数即可，运行器会自动发现。
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { summary, section, fail } from './tests/_harness.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tests');
const filter = process.argv[2] || '';

const files = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
  .sort((a, b) => (a === 'site.mjs' ? -1 : b === 'site.mjs' ? 1 : a.localeCompare(b)))
  .filter((f) => !filter || f.includes(filter));

if (!files.length) {
  console.error(`没有匹配的测试文件（过滤词：${filter}）`);
  process.exit(2);
}

console.log(`\n工具箱 · 测试（${files.length} 个套件）`);

for (const file of files) {
  section(`━━━ ${file.replace(/\.mjs$/, '')} ━━━`);
  const mod = await import(pathToFileURL(path.join(DIR, file)).href);
  try {
    await mod.default();
  } catch (e) {
    /* 必须计入失败数：只设 process.exitCode 会被后面的 process.exit() 覆盖，
       结果是套件崩了却报「全部通过」、退出码还是 0。 */
    fail(`${file} 抛出异常`, e && e.message ? e.message : String(e));
    if (e && e.stack) console.log('  ' + e.stack.split('\n').slice(1, 4).join('\n  '));
    process.exitCode = 1;
  }
}

process.exit(summary() ? 1 : 0);
