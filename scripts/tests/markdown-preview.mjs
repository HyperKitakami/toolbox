/* ==========================================================================
   Markdown 预览
   移植自 Praticulus 的 markdown-preview。重点验证 localStorage 容错、
   大纲生成与跳转、统计，以及「清空 / 恢复示例」两个按钮的语义。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/markdown-preview/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;

  const $ = (sel) => d.querySelector(sel);
  const html = () => d.getElementById('mp-preview').innerHTML;
  const stats = () => {
    const out = {};
    for (const s of d.querySelectorAll('#mp-stats .stat')) {
      out[s.querySelector('.stat-label').textContent] = s.querySelector('.stat-value').textContent;
    }
    return out;
  };
  const outlineItems = () => [...d.querySelectorAll('#mp-outline .outline-item')];

  const setMd = async (text, wait = 90) => {
    const el = d.getElementById('mp-input');
    el.value = text;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(wait);
  };
  const click = async (sel, wait = 60) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('编辑器预置了示例', d.getElementById('mp-input').value.includes('# 工具箱'));
  ok('预览已渲染出标题', $('#mp-preview h1') !== null);
  ok('预览已渲染出表格', $('#mp-preview table') !== null);
  ok('预览已渲染出代码块', $('#mp-preview pre') !== null);
  ok('统计面板 6 项', count(d, '#mp-stats .stat') === 6, String(count(d, '#mp-stats .stat')));

  /* ---------- 2. 渲染 ---------- */
  section('2. 渲染');
  await setMd('# 标题');
  ok('标题渲染为 h1', html().includes('<h1 id="mp-h-0">标题</h1>'), html());

  await setMd('**粗体** 与 *斜体*');
  ok('粗体与斜体', html().includes('<strong>粗体</strong>') && html().includes('<em>斜体</em>'), html());

  await setMd('| A | B |\n|---|---|\n| 1 | 2 |');
  ok('GFM 表格', html().includes('<table>'), html());

  await setMd('- [x] 完成\n- [ ] 未完成');
  ok('任务列表', html().includes('type="checkbox"'), html());

  await setMd('~~删除线~~');
  ok('删除线', html().includes('<del>删除线</del>'), html());

  await setMd('```js\nconst a = 1;\n```');
  ok('围栏代码块', html().includes('<pre>') && html().includes('<code'), html());

  /* breaks: true —— 与 Markdown 转 HTML 的关键差异 */
  await setMd('第一行\n第二行');
  ok('单个换行渲染成换行（breaks: true）',
     html().includes('<br>'), html());

  /* ---------- 3. 净化 ---------- */
  section('3. 净化');
  await setMd('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
  ok('script 被剥离', !html().includes('<script'), html());
  ok('事件处理器被剥离', !html().includes('onerror'), html());

  await setMd('<b>合法标签</b>');
  ok('合法内联 HTML 保留', html().includes('<b>合法标签</b>'), html());

  /* ---------- 4. 大纲 ---------- */
  section('4. 文档大纲');
  await setMd('# 一级\n\n## 二级 A\n\n### 三级\n\n## 二级 B');

  ok('大纲有 4 项', outlineItems().length === 4, String(outlineItems().length));
  ok('大纲计数徽章为 4', d.getElementById('mp-outline-count').textContent === '4',
     d.getElementById('mp-outline-count').textContent);
  ok('大纲文字正确',
     outlineItems().map((b) => b.textContent).join('|') === '一级|二级 A|三级|二级 B',
     outlineItems().map((b) => b.textContent).join('|'));
  ok('层级类名正确',
     outlineItems()[0].className.includes('outline-item--l1') &&
     outlineItems()[1].className.includes('outline-item--l2') &&
     outlineItems()[2].className.includes('outline-item--l3'),
     outlineItems().map((b) => b.className).join(' / '));
  ok('标题被补上 id 锚点',
     d.getElementById('mp-preview').querySelectorAll('h1[id],h2[id],h3[id]').length === 4);

  await setMd('没有标题的段落');
  ok('无标题时显示空状态', $('#mp-outline .outline-empty') !== null);
  ok('无标题时计数为 0', d.getElementById('mp-outline-count').textContent === '0');

  /* 大纲跳转 */
  await setMd('# 一\n\n' + '段落\n\n'.repeat(60) + '## 目标标题\n\n结尾');
  const target = [...d.querySelectorAll('#mp-preview h2')][0];
  ok('目标标题存在', !!target);
  d.getElementById('mp-preview').scrollTop = 0;
  const btn = outlineItems().find((b) => b.textContent === '目标标题');
  ok('大纲里能找到目标标题', !!btn);
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  /* jsdom 没有布局，scrollTop 不会真的变；这里只验证点击不报错且锚点存在 */
  ok('点击大纲不报错且锚点有效',
     d.getElementById(btn.getAttribute('data-target')) !== null &&
     d.getElementById(btn.getAttribute('data-target')).textContent === '目标标题');

  /* ---------- 5. 统计 ---------- */
  section('5. 统计');
  await setMd([
    '# 标题一',
    '',
    '## 标题二',
    '',
    '[链接](https://a.com)',
    '',
    '![图片](https://a.com/x.png)',
    '',
    '```js',
    'const a = 1;',
    '```'
  ].join('\n'));

  ok('标题数 2', stats()['标题'] === '2', stats()['标题']);
  ok('链接数 1', stats()['链接'] === '1', stats()['链接']);
  ok('图片数 1', stats()['图片'] === '1', stats()['图片']);
  ok('代码块数 1', stats()['代码块'] === '1', stats()['代码块']);
  ok('字符数与编辑器一致',
     stats()['字符数'] === d.getElementById('mp-input').value.length.toLocaleString('zh-CN'),
     stats()['字符数']);
  ok('阅读时长有值', stats()['阅读时长'] !== '—' && stats()['阅读时长'].length > 0,
     stats()['阅读时长']);

  await setMd('中'.repeat(800));
  ok('800 个汉字约 2 分钟', stats()['阅读时长'] === '2 分钟', stats()['阅读时长']);

  /* ---------- 6. 空状态 ---------- */
  section('6. 空状态');
  await setMd('');
  ok('空输入显示预览空状态', $('#mp-preview .md-empty') !== null);
  ok('空输入时大纲也是空状态', $('#mp-outline .outline-empty') !== null);
  ok('空输入时统计归零',
     stats()['标题'] === '0' && stats()['链接'] === '0' && stats()['阅读时长'] === '—',
     JSON.stringify(stats()));

  await setMd('   ');
  ok('只有空白也视为空', $('#mp-preview .md-empty') !== null);

  /* ---------- 7. 复制与下载 ---------- */
  section('7. 复制');
  await setMd('# 复制测试');
  copied = null;
  await click('#mp-copy-md');
  ok('复制的是 Markdown 源码', copied === '# 复制测试', JSON.stringify(copied));

  copied = null;
  await click('#mp-copy-html');
  ok('复制的是渲染后的语义 HTML',
     (copied || '').trim() === '<h1>复制测试</h1>', JSON.stringify(copied));
  ok('复制的内容不含工具生成的大纲锚点（避免带出去变成噪音）',
     !(copied || '').includes('id="mp-h-'), JSON.stringify(copied));
  ok('但预览 DOM 里确实有锚点供大纲跳转',
     $('#mp-preview h1').getAttribute('id') === 'mp-h-0',
     $('#mp-preview h1').getAttribute('id'));

  /* ---------- 8. 清空与恢复示例 ---------- */
  section('8. 清空与恢复示例');
  await setMd('随便写点');
  await click('#mp-reset');
  ok('恢复示例还原了预置内容',
     d.getElementById('mp-input').value.includes('# 工具箱'), '');
  ok('恢复示例后预览同步', $('#mp-preview h1') !== null);

  await click('#mp-clear');
  ok('清空后编辑器为空', d.getElementById('mp-input').value === '');
  ok('清空后预览回到空状态', $('#mp-preview .md-empty') !== null);
  ok('清空后移除草稿', w.localStorage.getItem('toolbox-md-preview') === null);

  /* ---------- 9. 草稿 ---------- */
  section('9. 草稿保存与恢复');
  await setMd('# 草稿内容', 700);
  ok('已写入 localStorage',
     w.localStorage.getItem('toolbox-md-preview') === '# 草稿内容',
     String(w.localStorage.getItem('toolbox-md-preview')));

  const restored = await loadPage('tools/markdown-preview/index.html', {
    storage: { 'toolbox-md-preview': '# 上次的草稿\n\n正文' }
  });
  ok('带草稿打开无脚本错误', restored.errors.length === 0, restored.errors.join(' | '));
  ok('草稿被恢复到编辑器',
     restored.d.getElementById('mp-input').value === '# 上次的草稿\n\n正文',
     restored.d.getElementById('mp-input').value);
  ok('恢复后立即完成渲染',
     restored.d.querySelector('#mp-preview h1') !== null &&
     restored.d.querySelector('#mp-preview h1').textContent === '上次的草稿',
     restored.d.getElementById('mp-preview').innerHTML.slice(0, 80));
  ok('恢复后大纲同步生成',
     restored.d.querySelectorAll('#mp-outline .outline-item').length === 1);

  /* ---------- 10. 存储不可用时的容错 ---------- */
  section('10. 存储被禁用时的容错');
  const blocked = await loadPage('tools/markdown-preview/index.html');
  /* 模拟隐私模式 / 禁用存储：localStorage 访问直接抛错 */
  Object.defineProperty(blocked.w, 'localStorage', {
    get() { throw new Error('SecurityError: storage disabled'); },
    configurable: true
  });
  let threw = false;
  try {
    /* 重新执行一遍工具脚本，看它能否在存储不可用时活下来 */
    const rel = 'tools/markdown-preview/index.html';
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { ROOT } = await import('./_harness.mjs');
    const code = fs.readFileSync(path.join(ROOT, 'js/tools/markdown-preview.js'), 'utf8');
    blocked.w.eval(code);
  } catch (e) {
    threw = true;
  }
  ok('localStorage 抛错时脚本不崩溃', !threw);
  ok('存储不可用时仍能渲染',
     blocked.d.getElementById('mp-preview').querySelector('h1') !== null ||
     blocked.d.getElementById('mp-preview').innerHTML.length > 0);

  /* ---------- 11. 页面结构 ---------- */
  section('11. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('页面注明了与「Markdown 转 HTML」的区别',
     d.querySelector('.tool-notes').textContent.includes('Markdown 转 HTML'));
  ok('页面注明了来源与两个库',
     d.querySelector('.tool-notes').textContent.includes('jamalofski/praticulus') &&
     d.querySelector('.tool-notes').textContent.includes('marked') &&
     d.querySelector('.tool-notes').textContent.includes('DOMPurify'));
  ok('页面说明了草稿存储键名',
     d.querySelector('.tool-notes').textContent.includes('toolbox-md-preview'));
}
