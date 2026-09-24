/* ==========================================================================
   随机字符串
   自研工具。测试重点：
     - 字符集构建（预设 / 自定义 / 去重 / 忽略空白 / 排除易混）
     - 生成结果必须落在字符集内，长度与条数受控
     - 熵值按真实取样方式算（首字符限定为字母时第一位单独计）
     - 非法数值输入标红 + 失焦回退
     - 复制单条与复制全部
   断言尽量用「结构性关系」（长度、字符归属、单调性）而不是硬编码随机值。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const AMBIGUOUS = '0OoIl1';

/* 与实现无关地算一遍预期字符集：去重 -> 去空白 -> 排除易混 */
const expected = (raw, excludeAmbiguous) => {
  const uniq = [...new Set([...raw].filter((c) => !/\s/.test(c)))];
  return excludeAmbiguous ? uniq.filter((c) => !AMBIGUOUS.includes(c)).join('') : uniq.join('');
};

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/random-string/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;

  const $ = (sel) => d.querySelector(sel);
  const charsetPreview = () => $('#rs-charset-preview').textContent;
  const charsetSize = () => $('#rs-charset-size').textContent;
  const rows = () => [...d.querySelectorAll('#rs-list .value-row')];
  const items = () => rows().map((r) => r.querySelector('.value-text').textContent);
  const stats = () => {
    const out = {};
    for (const s of d.querySelectorAll('#rs-stats .stat')) {
      out[s.querySelector('.stat-label').textContent] = {
        text: s.querySelector('.stat-value').textContent,
        cls: s.querySelector('.stat-value').className
      };
    }
    return out;
  };
  const status = () => $('#rs-status').textContent;

  const fire = async (el, type, wait = 170) => {
    el.dispatchEvent(new w.Event(type, { bubbles: true }));
    await sleep(wait);
  };
  const setVal = (el, v) => { el.value = v; return fire(el, 'input'); };
  const click = async (sel, wait = 170) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const preset = (id) => click('#rs-presets [data-preset="' + id + '"]');
  const setCustom = async (chars) => {
    await preset('custom');
    await setVal($('#rs-charset'), chars);
  };
  const setCount = (n) => setVal($('#rs-count'), String(n));
  const setLength = (n) => setVal($('#rs-length'), String(n));

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('六个字符集预设都渲染了', count(d, '#rs-presets .choice-chip') === 6,
     String(count(d, '#rs-presets .choice-chip')));
  ok('默认选中「大小写字母 + 数字」',
     $('#rs-presets [data-preset="alnum"]').getAttribute('aria-pressed') === 'true');
  ok('默认排除易混字符', $('#rs-exclude-ambiguous').checked);
  ok('自定义输入框默认隐藏', $('#rs-custom-wrap').hidden);
  ok('字符集 = 62 个字符去掉 6 个易混',
     charsetPreview() === expected(UPPER + LOWER + DIGITS, true),
     charsetPreview());
  ok('字符集大小显示 56', charsetSize() === '共 56 个字符', charsetSize());
  ok('首屏生成 10 条', rows().length === 10, String(rows().length));
  ok('每条 32 个字符', items().every((s) => s.length === 32),
     String([...new Set(items().map((s) => s.length))]));
  ok('四个统计格子',
     Object.keys(stats()).join(',') === '字符集大小,单串长度,单串熵值,本次生成',
     Object.keys(stats()).join(','));
  ok('单串熵值 = 32 × log₂(56)',
     stats()['单串熵值'].text === (32 * Math.log2(56)).toFixed(1) + ' 比特',
     stats()['单串熵值'].text);
  ok('185.8 比特判为安全档', stats()['单串熵值'].cls.includes('stat-value--ok'),
     stats()['单串熵值'].cls);
  ok('状态行给出条数、长度与熵', /已生成 10 条，每条 32 个字符/.test(status()), status());

  /* ---------- 2. 结果必须落在字符集内 ---------- */
  section('2. 生成结果与字符集一致');
  const cs = new Set([...charsetPreview()]);
  ok('所有字符都来自当前字符集', items().every((s) => [...s].every((c) => cs.has(c))));
  ok('10 条互不相同（32 字符 × 56 字符集）',
     new Set(items()).size === 10, String(new Set(items()).size));
  ok('每行都有独立的复制目标',
     rows().every((r, i) => r.getAttribute('data-copy-target') === '#rs-item-' + i));
  ok('序号标签从 #1 开始',
     rows()[0].querySelector('.value-label').textContent === '#1' &&
     rows()[9].querySelector('.value-label').textContent === '#10',
     rows()[0].querySelector('.value-label').textContent);

  /* ---------- 3. 预设字符集 ---------- */
  section('3. 预设字符集');
  await preset('hex');
  ok('十六进制：排除易混后 14 个',
     charsetPreview() === '23456789abcdef' && charsetSize() === '共 14 个字符',
     charsetPreview() + ' / ' + charsetSize());
  ok('结果只含 0-9a-f',
     items().every((s) => /^[0-9a-f]+$/.test(s)), items()[0]);

  await preset('lower');
  ok('小写字母 + 数字：排除易混后 32 个',
     charsetPreview() === expected(LOWER + DIGITS, true) && charsetSize() === '共 32 个字符',
     charsetPreview());

  await preset('b64url');
  ok('Base64 URL 安全：排除易混后 58 个',
     charsetPreview() === expected(UPPER + LOWER + DIGITS + '-_', true),
     charsetSize());
  ok('含 - 与 _，不含 + 与 /',
     charsetPreview().includes('-') && charsetPreview().includes('_') &&
     !charsetPreview().includes('+') && !charsetPreview().includes('/'));

  await preset('full');
  ok('全部可见字符：62 个字母数字 + 28 个符号，排除易混后 84 个',
     charsetSize() === '共 84 个字符', charsetSize());
  const mustEscape = ['"', "'", '`', '\\'];
  ok('符号里不含需要转义的引号与反斜杠',
     mustEscape.every((c) => !charsetPreview().includes(c)), charsetPreview());

  /* ---------- 4. 排除易混字符 ---------- */
  section('4. 排除易混字符');
  await preset('alnum');
  const ambiguous = [...AMBIGUOUS];
  ok('排除后字符集里没有易混字符',
     ambiguous.every((c) => !charsetPreview().includes(c)), charsetPreview());
  ok('结果里也没有易混字符',
     items().every((s) => ambiguous.every((c) => !s.includes(c))));

  $('#rs-exclude-ambiguous').checked = false;
  await fire($('#rs-exclude-ambiguous'), 'change');  ok('关掉后回到 62 个字符', charsetSize() === '共 62 个字符', charsetSize());
  ok('关掉后字符集含 O 与 0',
     charsetPreview().includes('O') && charsetPreview().includes('0'));

  $('#rs-exclude-ambiguous').checked = true;
  await fire($('#rs-exclude-ambiguous'), 'change');
  ok('重新勾上又回到 56 个', charsetSize() === '共 56 个字符', charsetSize());

  /* ---------- 5. 自定义字符集 ---------- */
  section('5. 自定义字符集');
  await preset('custom');
  ok('自定义模式下输入框显示', $('#rs-custom-wrap').hidden === false);

  await setVal($('#rs-charset'), 'aabbcc');
  ok('重复字符自动去重', charsetPreview() === 'abc' && charsetSize() === '共 3 个字符',
     charsetPreview());
  ok('生成结果只含 abc',
     items().every((s) => /^[abc]+$/.test(s)), items()[0]);

  await setVal($('#rs-charset'), 'a b\tc');
  ok('空白字符被忽略', charsetPreview() === 'abc', JSON.stringify(charsetPreview()));

  await setVal($('#rs-charset'), 'aA');
  ok('大小写视为不同字符', charsetPreview() === 'aA', charsetPreview());

  await setVal($('#rs-charset'), 'xyz-_.');
  ok('符号原样保留', charsetPreview() === 'xyz-_.', charsetPreview());

  await setVal($('#rs-charset'), '');
  ok('字符集为空时给出空状态', d.querySelector('#rs-list .code-empty') !== null);
  ok('字符集为空时状态行报错',
     status().includes('字符集为空') && $('#rs-status .is-error') !== null, status());
  ok('字符集为空时不残留结果行', rows().length === 0, String(rows().length));
  ok('字符集为空时大小显示（空）', charsetSize() === '（空）', charsetSize());

  await setVal($('#rs-charset'), AMBIGUOUS);
  ok('全是易混字符 + 排除易混 = 空', d.querySelector('#rs-list .code-empty') !== null);

  /* ---------- 6. 首字符必须是字母 ---------- */
  section('6. 首字符必须是字母');
  await preset('hex');
  const hexLetters = 'abcdef';
  $('#rs-first-letter').checked = true;
  await fire($('#rs-first-letter'), 'change');
  ok('十六进制下首字符都在 abcdef 里',
     items().every((s) => hexLetters.includes(s[0])), items()[0]);
  ok('其余位仍可含数字',
     items().some((s) => /[2-9]/.test(s.slice(1))), items()[0]);
  ok('熵值按「首位取字母」重算 = log₂(6) + 31 × log₂(14)',
     stats()['单串熵值'].text === (Math.log2(6) + 31 * Math.log2(14)).toFixed(1) + ' 比特',
     stats()['单串熵值'].text);
  ok('120.6 比特判为警戒档', stats()['单串熵值'].cls.includes('stat-value--warn'),
     stats()['单串熵值'].cls);

  await setCustom('0123456789');
  ok('纯数字字符集没有字母', charsetPreview() === '23456789', charsetPreview());
  ok('无字母时状态行给出提示',
     status().includes('首字符限定不生效') && $('#rs-status .is-warn') !== null, status());
  ok('无字母时结果仍是纯数字', items().every((s) => /^[0-9]+$/.test(s)), items()[0]);

  $('#rs-first-letter').checked = false;
  await fire($('#rs-first-letter'), 'change');
  ok('关掉后不再提示', !status().includes('首字符限定不生效'), status());

  /* ---------- 7. 长度与数量 ---------- */
  section('7. 长度与数量');
  await preset('alnum');
  await setCount(5);
  ok('数量 5 -> 5 行', rows().length === 5, String(rows().length));

  await setLength(1);
  ok('长度 1 -> 每条 1 个字符', items().every((s) => s.length === 1), items().join(','));
  ok('长度 1 时熵 = log₂(56)',
     stats()['单串熵值'].text === Math.log2(56).toFixed(1) + ' 比特',
     stats()['单串熵值'].text);

  await setLength(128);
  ok('长度 128 -> 每条 128 个字符', items().every((s) => s.length === 128));

  await setCount(200);
  ok('数量 200 -> 200 行', rows().length === 200, String(rows().length));
  ok('200 条互不相同', new Set(items()).size === 200, String(new Set(items()).size));

  await setCount(10);
  await setLength(32);

  /* 快捷长度胶囊 */
  await click('#rs-length-chips [data-length="64"]');
  ok('点胶囊后长度输入同步为 64', $('#rs-length').value === '64', $('#rs-length').value);
  ok('点胶囊后每条 64 个字符', items().every((s) => s.length === 64));
  ok('该胶囊标记为选中',
     $('#rs-length-chips [data-length="64"]').getAttribute('aria-pressed') === 'true');
  ok('其他胶囊未选中',
     $('#rs-length-chips [data-length="32"]').getAttribute('aria-pressed') === 'false');

  await setLength(33);
  ok('非预设长度时没有胶囊被选中',
     [...d.querySelectorAll('#rs-length-chips .choice-chip')]
       .every((c) => c.getAttribute('aria-pressed') === 'false'));

  /* ---------- 8. 非法数值输入 ---------- */
  section('8. 非法数值输入');
  await setLength(600);
  ok('超上限标红', $('#rs-length').classList.contains('input--invalid'));
  ok('超上限时按上限渲染', items().every((s) => s.length === 512),
     String(items()[0].length));
  await fire($('#rs-length'), 'blur');
  ok('失焦后回退为 512', $('#rs-length').value === '512', $('#rs-length').value);
  ok('失焦后清掉标红', !$('#rs-length').classList.contains('input--invalid'));

  await setLength(0);
  ok('小于下限标红', $('#rs-length').classList.contains('input--invalid'));
  ok('小于下限时按 1 渲染', items().every((s) => s.length === 1));
  await fire($('#rs-length'), 'blur');
  ok('失焦后回退为 1', $('#rs-length').value === '1', $('#rs-length').value);

  await setLength('');
  ok('空值时标红', $('#rs-length').classList.contains('input--invalid'));
  await fire($('#rs-length'), 'blur');
  ok('空值失焦后回退为 1', $('#rs-length').value === '1', $('#rs-length').value);

  await setLength('3.5');
  ok('小数标红', $('#rs-length').classList.contains('input--invalid'));
  await fire($('#rs-length'), 'blur');
  ok('小数失焦后取整为 4', $('#rs-length').value === '4', $('#rs-length').value);

  await setCount(0);
  ok('数量小于下限标红', $('#rs-count').classList.contains('input--invalid'));
  ok('数量非法时按 1 渲染', rows().length === 1, String(rows().length));
  await fire($('#rs-count'), 'blur');
  ok('数量失焦后回退为 1', $('#rs-count').value === '1', $('#rs-count').value);

  await setCount(500);
  ok('数量超上限标红', $('#rs-count').classList.contains('input--invalid'));
  ok('数量超上限时按 200 渲染', rows().length === 200, String(rows().length));
  await fire($('#rs-count'), 'blur');
  ok('数量失焦后回退为 200', $('#rs-count').value === '200', $('#rs-count').value);

  /* ---------- 9. 熵值档位 ---------- */
  section('9. 熵值档位');
  await setCount(3);
  await preset('hex');
  await setLength(4);
  ok('十六进制 4 位 = 15.2 比特，判为危险档',
     stats()['单串熵值'].text === (4 * Math.log2(14)).toFixed(1) + ' 比特' &&
     stats()['单串熵值'].cls.includes('stat-value--danger'),
     stats()['单串熵值'].text + ' / ' + stats()['单串熵值'].cls);

  await setLength(32);
  ok('十六进制 32 位 = 121.8 比特，判为警戒档',
     stats()['单串熵值'].cls.includes('stat-value--warn'),
     stats()['单串熵值'].cls);

  await setLength(64);
  ok('十六进制 64 位 = 243.6 比特，判为安全档',
     stats()['单串熵值'].cls.includes('stat-value--ok'),
     stats()['单串熵值'].cls);

  /* 同一字符集下熵与长度成正比 */
  const bitsAt = async (len) => { await setLength(len); return parseFloat(stats()['单串熵值'].text); };
  const b1 = await bitsAt(10);
  const b2 = await bitsAt(20);
  ok('同字符集下长度翻倍、熵也翻倍',
     Math.abs(b2 - b1 * 2) < 0.15, `${b1} -> ${b2}`);

  /* ---------- 10. 字符覆盖与分布 ---------- */
  section('10. 字符覆盖');
  await preset('hex');
  await setLength(16);
  await setCount(200);
  const all = items().join('');
  ok('200 条共 3200 个字符', all.length === 3200, String(all.length));
  ok('字符集里每个字符都出现过',
     [...charsetPreview()].every((c) => all.includes(c)),
     [...charsetPreview()].filter((c) => !all.includes(c)).join(''));
  const freq = {};
  for (const c of all) freq[c] = (freq[c] || 0) + 1;
  const counts = Object.values(freq);
  const avg = 3200 / counts.length;
  ok('各字符出现次数都在均值的 1/3 ~ 3 倍之间（无明显偏向）',
     counts.every((n) => n > avg / 3 && n < avg * 3),
     `avg=${avg.toFixed(1)} min=${Math.min(...counts)} max=${Math.max(...counts)}`);

  /* ---------- 11. 复制 ---------- */
  section('11. 复制');
  await preset('alnum');
  await setLength(16);
  await setCount(5);
  const list = items();
  copied = null;
  await click('#rs-list .value-row:nth-child(3)');
  ok('点第 3 行复制的是第 3 条', copied === list[2], JSON.stringify(copied));
  ok('复制后该行标记为已复制',
     rows()[2].getAttribute('data-copied') === 'true');

  copied = null;
  await click('#rs-copy-all');
  ok('复制全部 = 各行按换行拼接', copied === list.join('\n'), JSON.stringify(copied));
  ok('复制全部共 5 行', (copied || '').split('\n').length === 5);

  /* ---------- 12. 重新生成 ---------- */
  section('12. 重新生成');
  const before = items();
  await click('#rs-regenerate');
  const after = items();
  ok('重新生成后内容变化', before.join('|') !== after.join('|'));
  ok('重新生成后条数与长度不变',
     after.length === before.length && after.every((s) => s.length === 16));
  ok('重新生成后仍在字符集内',
     after.every((s) => [...s].every((c) => new Set([...charsetPreview()]).has(c))));

  /* ---------- 13. 页面结构 ---------- */
  section('13. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为生成器的琥珀色',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#d97706',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('说明区讲清了随机源',
     d.querySelector('.tool-notes').textContent.includes('crypto.getRandomValues'));
  ok('说明区给出了熵值口径',
     [...d.querySelectorAll('.panel-foot')].some((el) => el.textContent.includes('log₂')));
  ok('说明区解释了模偏差',
     d.querySelector('.tool-notes').textContent.includes('模偏差'));
}
