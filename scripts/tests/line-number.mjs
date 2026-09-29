/* ==========================================================================
   批量加行号（line-number）测试
   --------------------------------------------------------------------------
   全部用真实 DOM 交互驱动：设 textarea.value + dispatch input + 等防抖，
   不直接调工具内部函数。期望值一律手算，不是「跑一遍看输出是多少」抄下来的。
   ========================================================================== */

import { ok, section, loadPage, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const { d, w, errors } = await loadPage('tools/line-number/index.html', {
    clipboard: (t) => { copied = t; }
  });

  const $ = (sel) => d.querySelector(sel);
  const input = d.getElementById('ln-input');
  const outEl = d.getElementById('ln-output');
  const sepEl = d.getElementById('ln-sep');
  const startEl = d.getElementById('ln-start');
  const stepEl = d.getElementById('ln-step');
  const prefixEl = d.getElementById('ln-prefix');
  const suffixEl = d.getElementById('ln-suffix');
  const padWidthEl = d.getElementById('ln-pad-width');

  /* 结果区渲染出来的**纯文本**。标记只是多包一层 <span>，一个字符都不增删，
     所以 textContent 就等于输出文本 —— 顺带这也是「复制不受标记影响」的证据。 */
  const out = () => outEl.textContent;

  const statOf = (label) => {
    const cell = [...d.querySelectorAll('#ln-stats .stat')]
      .find((s) => s.querySelector('.stat-label').textContent === label);
    return cell ? cell.querySelector('.stat-value').textContent : null;
  };

  /* 点胶囊 / 开关走同步 update()，不用等防抖；只有输入框要等 */
  const click = (target) => {
    const el = typeof target === 'string' ? $(target) : target;
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  };

  /* 预设胶囊里有制表符这种值，写成 CSS 选择器要再套一层转义
     （`[data-sep="\t"]` 里的 `\t` 会被 CSS 当成「转义掉的 t」），
     所以按属性值逐个找。 */
  const sepChip = (v) => [...d.querySelectorAll('[data-sep]')]
    .find((c) => c.getAttribute('data-sep') === v);
  const flush = () => sleep(130);
  const setText = async (t) => {
    input.value = t;
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    await flush();
  };
  const setField = (el, v) => {
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
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
  const blank = async (mode) => {
    if ($(`[data-blank="${mode}"]`).getAttribute('aria-pressed') !== 'true') {
      click(`[data-blank="${mode}"]`);
    }
  };

  /** 回到「默认选项 + 指定覆盖项」，并设好输入 */
  const prep = async (text, cfg = {}) => {
    click('#ln-reset');
    await opt('format', cfg.format || 'number');
    await opt('position', cfg.position || 'start');
    await blank(cfg.blank || 'keep');
    await toggle('enabled', cfg.enabled !== false);
    await toggle('padZero', !!cfg.padZero);
    setField(sepEl, cfg.sep === undefined ? '. ' : cfg.sep);
    setField(prefixEl, cfg.prefix === undefined ? '' : cfg.prefix);
    setField(suffixEl, cfg.suffix === undefined ? '' : cfg.suffix);
    setField(startEl, String(cfg.start === undefined ? 1 : cfg.start));
    setField(stepEl, String(cfg.step === undefined ? 1 : cfg.step));
    if (cfg.padWidth) {
      padWidthEl.value = String(cfg.padWidth);
      padWidthEl.dispatchEvent(new w.Event('change', { bubbles: true }));
    }
    if (text === null) { await flush(); return; }   /* 只摆选项，不动输入 */
    await setText(text);
  };

  const L = (n, p) => Array.from({ length: n }, (_, i) => (p || 'L') + (i + 1));

  /* ---------- 1. 基本渲染 ---------- */
  section('1. 基本渲染');

  ok('无脚本错误', errors.length === 0, errors.join(' | '));
  ok('空输入时结果区为空、占位文案在', out() === '' &&
     outEl.getAttribute('data-placeholder').includes('编号结果'));
  ok('默认「加序号」打开', $('[data-toggle="enabled"]').getAttribute('aria-pressed') === 'true');
  ok('默认「补零」关闭', $('[data-toggle="padZero"]').getAttribute('aria-pressed') === 'false');
  ok('默认格式是数字',
     $('[data-opt="format"][data-value="number"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-opt="format"][data-value="cn"]').getAttribute('aria-pressed') === 'false');
  ok('默认位置是行首',
     $('[data-opt="position"][data-value="start"]').getAttribute('aria-pressed') === 'true');
  ok('默认空行模式是「保留不编号」',
     $('[data-blank="keep"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-blank="drop"]').getAttribute('aria-pressed') === 'false');
  ok('分隔符默认是「. 」', sepEl.value === '. ', JSON.stringify(sepEl.value));
  ok('分隔符预设里「. 」是选中的',
     $('[data-sep=". "]').getAttribute('aria-pressed') === 'true');
  ok('起始值与步长默认 1', startEl.value === '1' && stepEl.value === '1');
  ok('补零位数默认 3 位', padWidthEl.value === '3');
  ok('统计初始为 0', statOf('输入行') === '0' && statOf('输出字符') === '0');
  ok('没有输出时不显示「已有行号」提示', $('#ln-warn').textContent === '');

  /* ---------- 2. 默认编号 ---------- */
  section('2. 默认编号');

  await prep('a\nb\nc');
  ok('三行依次编号', out() === '1. a\n2. b\n3. c', JSON.stringify(out()));

  await prep('hello');
  ok('单行也编号', out() === '1. hello', JSON.stringify(out()));

  /* split('\n') 会产生一个尾随空串（结尾换行留下的）。它不是一行内容：
     不能给它编号，也不能被「删除空行」吃掉。 */
  await prep('a\nb\n');
  ok('结尾换行不额外编号（输出仍是两行）', out() === '1. a\n2. b\n', JSON.stringify(out()));

  await prep('a\nb\nc\n', { blank: 'number' });
  ok('空行选「也编号」时结尾换行依然不编号',
     out() === '1. a\n2. b\n3. c\n', JSON.stringify(out()));

  /* textarea 的 value 设置器会按 HTML 规范把 \r\n 规范化成 \n，
     所以走 CRLF 分支必须绕开它 —— 在实例上定义一个可写的自有属性遮蔽原型 setter。 */
  await prep('placeholder');
  Object.defineProperty(input, 'value', {
    value: 'a\r\nb', writable: true, configurable: true
  });
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  await flush();
  ok('CRLF 输入按两行处理', out() === '1. a\n2. b', JSON.stringify(out()));

  /* ---------- 3. 序号格式 ---------- */
  section('3. 序号格式');

  await prep(L(11).join('\n'), { format: 'hex' });
  const hexLines = out().split('\n');
  ok('十六进制第 10 行是 a', hexLines[9] === 'a. L10', hexLines[9]);
  ok('十六进制第 11 行是 b（不是 10 进制进位）', hexLines[10] === 'b. L11', hexLines[10]);

  await prep(L(27).join('\n'), { format: 'alpha' });
  const al = out().split('\n');
  ok('小写字母第 26 行是 z', al[25] === 'z. L26', al[25]);
  ok('小写字母第 27 行是 aa（列名式进位，不是 ba）', al[26] === 'aa. L27', al[26]);

  await prep('x', { format: 'ALPHA', start: 27 });
  ok('大写字母 start=27 得到 AA', out() === 'AA. x', JSON.stringify(out()));

  await prep('x\ny\nz', { format: 'roman', start: 3998 });
  ok('罗马数字 3998 / 3999 / 4000 前两行正确、第三行回落十进制',
     out() === 'mmmcmxcviii. x\nmmmcmxcix. y\n4000. z', JSON.stringify(out()));
  ok('回落的行数写在输出底栏', $('#ln-out-foot').textContent.includes('超出该格式的范围'));

  await prep('x\ny', { format: 'roman', start: 3998 });
  ok('没有回落时底栏不提这一条',
     !$('#ln-out-foot').textContent.includes('超出该格式的范围'));

  /* 中文数字：单行取值（用分隔符把序号切出来，标签本身不含「. 」） */
  const cnLabel = async (start) => {
    await prep('x', { format: 'cn', start: start });
    const s = out();
    return s.slice(0, s.length - 3);   /* 去掉尾部的「. x」 */
  };
  ok('中文 0 → 零', await cnLabel(0) === '零');
  ok('中文 3 → 三', await cnLabel(3) === '三');
  ok('中文 10 → 十（不带「一」）', await cnLabel(10) === '十');
  ok('中文 11 → 十一', await cnLabel(11) === '十一');
  ok('中文 -3 → 负三', await cnLabel(-3) === '负三');
  ok('中文 1001 → 一千零一', await cnLabel(1001) === '一千零一');
  ok('中文 10001 → 一万零一', await cnLabel(10001) === '一万零一');
  ok('中文 12000 → 一万二千（不缺位，不补零）', await cnLabel(12000) === '一万二千');
  ok('中文 1000001 → 一百万零一', await cnLabel(1000001) === '一百万零一');
  ok('中文 100000000 → 一亿', await cnLabel(100000000) === '一亿');
  ok('中文 100000001 → 一亿零一', await cnLabel(100000001) === '一亿零一');
  ok('中文 110 → 一百一十', await cnLabel(110) === '一百一十');
  ok('中文 1000010 → 一百万零一十', await cnLabel(1000010) === '一百万零一十');

  await prep(L(12).join('\n'), { format: 'cn' });
  const cn12 = out().split('\n');
  ok('中文连续编号第 10 行是十', cn12[9] === '十. L10', cn12[9]);
  ok('中文连续编号第 12 行是十二', cn12[11] === '十二. L12', cn12[11]);

  /* ---------- 4. 位置与分隔符 ---------- */
  section('4. 位置与分隔符');

  await prep('a\nb', { position: 'end', sep: ' #' });
  ok('行尾编号把序号放在正文之后', out() === 'a #1\nb #2', JSON.stringify(out()));

  await prep('a', { sep: '' });
  ok('分隔符留空时序号紧贴正文', out() === '1a', JSON.stringify(out()));

  await prep('a', { sep: '、' });
  ok('中文顿号分隔符', out() === '1、a', JSON.stringify(out()));

  await prep('a', { sep: '. ' });
  click(sepChip('\\t'));
  await flush();
  ok('点 Tab 预设后分隔符里存的是 \\t 这两个字符',
     sepEl.value === '\\t', JSON.stringify(sepEl.value));
  ok('\\t 在输出里变成一个真正的制表符', out() === '1\ta', JSON.stringify(out()));

  /* 手动打一个值也要把对应的预设点亮（输入框是唯一真值来源） */
  setField(sepEl, ') ');
  await flush();
  ok('手打分隔符后预设高亮跟着走',
     $('[data-sep=") "]').getAttribute('aria-pressed') === 'true' &&
     $('[data-sep=". "]').getAttribute('aria-pressed') === 'false');

  /* ---------- 5. 起始值与步长 ---------- */
  section('5. 起始值与步长');

  await prep('a\nb', { start: 0 });
  ok('起始值 0', out() === '0. a\n1. b', JSON.stringify(out()));

  await prep('a\nb\nc', { start: 10, step: -3 });
  ok('负步长倒着编号', out() === '10. a\n7. b\n4. c', JSON.stringify(out()));

  await prep('a\nb', { start: 100, step: 5 });
  ok('步长 5', out() === '100. a\n105. b', JSON.stringify(out()));

  /* ---------- 6. 补零 ---------- */
  section('6. 补零');

  await prep('a\nb\nc', { padZero: true, padWidth: 3 });
  ok('补零到 3 位', out() === '001. a\n002. b\n003. c', JSON.stringify(out()));

  await prep('a', { padZero: true, padWidth: 3, start: -7 });
  ok('负数补零时负号占一位（-7 → -07）', out() === '-07. a', JSON.stringify(out()));

  await prep('a', { padZero: true, padWidth: 3, start: 1234 });
  ok('序号本身超宽时不截断', out() === '1234. a', JSON.stringify(out()));

  await prep('a', { padZero: true, padWidth: 2, start: 7 });
  ok('补零位数可选 2 位', out() === '07. a', JSON.stringify(out()));

  await prep('a', { format: 'roman', padZero: true, start: 7 });
  ok('字母 / 罗马 / 中文格式下补零控件收起',
     $('[data-toggle="padZero"]').hidden === true && padWidthEl.hidden === true);
  ok('收起时补零开关不生效', out() === 'vii. a', JSON.stringify(out()));
  ok('收起时补零一行的说明文字也换了',
     d.getElementById('ln-pad-note').textContent.includes('没有补零'));

  await prep('a', { format: 'hex', padZero: true, padWidth: 4 });
  ok('切回数字格式后补零控件回来且状态是用户选的那个',
     $('[data-toggle="padZero"]').hidden === false && padWidthEl.hidden === false &&
     $('[data-toggle="padZero"]').getAttribute('aria-pressed') === 'true');
  ok('十六进制同样补零', out() === '0001. a', JSON.stringify(out()));

  /* ---------- 7. 前后缀 ---------- */
  section('7. 前后缀');

  await prep('a', { prefix: '- ' });
  ok('行前缀加在序号之前', out() === '- 1. a', JSON.stringify(out()));

  await prep('a', { suffix: ';' });
  ok('行后缀加在整行末尾', out() === '1. a;', JSON.stringify(out()));

  await prep('a\nb', { enabled: false, prefix: '<', suffix: '>' });
  ok('关掉序号后只加前后缀', out() === '<a>\n<b>', JSON.stringify(out()));

  await prep('a', { enabled: false, prefix: '\\t' });
  ok('前缀里的 \\t 是制表符', out() === '\ta', JSON.stringify(out()));

  await prep('a', { enabled: false, prefix: '\\\\' });
  ok('前缀里的 \\\\ 是一个反斜杠', out() === '\\a', JSON.stringify(out()));

  await prep('a', { enabled: false, prefix: '\\n' });
  ok('\\n 不在转义表里，按字面输出', out() === '\\na', JSON.stringify(out()));

  await prep('a', { position: 'end', sep: ' ', prefix: '> ', suffix: '' });
  ok('行尾 + 前后缀可以拼出「> a 1」', out() === '> a 1', JSON.stringify(out()));

  /* ---------- 8. 空行 ---------- */
  section('8. 空行');

  await prep('a\n\nb');
  ok('默认空行原样保留、不占编号', out() === '1. a\n\n2. b', JSON.stringify(out()));

  await prep('a\n\nb', { blank: 'number' });
  ok('空行选「也编号」会拿到「2. 」这样一行',
     out() === '1. a\n2. \n3. b', JSON.stringify(out()));

  await prep('a\n\nb', { blank: 'drop' });
  ok('空行选「删除」整行去掉', out() === '1. a\n2. b', JSON.stringify(out()));

  await prep('a\n   \nb');
  ok('只有空格的行也算空行', out() === '1. a\n   \n2. b', JSON.stringify(out()));

  await prep('a\n', { blank: 'drop' });
  ok('「删除空行」不会吃掉结尾的换行', out() === '1. a\n', JSON.stringify(out()));

  await prep('\n\n', { blank: 'drop' });
  ok('全是空行且删除时结果区回到空态', out() === '' &&
     outEl.getAttribute('data-placeholder').includes('没有可输出的行'),
     JSON.stringify(outEl.getAttribute('data-placeholder')));

  /* ---------- 9. 统计 ---------- */
  section('9. 统计');

  await prep('a');
  ok('输入行 1', statOf('输入行') === '1', statOf('输入行'));
  ok('输出行 1', statOf('输出行') === '1', statOf('输出行'));
  ok('已编号 1', statOf('已编号') === '1', statOf('已编号'));
  ok('输出字符 4（「1. a」）', statOf('输出字符') === '4', statOf('输出字符'));

  await prep('a\n\nb', { blank: 'drop' });
  ok('删除空行后输出行是 2', statOf('输出行') === '2', statOf('输出行'));
  ok('删除空行后输出字符 9（「1. a↵2. b」）', statOf('输出字符') === '9', statOf('输出字符'));

  await prep('a\n\n');   /* 空行保留：两行空行里一个是真的、一个是结尾换行留下的 */
  ok('结尾换行不计入输入行数', statOf('输入行') === '2', statOf('输入行'));
  ok('结尾换行也不计入输出行数', statOf('输出行') === '2', statOf('输出行'));

  /* ---------- 10. 「已经有序号」提示 ---------- */
  section('10. 已有行号提示');

  await prep('1. 甲\n2. 乙\n3. 丙');
  ok('三行都像已有行号时给出提示',
     $('#ln-warn').textContent.includes('已经有序号'), $('#ln-warn').textContent);
  ok('提示用的是 .tool-status 的语义色子元素',
     $('#ln-warn .is-warn') !== null && $('#ln-warn').className === 'tool-status ln-warn');
  ok('提示不影响输出', out() === '1. 1. 甲\n2. 2. 乙\n3. 3. 丙', JSON.stringify(out()));

  await prep('2026-09-29 日志\n2026-09-28 日志\n2026-09-27 日志');
  ok('日期不会被误判成已有行号', $('#ln-warn .is-warn') === null,
     $('#ln-warn').textContent);

  await prep('a\nb\nc');
  ok('普通文本不提示', $('#ln-warn .is-warn') === null);

  await prep('1. 甲\n2. 乙\n3. 丙', { enabled: false });
  ok('关掉序号后不再提示', $('#ln-warn .is-warn') === null);

  /* ---------- 11. 预览标记 ---------- */
  section('11. 预览标记');

  const marks = () => [...d.querySelectorAll('#ln-output .ln-mark')].map((e) => e.textContent);

  await prep('a');
  ok('序号与分隔符各自被标出来', JSON.stringify(marks()) === JSON.stringify(['1', '. ']),
     JSON.stringify(marks()));
  ok('标记不改变输出文本', out() === '1. a', JSON.stringify(out()));

  await prep('abc');
  ok('正文不参与标记（整行只标出序号与分隔符）', marks().length === 2, String(marks().length));

  await prep('a', { enabled: false, prefix: '<', suffix: '>' });
  ok('前后缀也被标出来', JSON.stringify(marks()) === JSON.stringify(['<', '>']),
     JSON.stringify(marks()));
  ok('前后缀模式下的输出文本正确', out() === '<a>', JSON.stringify(out()));

  await prep('a', { blank: 'keep' });
  ok('标记用的是自己写的语义类而不是语法高亮令牌',
     d.querySelector('#ln-output .tok-num') === null && marks().length > 0);

  /* ---------- 12. 复制与下载 ---------- */
  section('12. 复制与下载');

  await prep('a\nb');
  copied = null;
  click('[data-copy-target="#ln-output"]');
  await flush();
  ok('复制拿到的是完整纯文本（不含符号标记）', copied === '1. a\n2. b', JSON.stringify(copied));

  await prep('a', { enabled: false, prefix: '<', suffix: '>' });
  copied = null;
  click('[data-copy-target="#ln-output"]');
  await flush();
  ok('带前后缀时复制的也是完整文本', copied === '<a>', JSON.stringify(copied));

  let dlThrew = false;
  try { click('#ln-download'); await flush(); } catch (e) { dlThrew = true; }
  ok('点击下载不抛异常', !dlThrew);

  /* ---------- 13. 非法输入 ---------- */
  section('13. 非法输入');

  await prep('a', { start: 5 });
  ok('前置条件：起始值写进了输入框', startEl.value === '5' && out() === '5. a');

  setField(startEl, 'abc');
  await flush();
  ok('非法起始值标红', startEl.classList.contains('input--invalid'));
  ok('输入过程中沿用上一次的有效值', out() === '5. a', JSON.stringify(out()));

  startEl.dispatchEvent(new w.Event('blur', { bubbles: true }));
  await flush();
  ok('失焦后把有效值写回并清掉标红',
     startEl.value === '5' && !startEl.classList.contains('input--invalid'), startEl.value);

  setField(startEl, '');
  await flush();
  ok('清空起始值时不标红', !startEl.classList.contains('input--invalid'));
  startEl.dispatchEvent(new w.Event('blur', { bubbles: true }));
  await flush();
  ok('清空后失焦会写回有效值', startEl.value === '5', startEl.value);

  setField(startEl, '9999999999999');
  await flush();
  ok('超出范围的起始值被标红', startEl.classList.contains('input--invalid'));
  ok('超范围时结果不受影响', out() === '5. a', JSON.stringify(out()));

  setField(stepEl, '2.5');
  await flush();
  ok('小数步长被标红', stepEl.classList.contains('input--invalid'));
  stepEl.dispatchEvent(new w.Event('blur', { bubbles: true }));
  await flush();
  ok('小数步长失焦后回退到有效值', stepEl.value === '1', stepEl.value);

  /* ---------- 14. 大输入降级 ---------- */
  section('14. 大输入');

  await prep(L(20005).join('\n'));
  ok('超过 2 万行时输出仍是完整的 20005 行',
     out().split('\n').length === 20005, String(out().split('\n').length));
  ok('超过 2 万行时不再套预览标记', d.querySelectorAll('#ln-output .ln-mark').length === 0);
  ok('首尾两行的序号都对',
     out().startsWith('1. L1\n') && out().endsWith('20005. L20005'),
     JSON.stringify(out().slice(0, 8) + ' … ' + out().slice(-14)));

  /* ---------- 15. 恢复默认与示例 ---------- */
  section('15. 恢复默认与示例');

  await prep('a\n\nb', {
    format: 'cn', position: 'end', blank: 'drop', start: 3, step: 2,
    prefix: '> ', suffix: '.', padZero: true
  });
  ok('前置条件：改动都生效了', out() === '> a. 三.\n> b. 五.', JSON.stringify(out()));

  click('#ln-reset');
  await flush();
  ok('恢复默认后格式回到数字',
     $('[data-opt="format"][data-value="number"]').getAttribute('aria-pressed') === 'true');
  ok('恢复默认后位置回到行首',
     $('[data-opt="position"][data-value="start"]').getAttribute('aria-pressed') === 'true');
  ok('恢复默认后空行回到「保留不编号」',
     $('[data-blank="keep"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-blank="drop"]').getAttribute('aria-pressed') === 'false');
  ok('恢复默认后前后缀清空', prefixEl.value === '' && suffixEl.value === '');
  ok('恢复默认后分隔符回到「. 」', sepEl.value === '. ', JSON.stringify(sepEl.value));
  ok('恢复默认后起始值 / 步长回到 1', startEl.value === '1' && stepEl.value === '1');
  ok('恢复默认后补零关闭', $('[data-toggle="padZero"]').getAttribute('aria-pressed') === 'false');
  ok('恢复默认后结果回到默认编号', out() === '1. a\n\n2. b', JSON.stringify(out()));

  click('[data-demo]');
  await flush();
  ok('填入示例后有输出', out().length > 0);
  ok('示例包含一个空行', out().includes('\n\n'), JSON.stringify(out()));
  ok('示例的第 3 行（空行）没有被编号',
     out().split('\n')[2] === '' && out().split('\n')[3] === '3. 复核上周的报销单',
     JSON.stringify(out().split('\n').slice(2, 4)));

  click('[data-clear]');
  await flush();
  ok('清空后回到空态', out() === '' && input.value === '');
  ok('清空后统计归零', statOf('输入行') === '0' && statOf('已编号') === '0');

  ok('全程无脚本错误', errors.length === 0, errors.join(' | '));
}
