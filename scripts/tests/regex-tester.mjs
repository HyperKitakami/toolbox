/* ==========================================================================
   正则表达式测试
   移植自 Praticulus 的 regex-tester，这里重点验证中文化后的行为，
   以及移植时修掉的两个上游缺陷（空匹配死循环、分享链接 base64 填充丢参）。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/regex-tester/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;

  const $ = (sel) => d.querySelector(sel);
  const status = () => d.getElementById('rt-status').textContent.trim();
  const stats = () => {
    const out = {};
    for (const s of d.querySelectorAll('#rt-stats .stat')) {
      out[s.querySelector('.stat-label').textContent] = s.querySelector('.stat-value').textContent;
    }
    return out;
  };
  const marks = () => [...d.querySelectorAll('#rt-highlight mark')].map((m) => m.textContent);

  const setInputs = async (pattern, flags, text) => {
    const p = d.getElementById('rt-pattern');
    const f = d.getElementById('rt-flags');
    const t = d.getElementById('rt-text');
    if (pattern !== undefined) { p.value = pattern; p.dispatchEvent(new w.Event('input', { bubbles: true })); }
    if (flags !== undefined) { f.value = flags; f.dispatchEvent(new w.Event('input', { bubbles: true })); }
    if (text !== undefined) { t.value = text; t.dispatchEvent(new w.Event('input', { bubbles: true })); }
    await sleep(230);
  };
  const click = async (sel) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(230);
  };

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('预置示例已经算出结果', status().includes('匹配到 2 处'), status());
  ok('高亮出 2 处命中', marks().length === 2, JSON.stringify(marks()));
  ok('命中内容是两个邮箱',
     marks()[0] === 'zhang@example.com' && marks()[1] === 'li.si@company.org.cn',
     JSON.stringify(marks()));
  ok('统计面板 5 项', count(d, '#rt-stats .stat') === 5);
  ok('统计：匹配数 2', stats()['匹配数'] === '2', JSON.stringify(stats()));
  ok('统计：标志为 g', stats()['标志'] === 'g', stats()['标志']);
  ok('模式解释已渲染', count(d, '#rt-explainer .regex-explainer-row') > 0);
  ok('匹配详情已渲染', count(d, '#rt-matches .match-item') === 2);

  /* ---------- 2. 标志快捷开关 ---------- */
  section('2. 标志快捷开关');
  ok('渲染了 6 个标志开关', count(d, '#rt-flag-chips .flag-chip') === 6,
     String(count(d, '#rt-flag-chips .flag-chip')));
  ok('g 处于按下状态',
     $('#rt-flag-chips .flag-chip[data-flag="g"]').getAttribute('aria-pressed') === 'true');
  ok('i 未按下',
     $('#rt-flag-chips .flag-chip[data-flag="i"]').getAttribute('aria-pressed') === 'false');

  await click('#rt-flag-chips .flag-chip[data-flag="i"]');
  ok('点 i 后标志变为 gi', d.getElementById('rt-flags').value.split('').sort().join('') === 'gi',
     d.getElementById('rt-flags').value);
  ok('点 i 后开关按下',
     $('#rt-flag-chips .flag-chip[data-flag="i"]').getAttribute('aria-pressed') === 'true');

  /* 只改表达式与文本，不动标志，验证 i 生效 */
  await setInputs('[a-z]+@EXAMPLE\\.COM', undefined, 'zhang@example.com');
  ok('i 标志生效（忽略大小写）', status().includes('匹配到 1 处'), status());

  await click('#rt-flag-chips .flag-chip[data-flag="i"]');
  ok('再点 i 取消标志', d.getElementById('rt-flags').value === 'g',
     d.getElementById('rt-flags').value);
  ok('取消后不再匹配', status().includes('没有匹配'), status());

  /* ---------- 3. 非全局与全局 ---------- */
  section('3. 全局 / 非全局');
  await setInputs('\\d+', 'g', 'a1b22c333');
  ok('全局匹配到 3 处', status().includes('匹配到 3 处'), status());
  await setInputs('\\d+', '', 'a1b22c333');
  ok('去掉 g 后只匹配 1 处', status().includes('匹配到 1 处'), status());
  ok('统计：捕获分组 0', stats()['捕获分组'] === '0', stats()['捕获分组']);

  /* ---------- 4. 零长匹配（上游缺陷回归） ---------- */
  section('4. 空匹配不再死循环');
  await setInputs('a*', 'g', 'bbb');
  ok('a* 在 bbb 上得到 4 处空匹配（而非 1001 条）',
     stats()['匹配数'] === '4', stats()['匹配数']);
  await setInputs('(?:)', 'g', 'abc');
  ok('空表达式得到 4 处（长度 + 1），未触发上限',
     stats()['匹配数'] === '4', stats()['匹配数']);
  await setInputs('x*', 'g', '');
  ok('空文本不报错', !status().includes('有误'), status());

  /* ---------- 5. 捕获分组与命名分组 ---------- */
  section('5. 捕获分组与命名分组');
  await setInputs('(\\w+)@(\\w+)', 'g', 'a@b c@d');
  ok('捕获分组 2 个', stats()['捕获分组'] === '2', stats()['捕获分组']);
  const groups = [...d.querySelectorAll('#rt-matches .match-group')].map((g) => g.textContent);
  ok('详情里列出 $1 / $2',
     groups.includes('$1 = a') && groups.includes('$2 = b'), JSON.stringify(groups));

  await setInputs('(?<user>\\w+)@(?<host>\\w+)', 'g', 'a@b');
  ok('命名分组 2 个', stats()['命名分组'] === '2', stats()['命名分组']);
  const named = [...d.querySelectorAll('#rt-matches .match-group')].map((g) => g.textContent);
  ok('详情里列出命名分组',
     named.includes('user = a') && named.includes('host = b'), JSON.stringify(named));

  /* ---------- 6. 位置信息 ---------- */
  section('6. 位置信息');
  await setInputs('\\d+', 'g', 'ab123');
  ok('位置显示为索引区间',
     $('#rt-matches .match-pos').textContent.includes('位置 2 – 5'),
     $('#rt-matches .match-pos').textContent);

  /* ---------- 7. 非法表达式 ---------- */
  section('7. 非法表达式');
  await setInputs('[', 'g', 'abc');
  ok('状态栏报错', $('#rt-status .is-error') !== null, status());
  ok('报错文案是中文前缀', status().startsWith('表达式有误'), status());
  ok('报错时不显示匹配详情', count(d, '#rt-matches .match-item') === 0);
  ok('报错时匹配数归零', stats()['匹配数'] === '0', stats()['匹配数']);

  await setInputs('', 'g', 'abc');
  ok('空表达式提示未输入', status().includes('还没有输入'), status());
  ok('空表达式时原样显示文本',
     d.getElementById('rt-highlight').textContent === 'abc');

  /* ---------- 8. 模式解释 ---------- */
  section('8. 模式解释');
  await setInputs('\\d+', 'g', 'x');
  const rows = [...d.querySelectorAll('#rt-explainer .regex-explainer-row')];
  ok('拆出 2 个记号', rows.length === 2, String(rows.length));
  ok('第一段解释为「任意数字」', rows[0].textContent.includes('任意数字'), rows[0].textContent);
  ok('第二段解释为量词', rows[1].textContent.includes('量词'), rows[1].textContent);
  ok('量词说明为中文',
     rows[1].textContent.includes('1 次或多次'), rows[1].textContent);

  await setInputs('(?:ab)+', 'g', 'x');
  ok('非捕获分组有中文说明',
     d.getElementById('rt-explainer').textContent.includes('非捕获分组'),
     d.getElementById('rt-explainer').textContent);
  ok('出现嵌套层级缩进类',
     d.querySelector('#rt-explainer .regex-explainer-row.depth-1') !== null);

  await setInputs('a(?=b)', 'g', 'x');
  ok('先行断言有中文说明',
     d.getElementById('rt-explainer').textContent.includes('正向先行断言'),
     d.getElementById('rt-explainer').textContent);

  await setInputs('*abc', 'g', 'x');
  ok('无法识别的记号有中文提示',
     d.getElementById('rt-explainer').textContent.includes('无法识别的记号'),
     d.getElementById('rt-explainer').textContent);

  /* ---------- 9. 替换 ---------- */
  section('9. 替换模式');
  await setInputs('\\d+', 'g', 'a1b22');
  ok('替换区默认隐藏', d.getElementById('rt-replace-section').hidden === true);

  const toggle = d.getElementById('rt-replace-toggle');
  toggle.checked = true;
  toggle.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(30);
  ok('启用后替换区显示', d.getElementById('rt-replace-section').hidden === false);

  const repl = d.getElementById('rt-replacement');
  repl.value = '<$&>';
  repl.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(180);
  ok('$& 替换生效', d.getElementById('rt-replace-output').textContent === 'a<1>b<22>',
     d.getElementById('rt-replace-output').textContent);

  repl.value = '[$1]';
  repl.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(180);
  /* JS 规范：正则里没有第 1 个分组时，$1 保持字面量而不是替换成空 */
  ok('无分组时 $1 保持字面量（JS 规范行为）',
     d.getElementById('rt-replace-output').textContent === 'a[$1]b[$1]',
     d.getElementById('rt-replace-output').textContent);

  await setInputs('(\\d)(\\d)', 'g', 'a12b34');
  repl.value = '$2$1';
  repl.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(180);
  ok('分组引用可交换顺序',
     d.getElementById('rt-replace-output').textContent === 'a21b43',
     d.getElementById('rt-replace-output').textContent);

  /* ---------- 10. 分享链接（上游缺陷回归） ---------- */
  section('10. 分享链接');
  // 关键：pattern 用 'ab'，其 base64 为 'YWI='，带 = 填充
  await setInputs('ab', 'gi', 'abAB');
  copied = null;
  await click('#rt-share');
  ok('分享链接已写入剪贴板', typeof copied === 'string' && copied.length > 0);

  const hash = (copied || '').slice((copied || '').indexOf('#'));
  ok('链接带 #p= 参数', hash.startsWith('#p='), hash);
  ok('链接里确实含 base64 填充符 =', decodeURIComponent(hash).includes('%3D') || hash.includes('='),
     hash);
  ok('出现「已复制」提示', d.querySelector('.toast') !== null);

  const restored = await loadPage('tools/regex-tester/index.html', {
    url: 'http://localhost:8080/tools/regex-tester/' + hash
  });
  ok('带 hash 打开无脚本错误', restored.errors.length === 0, restored.errors.join(' | '));
  ok('表达式从链接恢复（含 = 填充也不丢）',
     restored.d.getElementById('rt-pattern').value === 'ab',
     restored.d.getElementById('rt-pattern').value);
  ok('标志从链接恢复', restored.d.getElementById('rt-flags').value === 'gi',
     restored.d.getElementById('rt-flags').value);
  ok('测试文本从链接恢复', restored.d.getElementById('rt-text').value === 'abAB',
     restored.d.getElementById('rt-text').value);
  ok('恢复后立即算出结果',
     restored.d.getElementById('rt-status').textContent.includes('匹配到 2 处'),
     restored.d.getElementById('rt-status').textContent.trim());

  /* ---------- 11. 按钮 ---------- */
  section('11. 载入示例 / 清空');
  await setInputs('zzz', 'g', 'nothing');
  await click('[data-demo]');
  ok('载入示例恢复邮箱表达式',
     d.getElementById('rt-pattern').value.includes('@') &&
     d.getElementById('rt-text').value.includes('zhang@example.com'),
     d.getElementById('rt-pattern').value);
  ok('示例匹配到 2 处', status().includes('匹配到 2 处'), status());

  await click('[data-clear]');
  ok('清空测试文本后无匹配', d.getElementById('rt-text').value === '' &&
     status().includes('没有匹配'), status());

  /* ---------- 12. 页面结构 ---------- */
  section('12. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为开发者蓝',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#2f6bff',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('语法速查含 4 组', count(d, '.regex-ref-group') === 4,
     String(count(d, '.regex-ref-group')));
  ok('页面注明了来源与许可',
     d.querySelector('.tool-notes').textContent.includes('jamalofski/praticulus') &&
     d.querySelector('.tool-notes').textContent.includes('MIT'));
}
