/* ==========================================================================
   空白清理（whitespace-cleaner）测试
   --------------------------------------------------------------------------
   全部用真实 DOM 交互驱动：设 textarea.value + dispatch input + 等防抖，
   不直接调工具内部函数。
   期望值一律手算，不是「跑一遍看输出是多少」抄下来的。
   ========================================================================== */

import { ok, section, loadPage, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const { d, w, errors } = await loadPage('tools/whitespace-cleaner/index.html', {
    clipboard: (t) => { copied = t; }
  });

  const $ = (sel) => d.querySelector(sel);
  const input = d.getElementById('ws-input');
  const tabW = d.getElementById('ws-tab-width');

  /* 输出区渲染出的文本。renderCode 把每一行放进 .code-line-body，
     textContent 读回来会把 HTML 实体还原成原字符，正好等于清理结果。 */
  const out = () => [...d.querySelectorAll('#ws-output .code-line-body')]
    .map((e) => e.textContent).join('\n');

  const rows = () => [...d.querySelectorAll('#ws-report tbody tr')];
  const rowOf = (cp) => rows().find((tr) => tr.children[0].textContent === cp);
  const statVal = (i) => d.querySelectorAll('#ws-stats .stat')[i]
    .querySelector('.stat-value').textContent;

  const click = async (sel) => {
    $(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(30);
  };
  const setText = async (text) => {
    input.value = text;
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(170);
  };

  /* 辅助函数一律把状态**显式摆到确定取值**，不写成「不传就不动」——
     否则上一个用例留下的设置会泄漏到后面，几条正确的断言会集体报错。 */
  const setOpt = async (key, on) => {
    const chip = $(`[data-opt="${key}"]`);
    if ((chip.getAttribute('aria-pressed') === 'true') !== on) await click(`[data-opt="${key}"]`);
  };
  const setBlank = async (mode) => {
    if ($(`[data-blank="${mode}"]`).getAttribute('aria-pressed') !== 'true') {
      await click(`[data-blank="${mode}"]`);
    }
  };
  const setReveal = async (on) => {
    const btn = $('#ws-reveal');
    if ((btn.getAttribute('aria-pressed') === 'true') !== on) await click('#ws-reveal');
  };

  /** 回到「默认选项 + 指定覆盖项」，再设好输入 */
  const prep = async (text, cfg = {}) => {
    await click('#ws-reset');
    await setReveal(!!cfg.reveal);
    await setBlank(cfg.blank || 'collapse');
    for (const k of Object.keys(cfg)) {
      if (k === 'blank' || k === 'reveal') continue;
      await setOpt(k, cfg[k]);
    }
    await setText(text);
  };

  /* ---------- 1. 基本渲染 ---------- */
  section('1. 基本渲染');

  ok('无脚本错误', errors.length === 0, errors.join(' | '));
  ok('空输入时结果区显示空态', $('#ws-output .code-empty') !== null);
  ok('空输入时报告区显示空态', $('#ws-report .table-empty') !== null);
  ok('默认选项与页面 aria-pressed 一致',
     $('[data-opt="trimEnd"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-opt="trimStart"]').getAttribute('aria-pressed') === 'false' &&
     $('[data-opt="collapse"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-opt="tabs"]').getAttribute('aria-pressed') === 'false' &&
     $('[data-opt="specialSpace"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-opt="zero"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-opt="bidi"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-opt="control"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-opt="newlines"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-opt="trimEdges"]').getAttribute('aria-pressed') === 'true');
  ok('默认空行模式是「压缩为一个」',
     $('[data-blank="collapse"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-blank="keep"]').getAttribute('aria-pressed') === 'false');
  ok('制表符宽度默认 4', tabW.value === '4', tabW.value);

  /* ---------- 2. 行内空白 ---------- */
  section('2. 行内空白');

  await prep('a  \nb\t\nc');
  ok('删除行尾空白', out() === 'a\nb\nc', JSON.stringify(out()));

  await prep('   a\n\tb');
  ok('默认保留行首缩进', out() === '   a\n\tb', JSON.stringify(out()));

  await prep('   a\n\tb', { trimStart: true });
  ok('打开「行首空白」后删除缩进', out() === 'a\nb', JSON.stringify(out()));

  await prep('   a   b');
  ok('合并行内连续空格、保留行首缩进', out() === '   a b', JSON.stringify(out()));

  await prep('   a   b', { trimStart: true });
  ok('行首空白与连续空格同开时整行合并', out() === 'a b', JSON.stringify(out()));

  await prep('a\tb');
  ok('默认不动制表符', out() === 'a\tb', JSON.stringify(out()));

  /* 「连续空格」默认开着，会把手动转出来的 N 个空格再合并掉，
     所以测宽度本身时要先把它关掉；两项同开的效果单独测（见下一条）。 */
  await prep('a\tb', { tabs: true, collapse: false });
  ok('制表符转 4 个空格', out() === 'a    b', JSON.stringify(out()));

  /* 宽度改成 2：这是 select 不是胶囊，单独驱动 */
  tabW.value = '2';
  tabW.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(30);
  ok('制表符宽度可选 2', out() === 'a  b', JSON.stringify(out()));

  await prep('a\tb', { tabs: true, collapse: true });
  ok('制表符转出的空格会被「连续空格」继续合并', out() === 'a b', JSON.stringify(out()));

  /* ---------- 3. 不可见字符 ---------- */
  section('3. 不可见字符');

  await prep('a\u00A0\u00A0b\u3000c');
  ok('特殊空格转为普通空格后参与合并', out() === 'a b c', JSON.stringify(out()));

  await prep('a\u00A0\u00A0b\u3000c', { specialSpace: false });
  ok('关掉特殊空格后原样保留', out() === 'a\u00A0\u00A0b\u3000c', JSON.stringify(out()));

  await prep('a\u200Bb\uFEFFc\u200Dd');
  ok('删除零宽字符', out() === 'abcd', JSON.stringify(out()));

  await prep('a\u200Bb', { zero: false });
  ok('关掉零宽字符后保留', out() === 'a\u200Bb', JSON.stringify(out()));

  await prep('a\u200Eb\u202Ec\u2069d');
  ok('删除方向控制符', out() === 'abcd', JSON.stringify(out()));

  await prep('a\u0001b\u001Fc\u007Fd');
  ok('删除控制字符', out() === 'abcd', JSON.stringify(out()));

  await prep('a\u0001b', { control: false });
  ok('关掉控制字符后保留', out() === 'a\u0001b', JSON.stringify(out()));

  /* ---------- 4. 换行与空行 ---------- */
  section('4. 换行与空行');

  await prep('a\u2028b\u0085c\u000Bd\u000Ce');
  ok('各类换行符统一为 LF', out() === 'a\nb\nc\nd\ne', JSON.stringify(out()));

  await prep('a\u2028b', { newlines: false });
  ok('关掉换行统一后行分隔符原样保留（不会被当控制字符删掉）',
     out() === 'a\u2028b', JSON.stringify(out()));

  /* textarea 的 value 设置器会按 HTML 规范把 \r\n 规范化成 \n，
     所以走 CRLF 分支必须绕开它 —— 在实例上定义一个可写的自有属性遮蔽原型 setter。
     这是测这条分支的唯一办法，直接 setText 永远测不到 \r。 */
  await prep('placeholder');
  Object.defineProperty(input, 'value', {
    value: 'a\r\nb\r\nc', writable: true, configurable: true
  });
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(170);
  ok('CRLF 统一为 LF', out() === 'a\nb\nc', JSON.stringify(out()));

  await prep('a\n\n\n\nb');
  ok('默认把连续空行压缩为一个', out() === 'a\n\nb', JSON.stringify(out()));

  await prep('a\n\n\n\nb', { blank: 'keep' });
  ok('空行「保留」时原样不动', out() === 'a\n\n\n\nb', JSON.stringify(out()));

  await prep('a\n\n\n\nb', { blank: 'remove' });
  ok('空行「全部删除」时不留空行', out() === 'a\nb', JSON.stringify(out()));

  await prep('\n\na\n\n');
  ok('删除文档首尾空行', out() === 'a', JSON.stringify(out()));

  await prep('\n\na\n\n', { trimEdges: false });
  ok('关掉后首尾空行保留', out() === '\n\na\n\n', JSON.stringify(out()));

  /* ---------- 5. 检测报告 ---------- */
  section('5. 检测报告');

  await prep('a\u00A0b\u200Bc\u200Bd');
  ok('报告只列出出现过的字符（2 行）', rows().length === 2, String(rows().length));
  ok('零宽空格计数为 2', rowOf('U+200B')?.children[2].textContent === '2',
     rowOf('U+200B')?.children[2].textContent);
  ok('不换行空格计数为 1', rowOf('U+00A0')?.children[2].textContent === '1');
  ok('次数多的排前面', rows()[0].children[0].textContent === 'U+200B',
     rows()[0].children[0].textContent);
  ok('特殊空格标为「已转为普通空格」',
     rowOf('U+00A0')?.children[3].textContent === '已转为普通空格');
  ok('零宽字符标为「已删除」', rowOf('U+200B')?.children[3].textContent === '已删除');

  await prep('a\u00A0b\u200Bc\u200Bd', { zero: false });
  ok('关掉零宽字符后报告改标「已保留」',
     rowOf('U+200B')?.children[3].textContent === '已保留',
     rowOf('U+200B')?.children[3].textContent);
  ok('关掉后零宽字符确实留在结果里', out() === 'a b\u200Bc\u200Bd', JSON.stringify(out()));

  await prep('a\u2028b');
  ok('行分隔符标为「已统一为换行」',
     rowOf('U+2028')?.children[3].textContent === '已统一为换行',
     rowOf('U+2028')?.children[3].textContent);

  await prep('a\u0001b\u0002c');
  ok('表外的控制字符合并成一行', rows().length === 1 && rows()[0].children[0].textContent === '多种',
     rows().map((tr) => tr.children[0].textContent).join(','));
  ok('合并行的次数是各码位之和', rows()[0].children[2].textContent === '2',
     rows()[0].children[2].textContent);
  ok('合并行列出具体码位', rows()[0].children[1].textContent.includes('U+0001'));

  /* ---------- 6. 统计格 ---------- */
  section('6. 统计格');

  await prep('a  \n\n\nb');
  ok('原始字符数按码点统计', statVal(0) === '7', statVal(0));
  ok('清理后字符数正确', statVal(1) === '4', statVal(1));
  ok('字符变化显示减少 3', statVal(2) === '\u22123', statVal(2));
  ok('没有不可见字符时为 0', statVal(3) === '0', statVal(3));

  await prep('a\u200Bb\u200Bc');
  ok('不可见字符计数为 2', statVal(3) === '2', statVal(3));

  await prep('a\tb', { tabs: true, collapse: false });
  ok('制表符转空格会让字符数增加，显示 +3', statVal(2) === '+3', statVal(2));

  await prep('abc');
  ok('没有变化时显示 0', statVal(2) === '0', statVal(2));

  /* ---------- 7. 不可见字符可视化 ---------- */
  section('7. 显示不可见字符');

  await prep('a b', { reveal: true });
  const body = () => $('#ws-output .code-line-body').innerHTML;
  ok('空格显示为 ·', body().includes('\u00B7'), body());
  ok('行尾显示为 ¶', body().includes('\u00B6'), body());

  await prep('a\u200Bb', { reveal: true, zero: false });
  ok('残留的零宽字符标出码位', body().includes('U+200B'), body());
  ok('残留记号带 ws-residue 类', d.querySelector('#ws-output .ws-residue') !== null);

  copied = null;
  await click('#ws-copy');
  ok('可视化开启时复制到的仍是清理后的真实文本',
     copied === 'a\u200Bb', JSON.stringify(copied));

  await prep('a\u200Bb');
  copied = null;
  await click('#ws-copy');
  ok('普通状态下复制的是清理结果', copied === 'ab', JSON.stringify(copied));

  /* 下载在 jsdom 里没有 createObjectURL，工具应给出提示而不是崩掉 */
  let dlThrew = false;
  try { await click('#ws-download'); } catch (e) { dlThrew = true; }
  ok('点击下载不抛异常', !dlThrew);

  /* ---------- 8. 恢复默认 ---------- */
  section('8. 恢复默认与示例');

  await prep('   a  \n\n\nb', { trimStart: true, blank: 'remove', trimEdges: false });
  tabW.value = '2';
  tabW.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(30);
  ok('改动后确实生效（前置条件检查）', out() === 'a\nb', JSON.stringify(out()));

  await click('#ws-reset');
  ok('恢复默认后「行首空白」关闭',
     $('[data-opt="trimStart"]').getAttribute('aria-pressed') === 'false');
  ok('恢复默认后「零宽字符」开启',
     $('[data-opt="zero"]').getAttribute('aria-pressed') === 'true');
  ok('恢复默认后「统一为 LF」开启',
     $('[data-opt="newlines"]').getAttribute('aria-pressed') === 'true');
  ok('恢复默认后空行回到「压缩为一个」',
     $('[data-blank="collapse"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-blank="remove"]').getAttribute('aria-pressed') === 'false');
  ok('恢复默认后制表符宽度回到 4', tabW.value === '4', tabW.value);
  ok('恢复默认后结果回到默认清理', out() === '   a\n\nb', JSON.stringify(out()));

  await click('[data-demo]');
  ok('填入示例后有输出', out().length > 0);
  ok('示例里的零宽字符已清除', !out().includes('\u200B'));
  ok('示例里的软连字符与方向标记已清除',
     !out().includes('\u00AD') && !out().includes('\u200E'));
  ok('示例里的全角空格与不换行空格已清除',
     !out().includes('\u3000') && !out().includes('\u00A0'));
  ok('示例输出没有行尾空白',
     out().split('\n').every((l) => !/[ \t]$/.test(l)), JSON.stringify(out()));

  await click('[data-clear]');
  ok('清空后回到空态', $('#ws-output .code-empty') !== null && out() === '');

  ok('全程无脚本错误', errors.length === 0, errors.join(' | '));
}
