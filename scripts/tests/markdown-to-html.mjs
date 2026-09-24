/* ==========================================================================
   Markdown 转 HTML
   移植自 Praticulus 的 markdown-to-html。这里验证转换正确性、净化、
   移除 Prism 后自带的 HTML 着色，以及草稿的存取。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/markdown-to-html/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;

  const $ = (sel) => d.querySelector(sel);
  const html = () => d.getElementById('md-html-text').textContent;
  /* marked v18 会在块级输出末尾补一个换行，比较时统一去掉 */
  const htmlTrim = () => html().trim();
  const status = () => d.getElementById('md-status').textContent.trim();
  const badge = () => d.getElementById('md-badge').textContent;
  const stats = () => {
    const out = {};
    for (const s of d.querySelectorAll('#md-stats .stat')) {
      out[s.querySelector('.stat-label').textContent] = s.querySelector('.stat-value').textContent;
    }
    return out;
  };
  const codeLines = () => [...d.querySelectorAll('#md-code .code-line-body')];

  const setMd = async (text, wait = 200) => {
    const el = d.getElementById('md-input');
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
  ok('编辑器预置了示例', d.getElementById('md-input').value.includes('# 工具箱'));
  ok('已生成 HTML', $('#md-status .is-ok') !== null, status());
  ok('徽章为语义 HTML', badge() === '语义 HTML', badge());
  ok('代码视图有内容', codeLines().length > 0, String(codeLines().length));
  ok('统计面板 6 项', count(d, '#md-stats .stat') === 6, String(count(d, '#md-stats .stat')));

  /* ---------- 2. 转换正确性 ---------- */
  section('2. 转换正确性');

  await setMd('# 标题');
  ok('标题转成 h1', htmlTrim() === '<h1>标题</h1>', JSON.stringify(html()));

  await setMd('这是 **粗体** 与 *斜体*。');
  ok('粗体转成 strong', html().includes('<strong>粗体</strong>'), html());
  ok('斜体转成 em', html().includes('<em>斜体</em>'), html());

  await setMd('[链接](https://example.com)');
  ok('链接转成 a[href]',
     htmlTrim() === '<p><a href="https://example.com">链接</a></p>', JSON.stringify(html()));

  await setMd('| 列 A | 列 B |\n|------|------|\n| 1 | 2 |');
  ok('GFM 表格转成 table', html().includes('<table>') && html().includes('<th>'), html());

  await setMd('- [x] 已完成\n- [ ] 未完成');
  ok('任务列表转成 checkbox',
     html().includes('type="checkbox"') && html().includes('checked'), html());

  await setMd('~~删除线~~');
  ok('删除线转成 del', html().includes('<del>删除线</del>'), html());

  await setMd('```js\nconst a = 1;\n```');
  ok('围栏代码块转成 pre > code',
     html().includes('<pre>') && html().includes('<code'), html());

  await setMd('> 引用内容');
  ok('引用转成 blockquote', html().includes('<blockquote>'), html());

  await setMd('行内 `code` 片段');
  ok('行内代码转成 code', html().includes('<code>code</code>'), html());

  /* ---------- 3. 净化 ---------- */
  section('3. 净化');
  await setMd('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[危险](javascript:alert(1))');
  ok('script 标签被剥离', !html().includes('<script'), html());
  ok('事件处理器被剥离', !html().includes('onerror'), html());
  ok('javascript: 链接被剥离', !html().includes('javascript:'), html());

  await setMd('<b>保留的合法标签</b>');
  ok('合法内联 HTML 被保留', html().includes('<b>保留的合法标签</b>'), html());

  /* ---------- 4. HTML 着色（替代 Prism） ---------- */
  section('4. HTML 代码着色');
  await setMd('# 标题\n\n[链接](https://example.com)');
  ok('标签名着色', count(d, '#md-code .tok-tag') > 0, String(count(d, '#md-code .tok-tag')));
  ok('属性名着色', count(d, '#md-code .tok-attr') > 0, String(count(d, '#md-code .tok-attr')));
  ok('属性值着色', count(d, '#md-code .tok-str') > 0, String(count(d, '#md-code .tok-str')));

  const tagTexts = [...d.querySelectorAll('#md-code .tok-tag')].map((x) => x.textContent);
  ok('标签名列表正确',
     tagTexts.includes('h1') && tagTexts.includes('a') && tagTexts.includes('p'),
     JSON.stringify(tagTexts));
  const attrTexts = [...d.querySelectorAll('#md-code .tok-attr')].map((x) => x.textContent);
  ok('属性名列表正确', attrTexts.includes('href'), JSON.stringify(attrTexts));
  const strTexts = [...d.querySelectorAll('#md-code .tok-str')].map((x) => x.textContent);
  ok('属性值保留引号', strTexts.includes('"https://example.com"'), JSON.stringify(strTexts));
  ok('尖括号未被当成标签', !tagTexts.some((t) => t.includes('<')), JSON.stringify(tagTexts.slice(0, 4)));

  ok('每行都有行号',
     count(d, '#md-code .code-line-num') === codeLines().length,
     `${count(d, '#md-code .code-line-num')} / ${codeLines().length}`);

  await setMd('<!-- 注释 -->\n\n# 标题');
  ok('HTML 注释被剥离（marked 与 DOMPurify 都会去掉）',
     !html().includes('<!--') && htmlTrim() === '<h1>标题</h1>', JSON.stringify(html()));

  /* ---------- 5. 视图切换 ---------- */
  section('5. 代码 / 预览视图');
  await setMd('# 标题\n\n[链接](https://example.com)');
  ok('默认显示代码视图',
     d.getElementById('md-code').hidden === false && d.getElementById('md-preview').hidden === true);
  ok('代码按钮处于选中态', d.getElementById('md-tab-code').getAttribute('aria-pressed') === 'true');

  await click('#md-tab-preview');
  ok('切到预览后代码区隐藏', d.getElementById('md-code').hidden === true);
  ok('预览区显示', d.getElementById('md-preview').hidden === false);
  ok('预览按钮处于选中态', d.getElementById('md-tab-preview').getAttribute('aria-pressed') === 'true');
  ok('预览渲染出真实元素',
     d.querySelector('#md-preview h1') !== null && d.querySelector('#md-preview a') !== null);

  await click('#md-tab-code');
  ok('可切回代码视图', d.getElementById('md-code').hidden === false);

  /* ---------- 6. Tailwind 选项 ---------- */
  section('6. Tailwind 工具类');
  await setMd('# 标题\n\n- 项目一\n- 项目二');
  ok('默认输出不含工具类', !html().includes('text-3xl'), html());

  const tw = d.getElementById('md-tailwind');
  tw.checked = true;
  tw.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(60);
  ok('勾选后补上 h1 工具类', html().includes('class="text-3xl font-bold mb-4"'), html());
  ok('勾选后补上列表工具类', html().includes('list-disc pl-6 mb-4'), html());
  ok('徽章变为含 Tailwind 类', badge() === '含 Tailwind 类', badge());

  await click('#md-tab-preview');
  ok('预览始终使用语义版本（不含工具类）',
     d.getElementById('md-preview').innerHTML.includes('<h1>') &&
     !d.getElementById('md-preview').innerHTML.includes('text-3xl'),
     d.getElementById('md-preview').innerHTML);
  await click('#md-tab-code');

  tw.checked = false;
  tw.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(60);
  ok('取消勾选后恢复语义 HTML', !html().includes('text-3xl'), html());

  /* ---------- 7. 统计 ---------- */
  section('7. 输出统计');
  await setMd([
    '# 一级标题',
    '## 二级标题',
    '',
    '[链接一](https://a.com) 与 [链接二](https://b.com)',
    '',
    '```js',
    'const a = 1;',
    '```',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |'
  ].join('\n'));

  ok('标题数 2', stats()['标题'] === '2', stats()['标题']);
  ok('链接数 2', stats()['链接'] === '2', stats()['链接']);
  ok('代码块数 1', stats()['代码块'] === '1', stats()['代码块']);
  ok('表格数 1', stats()['表格'] === '1', stats()['表格']);
  ok('输入字符数与编辑器一致',
     stats()['输入字符'] === d.getElementById('md-input').value.length.toLocaleString('zh-CN'),
     stats()['输入字符']);
  ok('HTML 字符数与输出一致',
     stats()['HTML 字符'] === html().length.toLocaleString('zh-CN'), stats()['HTML 字符']);

  /* ---------- 8. 复制 ---------- */
  section('8. 复制 HTML');
  await setMd('# 复制测试');
  copied = null;
  await click('[data-copy-target="#md-html-text"]');
  ok('复制的是生成的 HTML', (copied || '').trim() === '<h1>复制测试</h1>', JSON.stringify(copied));

  /* ---------- 9. 草稿 ---------- */
  section('9. 草稿保存与恢复');
  await setMd('# 草稿内容', 600);
  ok('已写入 localStorage',
     w.localStorage.getItem('toolbox-md2html') === '# 草稿内容',
     String(w.localStorage.getItem('toolbox-md2html')));

  const restored = await loadPage('tools/markdown-to-html/index.html', {
    storage: { 'toolbox-md2html': '# 上次留下的草稿' }
  });
  ok('带草稿打开无脚本错误', restored.errors.length === 0, restored.errors.join(' | '));
  ok('草稿被恢复到编辑器',
     restored.d.getElementById('md-input').value === '# 上次留下的草稿',
     restored.d.getElementById('md-input').value);
  ok('恢复后立即完成转换',
     restored.d.getElementById('md-html-text').textContent.trim() === '<h1>上次留下的草稿</h1>',
     restored.d.getElementById('md-html-text').textContent);

  /* ---------- 10. 按钮 ---------- */
  section('10. 载入示例 / 清空');
  await setMd('随便写点');
  await click('[data-demo]');
  ok('载入示例恢复完整示例', d.getElementById('md-input').value.includes('# 工具箱'), '');
  ok('示例包含表格', html().includes('<table>'), html().slice(0, 80));
  ok('示例包含任务列表', html().includes('type="checkbox"'), '');

  await click('[data-clear]');
  ok('清空后编辑器为空', d.getElementById('md-input').value === '');
  ok('清空后显示空状态', $('#md-code .code-empty') !== null);
  ok('清空后徽章重置', badge() === '—', badge());
  ok('清空后状态行清空', status() === '', JSON.stringify(status()));
  ok('清空后移除草稿', w.localStorage.getItem('toolbox-md2html') === null);

  /* ---------- 11. 边界 ---------- */
  section('11. 边界情况');
  await setMd('   ');
  ok('只有空白时视为空', $('#md-code .code-empty') !== null);

  await setMd('纯文本没有标记');
  ok('纯文本包成段落', htmlTrim() === '<p>纯文本没有标记</p>', JSON.stringify(html()));

  await setMd('中文标题与 emoji 🎉');
  ok('emoji 未被拆坏', html().includes('🎉'), html());

  await setMd('```\n<script>alert(1)</script>\n```');
  ok('代码块内的内容被转义',
     html().includes('&lt;script&gt;') && !html().includes('<script>'), html());

  /* ---------- 12. 页面结构 ---------- */
  section('12. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('页面注明了来源与两个库',
     d.querySelector('.tool-notes').textContent.includes('jamalofski/praticulus') &&
     d.querySelector('.tool-notes').textContent.includes('marked') &&
     d.querySelector('.tool-notes').textContent.includes('DOMPurify'));
  ok('页面说明了草稿存储', d.querySelector('.tool-notes').textContent.includes('toolbox-md2html'));
}
