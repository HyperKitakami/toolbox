/* ==========================================================================
   站点骨架测试：registry 一致性、首页、分类页、搜索、页头页脚
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, ok, section, loadPage, count, walk, loadRegistry, relPath, sleep
} from './_harness.mjs';

export default async function run() {
  const T = loadRegistry();

  /* ---------- 1. registry 与文件系统的一致性 ---------- */
  section('1. registry 与文件系统一致性');

  const slugs = T.tools.map((t) => t.slug);
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  ok('工具 slug 唯一', dupes.length === 0, dupes.join(', '));

  const badHub = T.tools.filter((t) => !T.hubMap[t.hub]).map((t) => t.slug);
  ok('每个工具的分类都有效', badHub.length === 0, badHub.join(', '));

  const missingHubPages = T.hubs.filter(
    (h) => !fs.existsSync(path.join(ROOT, 'hubs', h.id, 'index.html'))
  ).map((h) => h.id);
  ok('每个分类页都已生成', missingHubPages.length === 0, missingHubPages.join(', '));

  const ready = T.readyTools();
  const missingPages = [];
  const missingToolAttr = [];
  for (const t of ready) {
    const p = path.join(ROOT, 'tools', t.slug, 'index.html');
    if (!fs.existsSync(p)) { missingPages.push(t.slug); continue; }
    if (!fs.readFileSync(p, 'utf8').includes(`data-tool="${t.slug}"`)) missingToolAttr.push(t.slug);
  }
  ok('每个已上线工具都有页面', missingPages.length === 0, missingPages.join(', '));
  ok('每个工具页都声明了 data-tool', missingToolAttr.length === 0, missingToolAttr.join(', '));

  const missingScripts = ready.filter(
    (t) => !fs.existsSync(path.join(ROOT, 'js', 'tools', `${t.slug}.js`))
  ).map((t) => t.slug);
  ok('每个已上线工具都有脚本', missingScripts.length === 0, missingScripts.join(', '));

  const notInRegistry = fs.readdirSync(path.join(ROOT, 'tools'))
    .filter((n) => !n.startsWith('_'))
    .filter((n) => !fs.existsSync(path.join(ROOT, 'tools', n, 'index.html')));
  ok('tools/ 下没有空目录', notInRegistry.length === 0, notInRegistry.join(', '));

  /* 每个已上线的工具都必须有专属测试套件，避免漏测 */
  const testFiles = fs.readdirSync(path.join(ROOT, 'scripts', 'tests'))
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
    .map((f) => f.replace(/\.mjs$/, ''));
  const noTest = ready.filter((t) => !testFiles.includes(t.slug)).map((t) => t.slug);
  ok('每个已上线工具都有专属测试套件', noTest.length === 0,
     noTest.length ? '缺少 ' + noTest.join(', ') : '');

  /* 反过来也查一下：测试套件不能指向不存在的工具 */
  const orphanTests = testFiles.filter(
    (f) => f !== 'site' && f !== 'color-utils' && !T.tools.some((t) => t.slug === f)
  );
  ok('没有指向不存在工具的测试套件', orphanTests.length === 0, orphanTests.join(', '));

  /* ---------- 2. 首页 ---------- */
  section('2. 首页');

  const home = await loadPage('index.html');
  ok('无脚本错误', home.errors.length === 0, home.errors.join(' | '));
  ok('分类卡片 6 个', count(home.d, '#hub-grid .hub-card') === T.hubs.length,
     String(count(home.d, '#hub-grid .hub-card')));
  ok(`工具卡片 ${T.tools.length} 个`,
     count(home.d, '#tool-grid .tool-card') === T.tools.length,
     String(count(home.d, '#tool-grid .tool-card')));
  ok(`已上线 ${ready.length} 个可点击`,
     count(home.d, '#tool-grid a.tool-card') === ready.length,
     String(count(home.d, '#tool-grid a.tool-card')));
  const byStatus = (s) => T.tools.filter((t) => t.status === s).length;

  ok('hero 统计与 registry 一致',
     home.d.querySelector('[data-count="ready"]').textContent === String(byStatus('ready')) &&
     home.d.querySelector('[data-count="planned"]').textContent === String(byStatus('planned')),
     `ready=${home.d.querySelector('[data-count="ready"]').textContent} planned=${home.d.querySelector('[data-count="planned"]').textContent}`);
  ok('筛选胶囊计数正确',
     home.d.querySelector('.chip[data-filter="all"] .chip-count').textContent === String(T.tools.length));
  ok('筛选胶囊有 4 种状态',
     count(home.d, '.chip[data-filter]') === 4, String(count(home.d, '.chip[data-filter]')));

  /* 筛选交互 */
  const clickChip = async (filter) => {
    home.d.querySelector(`.chip[data-filter="${filter}"]`)
      .dispatchEvent(new home.w.MouseEvent('click', { bubbles: true }));
    await sleep(20);
  };

  await clickChip('ready');
  ok('筛选「已上线」结果正确', count(home.d, '#tool-grid .tool-card') === byStatus('ready'));
  ok('筛选后 aria-pressed 正确',
     home.d.querySelector('.chip[data-filter="ready"]').getAttribute('aria-pressed') === 'true');

  await clickChip('planned');
  ok('筛选「规划中」结果正确',
     count(home.d, '#tool-grid .tool-card') === byStatus('planned'),
     String(count(home.d, '#tool-grid .tool-card')));

  await clickChip('suspended');
  ok('筛选「已挂起」结果正确',
     count(home.d, '#tool-grid .tool-card') === byStatus('suspended'),
     String(count(home.d, '#tool-grid .tool-card')));
  ok('已挂起的卡片带对应样式类',
     count(home.d, '#tool-grid .tool-card--suspended') === byStatus('suspended'));
  ok('已挂起的卡片徽章文案为「已挂起」',
     home.d.querySelector('#tool-grid .tool-card--suspended .badge').textContent === '已挂起',
     home.d.querySelector('#tool-grid .tool-card--suspended .badge').textContent);
  ok('已挂起的卡片不可点击',
     home.d.querySelector('#tool-grid .tool-card--suspended').tagName === 'DIV');
  await clickChip('all');

  /* 三个状态的数量加起来等于总数 */
  ok('各状态数量之和等于工具总数',
     byStatus('ready') + byStatus('planned') + byStatus('suspended') === T.tools.length,
     `${byStatus('ready')}+${byStatus('planned')}+${byStatus('suspended')} vs ${T.tools.length}`);

  ok('每张卡片都有分类主题色',
     [...home.d.querySelectorAll('#tool-grid .tool-card')]
       .every((c) => c.style.getPropertyValue('--hub-accent').startsWith('#')));

  /* ---------- 3. 分类页 ---------- */
  section('3. 分类页');

  for (const hub of T.hubs) {
    const page = await loadPage(`hubs/${hub.id}/index.html`);
    const n = count(page.d, '#tool-grid .tool-card');
    ok(`${hub.id}：${hub.totalCount} 张卡片，无脚本错误`,
       n === hub.totalCount && page.errors.length === 0,
       `${n}/${hub.totalCount} ${page.errors.join(' | ')}`);
    ok(`${hub.id}：导航高亮与主题色正确`,
       page.d.querySelector(`.site-nav a[href="../../hubs/${hub.id}/"]`)?.getAttribute('aria-current') === 'page' &&
       page.d.documentElement.style.getPropertyValue('--hub-accent') === hub.accent);
    ok(`${hub.id}：分类图标已注入`, page.d.querySelector('[data-hub-icon] svg') !== null);

    const suspended = hub.tools.filter((t) => t.status === 'suspended').length;
    ok(`${hub.id}：挂起数量与 registry 一致（${suspended}）`,
       count(page.d, '#tool-grid .tool-card--suspended') === suspended,
       String(count(page.d, '#tool-grid .tool-card--suspended')));
    ok(`${hub.id}：筛选胶囊含全部四种状态`,
       count(page.d, '.chip[data-filter]') === 4, String(count(page.d, '.chip[data-filter]')));
  }

  /* ---------- 4. 搜索 ---------- */
  section('4. 全局搜索');

  const search = await loadPage('index.html');
  const overlay = search.d.querySelector('.search-overlay');
  ok('搜索面板已注入', overlay !== null);

  const openSearch = async (q) => {
    if (overlay.getAttribute('data-open') !== 'true') {
      search.d.dispatchEvent(new search.w.KeyboardEvent('keydown', { key: '/', bubbles: true }));
      await sleep(20);
    }
    if (q !== undefined) {
      const input = search.d.querySelector('.search-input');
      input.value = q;
      input.dispatchEvent(new search.w.Event('input', { bubbles: true }));
      await sleep(170);
    }
  };

  await openSearch();
  ok('按 / 打开面板', overlay.getAttribute('data-open') === 'true');
  ok('默认展示推荐列表', count(search.d, '.search-item') === 12,
     String(count(search.d, '.search-item')));

  for (const [q, expect] of [
    ['json', 'JSON 格式化'],
    ['字数', '字数统计'],
    ['base64', 'Base64'],
    ['diff', '文本差异对比'],
    ['颜色', null]
  ]) {
    await openSearch(q);
    const first = search.d.querySelector('.search-item');
    ok(`搜索「${q}」有结果`, count(search.d, '.search-item') > 0);
    if (expect) {
      ok(`搜索「${q}」首项是 ${expect}`, first?.textContent.includes(expect), first?.textContent.trim());
    }
  }

  await openSearch('zzzzqqqq');
  ok('无结果时显示空态', search.d.querySelector('.search-empty') !== null);

  search.d.dispatchEvent(new search.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(20);
  ok('Esc 关闭面板', overlay.getAttribute('data-open') === 'false');

  /* ---------- 5. 所有页面的页头页脚 ---------- */
  section('5. 全站页头页脚');

  const pages = walk(ROOT).filter((f) => /\.html?$/i.test(f)).map(relPath).sort();
  ok(`共 ${pages.length} 个 HTML 页面`, pages.length > 0);

  for (const rel of pages) {
    const page = await loadPage(rel);
    const header = page.d.querySelector('.site-header .brand');
    const footer = page.d.querySelector('.site-footer .footer-bottom');
    ok(`${rel}：页头/页脚完整、无脚本错误`,
       header !== null && footer !== null && page.errors.length === 0,
       `${header ? '' : '缺页头 '}${footer ? '' : '缺页脚 '}${page.errors.join(' | ')}`);
  }

  ok('页脚年份已填充',
     home.d.querySelector('[data-year]').textContent === String(new Date().getFullYear()));

  /* ---------- 6. sitemap ---------- */
  section('6. sitemap.xml');

  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  for (const t of ready) {
    ok(`sitemap 收录 /tools/${t.slug}/`, sitemap.includes(`/tools/${t.slug}/`));
  }
  ok('sitemap 收录首页与分类页',
     sitemap.includes('<loc>') && T.hubs.every((h) => sitemap.includes(`/hubs/${h.id}/`)));
}
