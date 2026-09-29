/* ==========================================================================
   文本排序去重（text-sort-dedupe）测试
   --------------------------------------------------------------------------
   全部用真实 DOM 交互驱动：设 textarea.value + dispatch input + 等防抖，
   不直接调工具内部函数。期望值一律手算，不是「跑一遍看输出是多少」抄下来的。
   ========================================================================== */

import { ok, section, loadPage, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const { d, w, errors } = await loadPage('tools/text-sort-dedupe/index.html', {
    clipboard: (t) => { copied = t; }
  });

  const $ = (sel) => d.querySelector(sel);
  const input = d.getElementById('ts-input');
  const outEl = d.getElementById('ts-output');
  const dirRow = d.getElementById('ts-dir-row');
  const keyRow = d.getElementById('ts-key-row');

  const out = () => outEl.textContent;
  const placeholder = () => outEl.getAttribute('data-placeholder');

  const statOf = (label) => {
    const cell = [...d.querySelectorAll('#ts-stats .stat')]
      .find((s) => s.querySelector('.stat-label').textContent === label);
    return cell ? cell.querySelector('.stat-value').textContent : null;
  };

  const click = (target) => {
    const el = typeof target === 'string' ? $(target) : target;
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  };
  const flush = () => sleep(130);
  const setText = async (t) => {
    input.value = t;
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    await flush();
  };

  /* 辅助函数一律把状态**显式摆到确定取值**，不写成「不传就不动」——
     否则上一个用例留下的设置会泄漏到后面，几条正确的断言会集体报错。 */
  const opt = async (key, value) => {
    const sel = `[data-opt="${key}"][data-value="${value}"]`;
    if ($(sel).getAttribute('aria-pressed') !== 'true') click(sel);
  };
  const toggle = async (key, on) => {
    const sel = `[data-toggle="${key}"]`;
    if (($(sel).getAttribute('aria-pressed') === 'true') !== on) click(sel);
  };

  /** 回到「默认选项 + 指定覆盖项」，再设好输入；text 传 null 时只摆选项 */
  const prep = async (text, cfg = {}) => {
    click('#ts-reset');
    await opt('sort', cfg.sort || 'none');
    await opt('dir', cfg.dir || 'asc');
    await opt('dedupe', cfg.dedupe || 'none');
    await toggle('ignoreCase', !!cfg.ignoreCase);
    await toggle('ignoreSpace', !!cfg.ignoreSpace);
    await toggle('dropBlank', !!cfg.dropBlank);
    if (text === null) { await flush(); return; }
    await setText(text);
  };

  const repRows = () => [...d.querySelectorAll('#ts-report tbody tr')];
  const repCell = (i, j) => (repRows()[i] ? repRows()[i].children[j].textContent : null);
  const L = (n, p) => Array.from({ length: n }, (_, i) => (p || 'L') + (i + 1));

  /* ---------- 1. 基本渲染 ---------- */
  section('1. 基本渲染');

  ok('无脚本错误', errors.length === 0, errors.join(' | '));

  /* 这一条不成立的话，下面所有「字典序」的断言都测不到点上 */
  const zhCollation = new w.Intl.Collator('zh-Hans-CN').compare('\u5B57', '\u5B89') > 0;
  ok('前置条件：本环境有中文排序规则（拼音序下 an < zi）', zhCollation);

  ok('空输入时结果区为空、占位文案在',
     out() === '' && placeholder().includes('处理结果'));
  ok('默认「不排序」',
     $('[data-opt="sort"][data-value="none"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-opt="sort"][data-value="dict"]').getAttribute('aria-pressed') === 'false');
  ok('默认「不去重」',
     $('[data-opt="dedupe"][data-value="none"]').getAttribute('aria-pressed') === 'true');
  ok('默认升序',
     $('[data-opt="dir"][data-value="asc"]').getAttribute('aria-pressed') === 'true');
  ok('默认不删空行',
     $('[data-toggle="dropBlank"]').getAttribute('aria-pressed') === 'false');
  ok('默认判重口径两个开关都关',
     $('[data-toggle="ignoreCase"]').getAttribute('aria-pressed') === 'false' &&
     $('[data-toggle="ignoreSpace"]').getAttribute('aria-pressed') === 'false');
  ok('「不排序」时方向行收起', dirRow.hidden === true);
  ok('「不去重」时判重口径行收起', keyRow.hidden === true);
  ok('统计初始为 0', statOf('输入行') === '0' && statOf('删除重复') === '0');
  ok('没有输入时清单显示空态', $('#ts-report .table-empty') !== null);

  /* ---------- 2. 不排序：原序透传 ---------- */
  section('2. 不排序');

  await prep('a\nb\nc');
  ok('原样输出', out() === 'a\nb\nc', JSON.stringify(out()));

  await prep('a\nb\n');
  ok('输入以换行结尾时输出也以换行结尾', out() === 'a\nb\n', JSON.stringify(out()));

  await prep('a\n');
  ok('单行 + 结尾换行', out() === 'a\n', JSON.stringify(out()));

  /* textarea 的 value 设置器会按 HTML 规范把 \r\n 规范化成 \n，
     所以要验 CRLF 分支必须在实例上遮蔽原型 setter。 */
  await prep('placeholder');
  Object.defineProperty(input, 'value', {
    value: 'a\r\nb', writable: true, configurable: true
  });
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  await flush();
  ok('CRLF 统一成 LF', out() === 'a\nb', JSON.stringify(out()));

  /* ---------- 3. 字典序与码点序 ---------- */
  section('3. 字典序与码点序');

  /* 字(zi)、安(an)、波(bo)：拼音序是 安 波 字，码点序是 字 安 波 ——
     三个字的两种顺序完全不同，一条用例就能把两种口径分开。 */
  await prep('\u5B57\n\u5B89\n\u6CE2', { sort: 'dict' });
  ok('字典序按拼音排（安 波 字）',
     out() === '\u5B89\n\u6CE2\n\u5B57', JSON.stringify(out()));

  await prep('\u5B57\n\u5B89\n\u6CE2', { sort: 'code' });
  ok('码点序按编码排（字 安 波）',
     out() === '\u5B57\n\u5B89\n\u6CE2', JSON.stringify(out()));

  await prep('b\nA\na\nB', { sort: 'code' });
  ok('码点序把大写排在小写前（A B a b）', out() === 'A\nB\na\nb', JSON.stringify(out()));

  await prep('b\nA\na\nB', { sort: 'code', dir: 'desc' });
  ok('码点序降序', out() === 'b\na\nB\nA', JSON.stringify(out()));

  await prep('banana\nApple\napple', { sort: 'dict' });
  ok('字典序里小写排在同词的大写前面（apple Apple banana）',
     out() === 'apple\nApple\nbanana', JSON.stringify(out()));

  await prep('banana\nApple\napple', { sort: 'dict', dir: 'desc' });
  ok('字典序降序', out() === 'banana\nApple\napple', JSON.stringify(out()));

  await prep('b\na', { sort: 'dict' });
  ok('本环境有中文规则时状态行不出声', $('#ts-warn').textContent === '',
     $('#ts-warn').textContent);
  ok('有方向的方式会显示方向行', dirRow.hidden === false);

  /* ---------- 4. 数值序 ---------- */
  section('4. 数值序');

  await prep('10. 第十项\n2. 第二项\n1. 第一项', { sort: 'num' });
  ok('按行首的数字排（1 2 10），不是按字典序',
     out() === '1. 第一项\n2. 第二项\n10. 第十项', JSON.stringify(out()));

  await prep('10. 第十项\n2. 第二项\n1. 第一项', { sort: 'num', dir: 'desc' });
  ok('数值序降序', out() === '10. 第十项\n2. 第二项\n1. 第一项', JSON.stringify(out()));

  await prep('abc\n3\n1\nxyz', { sort: 'num' });
  ok('取不到数字的行排在最后，且保持彼此原有的顺序',
     out() === '1\n3\nabc\nxyz', JSON.stringify(out()));

  await prep('abc\n3\n1\nxyz', { sort: 'num', dir: 'desc' });
  ok('降序时取不到数字的行依然排最后',
     out() === '3\n1\nabc\nxyz', JSON.stringify(out()));

  /* Number 会把它们算成同一个值 —— 这正是这里不能用 Number 的原因 */
  ok('前置条件：两个 20 位整数用 Number 比是相等的',
     Number('99999999999999999999') === Number('99999999999999999998'));
  await prep('99999999999999999999\n99999999999999999998', { sort: 'num' });
  ok('20 位整数按十进制逐位比较，不丢精度',
     out() === '99999999999999999998\n99999999999999999999', JSON.stringify(out()));

  await prep('0.5\n0.25\n0.125', { sort: 'num' });
  ok('小数按数值排（0.125 0.25 0.5）',
     out() === '0.125\n0.25\n0.5', JSON.stringify(out()));

  await prep('-2\n1\n-10\n0', { sort: 'num' });
  ok('负数按数值排（-10 -2 0 1）', out() === '-10\n-2\n0\n1', JSON.stringify(out()));

  await prep('007\n8\n09', { sort: 'num' });
  ok('前导零不影响数值（007 8 09 → 7 8 9）',
     out() === '007\n8\n09', JSON.stringify(out()));

  await prep('0.0\n-0\n1', { sort: 'num' });
  ok('+0 与 -0 视为相等，稳定排序保持原序',
     out() === '0.0\n-0\n1', JSON.stringify(out()));

  await prep('3 b\n3 a', { sort: 'num' });
  ok('数字相同的行保持输入里的相对顺序（排序是稳定的）',
     out() === '3 b\n3 a', JSON.stringify(out()));

  await prep('.5\n2', { sort: 'num' });
  ok('认得「.5」这种写法', out() === '.5\n2', JSON.stringify(out()));

  /* ---------- 5. 长度序 ---------- */
  section('5. 长度序');

  await prep('ccc\na\nbb', { sort: 'len' });
  ok('按字符数排（a bb ccc）', out() === 'a\nbb\nccc', JSON.stringify(out()));

  await prep('ccc\na\nbb', { sort: 'len', dir: 'desc' });
  ok('长度序降序', out() === 'ccc\nbb\na', JSON.stringify(out()));

  ok('前置条件：emoji 的 .length 是 2、码点数是 1',
     '\u{1F600}'.length === 2 && Array.from('\u{1F600}').length === 1);
  await prep('\u{1F600}\na', { sort: 'len' });
  ok('长度按码点算：emoji 与单字母一样长，保持原序',
     out() === '\u{1F600}\na', JSON.stringify(out()));

  /* ---------- 6. 原序反转与随机打乱 ---------- */
  section('6. 原序反转与随机打乱');

  await prep('a\nb\nc', { sort: 'reverse' });
  ok('原序反转', out() === 'c\nb\na', JSON.stringify(out()));

  await prep('a\nb\nc', { sort: 'reverse', dir: 'desc' });
  ok('反转不受方向影响', out() === 'c\nb\na', JSON.stringify(out()));
  ok('反转时方向行收起', dirRow.hidden === true);

  const shuffleSel = '[data-opt="sort"][data-value="shuffle"]';
  await prep('1\n2\n3\n4\n5\n6', { sort: 'shuffle' });
  ok('随机打乱时方向行收起', dirRow.hidden === true);
  const runs = new Set();
  for (let i = 0; i < 6; i++) {
    click(shuffleSel);                 /* 每次点击都会重新洗一遍 */
    runs.add(out());
  }
  ok('打乱后行集合与原集合相同',
     out().split('\n').slice().sort().join(',') === '1,2,3,4,5,6', JSON.stringify(out()));
  ok('打乱后行数不变', statOf('输出行') === '6', statOf('输出行'));
  /* 6 个元素连续 6 次洗出一模一样的结果，概率约 (1/720)^5 ≈ 3e-15 */
  ok('多次打乱结果不止一种', runs.size > 1, runs.size + ' 种');

  /* ---------- 7. 去重 ---------- */
  section('7. 去重');

  await prep('a\nb\na\nc\nb\na', { dedupe: 'first' });
  ok('保留首次：按第一次出现的先后留下',
     out() === 'a\nb\nc', JSON.stringify(out()));
  ok('保留首次时的删除重复计数', statOf('删除重复') === '3', statOf('删除重复'));

  await prep('a\nb\na\nc\nb\na', { dedupe: 'last' });
  ok('保留末次：留下每个值最后一次出现的那一行，顺序仍按输入先后',
     out() === 'c\nb\na', JSON.stringify(out()));

  await prep('a\nb\na\nc\nb\na', { dedupe: 'only' });
  ok('只看重复：只输出出现过两次以上的行，每种一份',
     out() === 'a\nb', JSON.stringify(out()));
  ok('只看重复的删除计数是「被筛掉的」行数', statOf('删除重复') === '4', statOf('删除重复'));

  await prep('a\nb\nc', { dedupe: 'only' });
  ok('没有重复时「只看重复」结果为空并说明原因',
     out() === '' && placeholder().includes('没有重复的行'), JSON.stringify(placeholder()));

  await prep('a\nb\na', { dedupe: 'none' });
  ok('不去重时重复行原样留着', out() === 'a\nb\na', JSON.stringify(out()));
  ok('「不去重」时判重口径行收起', keyRow.hidden === true);

  await prep('a\nb\na', { dedupe: 'first' });
  ok('选了去重之后判重口径行才出现', keyRow.hidden === false);

  await prep('a\nb\na\nb', { dedupe: 'only', sort: 'dict', dir: 'desc' });
  ok('只看重复的结果仍然参与排序', out() === 'b\na', JSON.stringify(out()));

  /* ---------- 8. 判重口径 ---------- */
  section('8. 判重口径');

  await prep('Apple\napple\nAPPLE', { dedupe: 'first', ignoreCase: true });
  ok('忽略大小写后三种写法算同一条', out() === 'Apple', JSON.stringify(out()));
  ok('判重不改写留下的那一行（仍然是 Apple）', out() !== 'apple');

  await prep('Apple\napple\nAPPLE', { dedupe: 'first' });
  ok('精确匹配下三种写法是三条', out() === 'Apple\napple\nAPPLE', JSON.stringify(out()));

  await prep('  \u82F9\u679C  \n\u82F9\u679C', { dedupe: 'first', ignoreSpace: true });
  ok('忽略首尾空白后算同一条', statOf('删除重复') === '1', statOf('删除重复'));
  ok('判重不改写留下的那一行（前后的空格还在）',
     out() === '  \u82F9\u679C  ', JSON.stringify(out()));

  await prep('  \u82F9\u679C  \n\u82F9\u679C', { dedupe: 'first' });
  ok('精确匹配下首尾空白不同的两行是两条', statOf('删除重复') === '0', statOf('删除重复'));

  await prep('A\na', { dedupe: 'first', ignoreCase: true, ignoreSpace: true });
  ok('两个口径可以同时开', out() === 'A', JSON.stringify(out()));
  ok('口径说明写在概览底栏', $('#ts-foot').textContent.includes('忽略大小写与首尾空白'),
     $('#ts-foot').textContent);

  /* ---------- 9. 删除空行 ---------- */
  section('9. 删除空行');

  await prep('a\n\nb\n   \nc', { dropBlank: true });
  ok('空行与只有空格的行都被删掉', out() === 'a\nb\nc', JSON.stringify(out()));
  ok('删除空行的计数', statOf('删除空行') === '2', statOf('删除空行'));
  ok('输入行数按原始行算', statOf('输入行') === '5', statOf('输入行'));
  ok('输出行数', statOf('输出行') === '3', statOf('输出行'));

  await prep('a\n\nb\n   \nc');
  ok('不开删除时空行原样留着',
     out() === 'a\n\nb\n   \nc', JSON.stringify(out()));

  await prep('\n\n', { dropBlank: true });
  ok('全是空行时结果为空并说明原因',
     out() === '' && placeholder().includes('全是空行'), JSON.stringify(placeholder()));

  await prep('a\n', { dropBlank: true });
  ok('结尾换行不算一行，也不会被删空行吃掉', out() === 'a\n', JSON.stringify(out()));
  ok('结尾换行不计入输入行数', statOf('输入行') === '1', statOf('输入行'));

  /* ---------- 10. 重复行清单 ---------- */
  section('10. 重复行清单');

  await prep('a\nb\na\nc\nb\na');
  ok('只列出出现两次以上的行（a 与 b）', repRows().length === 2, String(repRows().length));
  ok('次数多的排前面，次数是 3', repCell(0, 0) === '3', repCell(0, 0));
  ok('第一行内容正确', repCell(0, 1) === 'a', repCell(0, 1));
  ok('首次出现用的是输入里的行号', repCell(0, 2) === '第 1 行', repCell(0, 2));
  ok('次数第二的是 2', repCell(1, 0) === '2', repCell(1, 0));
  ok('清单底栏给出合计',
     $('#ts-report-foot').textContent.includes('2 种') &&
     $('#ts-report-foot').textContent.includes('5 行'), $('#ts-report-foot').textContent);

  await prep('a\nb\nc');
  ok('没有重复时清单显示空态', $('#ts-report .table-empty') !== null && repRows().length === 0);

  await prep('\n\na');
  ok('重复的空行标成「（空行）」', repCell(0, 1) === '（空行）', repCell(0, 1));
  ok('「（空行）」那格带弱化样式类', $('.ts-report .ts-blank') !== null);

  await prep('Apple\napple', { ignoreCase: true });
  ok('判重口径会影响清单分组（忽略大小写后算一组）',
     repRows().length === 1 && repCell(0, 0) === '2',
     repRows().length + '/' + repCell(0, 0));

  await prep('Apple\napple');
  ok('精确匹配下清单为空', repRows().length === 0);

  await prep('a\n\nb\na', { dropBlank: true });
  ok('删空行之后行号仍是输入里的原始行号', repCell(0, 2) === '第 1 行', repCell(0, 2));

  /* ---------- 11. 组合 ---------- */
  section('11. 组合');

  await prep('banana\nApple\n\napple\n10. \u7532\n2. \u4E59\nbanana\n', {
    sort: 'dict', dir: 'asc', dedupe: 'first', ignoreCase: true, dropBlank: true
  });
  ok('删空行 → 去重 → 字典序排序一起工作时结果正确',
     out() === '10. \u7532\n2. \u4E59\nApple\nbanana\n', JSON.stringify(out()));
  ok('组合下的统计', statOf('输入行') === '7' && statOf('输出行') === '4' &&
     statOf('删除重复') === '2' && statOf('删除空行') === '1',
     [statOf('输入行'), statOf('输出行'), statOf('删除重复'), statOf('删除空行')].join('/'));

  await prep(L(5).join('\n'), { sort: 'len', dedupe: 'first' });
  ok('长度相同的行保持原序', out() === L(5).join('\n'), JSON.stringify(out()));

  /* ---------- 12. 复制与下载 ---------- */
  section('12. 复制与下载');

  await prep('a\nb\na', { dedupe: 'first' });
  copied = null;
  click('[data-copy-target="#ts-output"]');
  await flush();
  ok('复制拿到的是去重后的结果', copied === 'a\nb', JSON.stringify(copied));

  await prep('a\n');
  copied = null;
  click('[data-copy-target="#ts-output"]');
  await flush();
  ok('复制的文本保留结尾换行', copied === 'a\n', JSON.stringify(copied));

  let dlThrew = false;
  try { click('#ts-download'); await flush(); } catch (e) { dlThrew = true; }
  ok('点击下载不抛异常', !dlThrew);

  /* ---------- 13. 恢复默认与示例 ---------- */
  section('13. 恢复默认与示例');

  await prep('b\na\nb', { sort: 'len', dir: 'desc', dedupe: 'only', ignoreCase: true, dropBlank: true });
  ok('前置条件：改动都生效了', out() === 'b', JSON.stringify(out()));

  click('#ts-reset');
  await flush();
  ok('恢复默认后排序回到「不排序」',
     $('[data-opt="sort"][data-value="none"]').getAttribute('aria-pressed') === 'true');
  ok('恢复默认后方向回到升序',
     $('[data-opt="dir"][data-value="asc"]').getAttribute('aria-pressed') === 'true');
  ok('恢复默认后去重回到「不去重」',
     $('[data-opt="dedupe"][data-value="none"]').getAttribute('aria-pressed') === 'true');
  ok('恢复默认后两个判重口径开关都关',
     $('[data-toggle="ignoreCase"]').getAttribute('aria-pressed') === 'false' &&
     $('[data-toggle="ignoreSpace"]').getAttribute('aria-pressed') === 'false');
  ok('恢复默认后不删空行',
     $('[data-toggle="dropBlank"]').getAttribute('aria-pressed') === 'false');
  ok('恢复默认后结果回到原序透传', out() === 'b\na\nb', JSON.stringify(out()));
  ok('恢复默认后两个条件行重新收起', dirRow.hidden === true && keyRow.hidden === true);

  click('[data-demo]');
  await flush();
  ok('填入示例后有输出', out().length > 0);
  ok('示例在不排序不去重下原样输出 10 行', out().split('\n').length === 10,
     String(out().split('\n').length));
  ok('示例里第 6 行是空行', out().split('\n')[5] === '', JSON.stringify(out().split('\n')[5]));

  click('[data-clear]');
  await flush();
  ok('清空后回到空态', out() === '' && input.value === '');
  ok('清空后统计归零', statOf('输入行') === '0' && statOf('输出行') === '0');
  ok('清空后清单回到空态', $('#ts-report .table-empty') !== null);

  ok('全程无脚本错误', errors.length === 0, errors.join(' | '));
}
