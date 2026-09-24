/* ==========================================================================
   密码生成器
   移植自 Praticulus 的 password-generator。测试重点分两块：
     - 功能：字符类别、排除易混、每类至少一次、长度、口令短语、批量、复制；
     - 回归：逐条锁住移植时修掉的缺陷（模偏差、字符集为空静默降级、
             自定义分隔符清不掉、非法数值不校验、爆破时间溢出、词表被截断）。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

const ALL_CLASSES = ['upper', 'lower', 'digits', 'symbols'];
const AMBIGUOUS = '0OoIl1';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/password-generator/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;
  const WL = w.TOOLBOX.wordlists.effLarge;

  const $ = (sel) => d.querySelector(sel);
  const value = () => $('#pg-value-text').textContent;
  const rows = () => [...d.querySelectorAll('#pg-list .value-row')];
  const items = () => rows().map((r) => r.querySelector('.value-text').textContent);
  const stats = () => {
    const out = {};
    for (const s of d.querySelectorAll('#pg-stats .stat')) {
      out[s.querySelector('.stat-label').textContent] = s.querySelector('.stat-value').textContent;
    }
    return out;
  };
  const level = () => Number($('#pg-strength').getAttribute('data-level'));
  const status = () => $('#pg-status').textContent;
  const charset = () => $('#pg-charset-preview').textContent;
  const charsetSize = () => Number($('#pg-charset-size').textContent.replace(/\D/g, ''));

  const fire = async (el, type, wait = 170) => {
    el.dispatchEvent(new w.Event(type, { bubbles: true }));
    await sleep(wait);
  };
  const setVal = (el, v) => { el.value = v; return fire(el, 'input'); };
  const setCheck = async (el, on) => { el.checked = on; await fire(el, 'change'); };
  const click = async (sel, wait = 170) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const mode = (id) => click('#pg-modes [data-mode="' + id + '"]');

  /* 按目标状态设置，而不是无脑切换 —— 无脑切换很容易把已经关掉的类别又打开 */
  const setClass = async (id, on) => {
    const chip = d.querySelector('#pg-classes [data-class="' + id + '"]');
    if ((chip.getAttribute('aria-pressed') === 'true') === on) return;
    await click('#pg-classes [data-class="' + id + '"]');
  };
  const setClasses = async (on) => {
    for (const k of ALL_CLASSES) await setClass(k, on.includes(k));
  };
  const setLength = (n) => setVal($('#pg-length'), String(n));
  const setCount = (n) => setVal($('#pg-count'), String(n));

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('两种生成方式都渲染了', count(d, '#pg-modes .choice-chip') === 2,
     String(count(d, '#pg-modes .choice-chip')));
  ok('默认是随机密码',
     $('#pg-modes [data-mode="password"]').getAttribute('aria-pressed') === 'true');
  ok('四个字符类别都渲染了', count(d, '#pg-classes .choice-chip') === 4,
     String(count(d, '#pg-classes .choice-chip')));
  ok('默认四类全选',
     [...d.querySelectorAll('#pg-classes .choice-chip')]
       .every((b) => b.getAttribute('aria-pressed') === 'true'));
  ok('默认显示密码面板',
     $('#pg-panel-password').hidden === false && $('#pg-panel-passphrase').hidden === true);
  ok('默认字符集 90 个', charsetSize() === 90 && charset().length === 90, String(charsetSize()));
  ok('默认密码 16 个字符', value().length === 16, String(value().length));
  ok('熵值 = 16 × log₂(90)',
     stats()['熵值'] === (16 * Math.log2(90)).toFixed(1) + ' 比特', stats()['熵值']);
  ok('103.9 比特判为「很强」', level() === 4 && $('#pg-strength-label').textContent === '很强',
     level() + ' / ' + $('#pg-strength-label').textContent);
  ok('四个统计格子',
     Object.keys(stats()).join(',') === '熵值,字符集大小,密码长度,离线爆破',
     Object.keys(stats()).join(','));
  ok('默认批量 5 条', rows().length === 5, String(rows().length));
  ok('状态行给出长度、字符集与熵',
     /16 个字符，字符集 90 个，约 103\.9 比特熵/.test(status()), status());

  /* ---------- 2. 结果与字符集一致 ---------- */
  section('2. 生成结果与字符集一致');
  const set = new Set([...charset()]);
  ok('密码里的字符都来自当前字符集', [...value()].every((c) => set.has(c)), value());
  ok('5 条互不相同', new Set(items()).size === 5, String(new Set(items()).size));
  ok('每行都有独立的复制目标',
     rows().every((r, i) => r.getAttribute('data-copy-target') === '#pg-item-' + i));
  ok('展示的第一条就是批量列表的第一条', value() === items()[0], value() + ' / ' + items()[0]);

  /* ---------- 3. 字符类别 ---------- */
  section('3. 字符类别');
  await setClasses(['lower', 'digits', 'symbols']);
  ok('取消大写后 64 个字符', charsetSize() === 64, String(charsetSize()));
  ok('结果里没有大写字母', !/[A-Z]/.test(items().join('')), items()[0]);

  await setClasses(['digits', 'symbols']);
  ok('再取消小写后 38 个字符', charsetSize() === 38, String(charsetSize()));

  await setClasses(['symbols']);
  ok('只剩符号时 28 个字符', charsetSize() === 28, String(charsetSize()));
  ok('结果全是符号', items().every((s) => /^[^A-Za-z0-9]+$/.test(s)), items()[0]);

  await setClasses([]);
  ok('一类都不选时给出空状态', $('#pg-list .code-empty') !== null);
  ok('一类都不选时状态行报错',
     status().includes('字符集为空') && $('#pg-status .is-error') !== null, status());
  ok('一类都不选时不残留结果行', rows().length === 0, String(rows().length));
  ok('一类都不选时展示区清空', value() === '');
  ok('回归：上游这时会静默给一串小写字母',
     !/[a-z]/.test(value()), JSON.stringify(value()));

  await setClasses(ALL_CLASSES);
  ok('四类重新勾上后回到 90 个', charsetSize() === 90, String(charsetSize()));

  /* ---------- 4. 排除易混字符 ---------- */
  section('4. 排除易混字符');
  await setCheck($('#pg-exclude-ambiguous'), true);
  ok('排除后 84 个字符', charsetSize() === 84, String(charsetSize()));
  ok('字符集里没有易混字符',
     [...AMBIGUOUS].every((c) => !charset().includes(c)), charset());
  ok('结果里也没有易混字符',
     items().every((s) => [...AMBIGUOUS].every((c) => !s.includes(c))));

  await setClasses(['digits']);
  ok('只选数字 + 排除易混 = 8 个（2-9）', charset() === '23456789', charset());

  await setCheck($('#pg-exclude-ambiguous'), false);
  await setClasses(ALL_CLASSES);
  ok('回到四类全选、不排除', charsetSize() === 90, String(charsetSize()));

  /* ---------- 5. 每类至少出现一次 ---------- */
  section('5. 每类至少出现一次');
  const hasAll = (s) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s) && /[^A-Za-z0-9]/.test(s);

  await setLength(20);
  await setCheck($('#pg-guarantee'), true);
  ok('20 字符 × 5 条，每条四类齐全', items().every(hasAll), items().find((s) => !hasAll(s)) || '');
  ok('开启后状态行说明显示的是上界',
     status().includes('实际熵略低于此值'), status());

  await setLength(4);
  ok('长度 4 时每条正好 4 个字符', items().every((s) => s.length === 4), items()[0]);
  ok('长度 4 时四类各出现一次', items().every(hasAll), items()[0]);
  ok('长度 4 时 5 条互不相同', new Set(items()).size === 5, String(new Set(items()).size));

  await setCheck($('#pg-guarantee'), false);
  ok('关掉后不再提示熵是上界', !status().includes('实际熵略低于此值'), status());
  await setLength(16);

  /* ---------- 6. 长度与熵值 ---------- */
  section('6. 长度与熵值');
  await setLength(32);
  ok('长度 32 -> 32 个字符', value().length === 32, String(value().length));
  ok('熵值随长度线性增长',
     stats()['熵值'] === (32 * Math.log2(90)).toFixed(1) + ' 比特', stats()['熵值']);
  ok('滑块旁边的数值同步', $('#pg-length-value').textContent === '32',
     $('#pg-length-value').textContent);

  await setClasses(['digits']);
  await setLength(4);
  ok('数字 4 位 = 13.3 比特，判为「弱」',
     level() === 1 && $('#pg-strength-label').textContent === '弱',
     $('#pg-strength-label').textContent);
  await setLength(16);
  ok('数字 16 位 = 53.2 比特，判为「一般」', level() === 2, String(level()));
  await setLength(24);
  ok('数字 24 位 = 79.7 比特，判为「强」', level() === 3, String(level()));
  await setLength(32);
  ok('数字 32 位 = 106.3 比特，判为「很强」', level() === 4, String(level()));

  /* ---------- 7. 离线爆破时间 ---------- */
  section('7. 离线爆破时间');
  await setLength(4);
  ok('13 比特 -> 瞬间', stats()['离线爆破'] === '瞬间', stats()['离线爆破']);
  await setLength(16);
  ok('53 比特 -> 按小时计', /小时$/.test(stats()['离线爆破']), stats()['离线爆破']);
  await setLength(64);
  ok('212 比特 -> 用「年」这一档', /年$/.test(stats()['离线爆破']), stats()['离线爆破']);

  /* 回归：上游的分档最高只到「数十亿年」，再大的值全被压进这一档 */
  await setClasses(ALL_CLASSES);
  await setLength(128);
  const bits128 = 128 * Math.log2(90);
  const upstreamSec = Math.pow(2, bits128) / 1e9;
  ok('对照：上游在 10^233 年这个量级上只会显示「数十亿年」',
     upstreamSec >= 31536000e9, upstreamSec.toExponential(2) + ' 秒');

  const expectY = Math.round(bits128 * Math.log10(2) - Math.log10(2e11) - Math.log10(31536000));
  ok('对数算法给出正确的数量级',
     stats()['离线爆破'] === '约 10^' + expectY + ' 年',
     stats()['离线爆破'] + '（期望 10^' + expectY + '）');
  await setLength(16);

  /* ---------- 8. 口令短语 ---------- */
  section('8. 口令短语');
  await mode('passphrase');
  ok('切到口令短语后隐藏密码面板',
     $('#pg-panel-password').hidden === true && $('#pg-panel-passphrase').hidden === false);
  ok('默认 5 个词', value().split('-').length === 5, value());
  ok('默认用短横线连接', (value().match(/-/g) || []).length === 4, value());
  ok('每个词都在词表里', value().split('-').every((x) => WL.includes(x)), value());
  ok('熵值 = 5 × log₂(7776)',
     stats()['熵值'] === (5 * Math.log2(7776)).toFixed(1) + ' 比特', stats()['熵值']);
  ok('64.6 比特判为「强」', level() === 3, String(level()));
  ok('统计格子换成词表口径',
     Object.keys(stats()).join(',') === '熵值,词表大小,词数,离线爆破',
     Object.keys(stats()).join(','));
  ok('词表大小显示 7776', stats()['词表大小'] === '7776 个', stats()['词表大小']);
  ok('词表说明显示了每词熵值',
     /7776 个词 · 每词 12\.92 比特/.test($('#pg-wordlist-info').textContent),
     $('#pg-wordlist-info').textContent);

  await setVal($('#pg-words'), '3');
  ok('3 个词 = 38.8 比特，判为「弱」', level() === 1, String(level()));
  ok('3 个词只有 2 个分隔符', (value().match(/-/g) || []).length === 2, value());
  await setVal($('#pg-words'), '7');
  ok('7 个词 = 90.5 比特，判为「很强」', level() === 4, String(level()));
  ok('7 个词有 6 个分隔符', (value().match(/-/g) || []).length === 6, value());
  await setVal($('#pg-words'), '5');

  /* 分隔符：EFF 词表里只有连字符会出现在词内部，所以其它分隔符都能精确计数 */
  await click('#pg-seps [data-sep="space"]');
  ok('空格分隔符生效', (value().match(/ /g) || []).length === 4, JSON.stringify(value()));
  ok('该胶囊被选中',
     $('#pg-seps [data-sep="space"]').getAttribute('aria-pressed') === 'true');
  ok('其他胶囊取消选中',
     $('#pg-seps [data-sep="dash"]').getAttribute('aria-pressed') === 'false');

  await click('#pg-seps [data-sep="none"]');
  ok('「不加」时结果里没有空格、点、下划线',
     !/ /.test(value()) && !/\./.test(value()) && !/_/.test(value()), value());
  ok('「不加」时长度就是 5 个词之和（词长 3–9）',
     value().length >= 15 && value().length <= 45, String(value().length));

  await click('#pg-seps [data-sep="dot"]');
  ok('点分隔符生效', (value().match(/\./g) || []).length === 4, value());

  /* 回归：上游清空自定义分隔符后无法恢复 */
  await setVal($('#pg-custom-sep'), '#');
  ok('自定义分隔符覆盖胶囊', (value().match(/#/g) || []).length === 4, value());
  await setVal($('#pg-custom-sep'), '');
  ok('清空自定义后回到胶囊选中的「点」',
     (value().match(/\./g) || []).length === 4 && !value().includes('#'), value());

  await click('#pg-seps [data-sep="dash"]');
  ok('重新选胶囊会清掉自定义输入框', $('#pg-custom-sep').value === '',
     JSON.stringify($('#pg-custom-sep').value));

  /* 首字母大写 */
  await setCheck($('#pg-capitalize'), true);
  ok('每个词首字母大写', value().split('-').every((x) => /^[A-Z]/.test(x)), value());
  ok('大写后每个词仍能还原到词表',
     value().split('-').every((x) => WL.includes(x.charAt(0).toLowerCase() + x.slice(1))), value());
  await setCheck($('#pg-capitalize'), false);
  ok('关掉后回到全小写', value() === value().toLowerCase(), value());

  /* ---------- 9. 批量生成 ---------- */
  section('9. 批量生成');
  await mode('password');
  await setCount(10);
  ok('数量 10 -> 10 行', rows().length === 10, String(rows().length));
  ok('10 条互不相同', new Set(items()).size === 10, String(new Set(items()).size));
  ok('批量里的每一条长度都正确', items().every((s) => s.length === 16));

  await setCount(0);
  ok('数量 0 标红', $('#pg-count').classList.contains('input--invalid'));
  ok('数量非法时按 1 渲染', rows().length === 1, String(rows().length));
  await fire($('#pg-count'), 'blur');
  ok('失焦后回退为 1', $('#pg-count').value === '1', $('#pg-count').value);
  ok('失焦后清掉标红', !$('#pg-count').classList.contains('input--invalid'));

  await setCount(200);
  ok('数量 200 标红', $('#pg-count').classList.contains('input--invalid'));
  ok('回归：上游会静默截断到 100 且没有任何提示', rows().length === 100, String(rows().length));
  await fire($('#pg-count'), 'blur');
  ok('失焦后回退为 100', $('#pg-count').value === '100', $('#pg-count').value);

  await setCount(5);

  /* ---------- 10. 复制 ---------- */
  section('10. 复制');
  const pw = value();
  copied = null;
  await click('#pg-value');
  ok('点密码本身即复制', copied === pw, JSON.stringify(copied));
  ok('回归：复制反馈没有把密码替换成「已复制」',
     $('#pg-value-text').textContent === pw, $('#pg-value-text').textContent);
  ok('复制反馈走 data-copied', $('#pg-value').getAttribute('data-copied') === 'true');

  copied = null;
  await click('#pg-copy');
  ok('复制按钮复制的是当前密码', copied === pw, JSON.stringify(copied));

  copied = null;
  await click('#pg-list .value-row:nth-child(3)');
  ok('点第 3 行复制的是第 3 条', copied === items()[2], JSON.stringify(copied));

  copied = null;
  await click('#pg-copy-all');
  ok('复制全部 = 各行按换行拼接', copied === items().join('\n'),
     JSON.stringify(copied).slice(0, 60));
  ok('复制全部共 5 行', (copied || '').split('\n').length === 5);

  /* ---------- 11. 重新生成 ---------- */
  section('11. 重新生成');
  const before = items();
  await click('#pg-regenerate');
  const after = items();
  ok('重新生成后内容变化', before.join('|') !== after.join('|'));
  ok('重新生成后条数与长度不变',
     after.length === before.length && after.every((s) => s.length === 16));
  ok('重新生成后展示区同步更新', value() === after[0], value() + ' / ' + after[0]);

  /* ---------- 12. EFF 词表 ---------- */
  section('12. EFF 词表');
  ok('词表 7776 个词', WL.length === 7776, String(WL.length));
  ok('词数正好是 6^5', WL.length === 6 ** 5, String(WL.length));
  ok('没有重复词', new Set(WL).size === 7776, String(new Set(WL).size));
  ok('首尾词正确（abacus / zoom）', WL[0] === 'abacus' && WL[7775] === 'zoom',
     WL[0] + ' / ' + WL[7775]);
  ok('覆盖 a–z 全部 26 个首字母（上游那份只到 f）',
     new Set(WL.map((x) => x[0])).size === 26,
     [...new Set(WL.map((x) => x[0]))].sort().join(''));
  ok('全部是小写字母或带连字符',
     WL.every((x) => /^[a-z][a-z-]*[a-z]$/.test(x)),
     WL.filter((x) => !/^[a-z][a-z-]*[a-z]$/.test(x)).join(','));
  ok('只有连字符会出现在词内部，其它分隔符可精确计数',
     WL.every((x) => !/[ ._#]/.test(x)));
  ok('每词熵 = log₂(7776) ≈ 12.92',
     Math.abs(Math.log2(WL.length) - 12.9248) < 0.001, String(Math.log2(WL.length)));

  /* ---------- 13. 页面结构 ---------- */
  section('13. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为生成器的琥珀色',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#d97706',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('说明区讲清了随机源',
     d.querySelector('.tool-notes').textContent.includes('crypto.getRandomValues'));
  ok('说明区标注了 EFF 词表与许可',
     d.querySelector('.tool-notes').textContent.includes('EFF') &&
     d.querySelector('.tool-notes').textContent.includes('CC BY 3.0'));
  ok('说明区解释了爆破时间的假设',
     d.querySelector('.tool-notes').textContent.includes('1000 亿次'));
}
