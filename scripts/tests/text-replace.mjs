/* ==========================================================================
   批量查找替换（text-replace）测试
   --------------------------------------------------------------------------
   全部用真实 DOM 交互驱动：设 value / select.value + dispatchEvent + 等防抖，
   不直接调工具内部函数。

   第 3 节是重点：自研的「$ 展开 + exec 循环」**逐例与平台 String.replace 交叉校验**。
   这一节不写手算期望值 —— 期望值就是平台自己的输出，能钉住所有 $ 引用与空匹配细节。
   ========================================================================== */

import { ok, section, loadPage, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const { d, w, errors } = await loadPage('tools/text-replace/index.html', {
    clipboard: (t) => { copied = t; }
  });

  const $ = (sel) => d.querySelector(sel);
  const input = d.getElementById('tr-input');
  const outEl = d.getElementById('tr-output');
  const rulesEl = d.getElementById('tr-rules');

  const out = () => outEl.textContent;
  const ruleRows = () => [...d.querySelectorAll('#tr-rules .tr-rule')];
  const repRows = () => [...d.querySelectorAll('#tr-rule-report tbody tr')];
  const repCell = (i, j) => (repRows()[i] ? repRows()[i].children[j].textContent : null);
  const hitRows = () => [...d.querySelectorAll('#tr-hits tbody tr')];
  const hitCell = (i, j) => (hitRows()[i] ? hitRows()[i].children[j].textContent : null);

  const statOf = (label) => {
    const cell = [...d.querySelectorAll('#tr-stats .stat')]
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
     否则上一个用例留下的设置会泄漏到后面。 */
  const setFlags = (cfg) => {
    ['ignoreCase', 'wholeWord', 'flagM', 'flagS', 'flagU'].forEach((k) => {
      const chip = $(`[data-toggle="${k}"]`);
      const want = !!cfg[k];
      if ((chip.getAttribute('aria-pressed') === 'true') !== want) click(chip);
    });
  };

  /** 往第 i 条规则里填字段（只填传了的那几项，避免覆盖） */
  const fillRule = (i, cfg) => {
    const row = ruleRows()[i];
    if (!row) return;
    if (cfg.mode) {
      const s = row.querySelector('[data-field="mode"]');
      s.value = cfg.mode;
      s.dispatchEvent(new w.Event('change', { bubbles: true }));
    }
    if (cfg.find !== undefined) {
      const e = row.querySelector('[data-field="find"]');
      e.value = cfg.find;
      e.dispatchEvent(new w.Event('input', { bubbles: true }));
    }
    if (cfg.repl !== undefined) {
      const e = row.querySelector('[data-field="repl"]');
      e.value = cfg.repl;
      e.dispatchEvent(new w.Event('input', { bubbles: true }));
    }
  };

  /** 回到「默认选项 + 指定规则」，再设好输入 */
  const prep = async (text, cfg = {}) => {
    click('#tr-reset');
    setFlags(cfg);
    const rules = cfg.rules || [{ find: cfg.find, repl: cfg.repl, mode: cfg.mode }];

    while (ruleRows().length < rules.length) click('#tr-add');
    while (ruleRows().length > rules.length) {
      const rows = ruleRows();
      click(rows[rows.length - 1].querySelector('[data-act="del"]'));
    }
    rules.forEach((r, i) => {
      if (r.enabled === false) click(ruleRows()[i].querySelector('[data-act="toggle"]'));
      fillRule(i, r);
    });
    await setText(text);
  };

  /* ---------- 1. 基本渲染 ---------- */
  section('1. 基本渲染');

  ok('无脚本错误', errors.length === 0, errors.join(' | '));
  ok('默认只有一条空规则', ruleRows().length === 1, String(ruleRows().length));
  ok('空规则的「方式」默认是纯文本',
     ruleRows()[0].querySelector('[data-field="mode"]').value === 'text');
  ok('默认所有开关都关',
     ['ignoreCase', 'wholeWord', 'flagM', 'flagS', 'flagU']
       .every((k) => $(`[data-toggle="${k}"]`).getAttribute('aria-pressed') === 'false'));
  ok('空输入时结果区为空、占位文案在',
     out() === '' && outEl.getAttribute('data-placeholder').includes('替换结果'));
  ok('只有一条规则时上下移都禁用',
     ruleRows()[0].querySelector('[data-act="up"]').disabled === true &&
     ruleRows()[0].querySelector('[data-act="down"]').disabled === true);
  ok('禁用按钮把原因写进了 title',
     ruleRows()[0].querySelector('[data-act="up"]').title === '已经是第一条',
     ruleRows()[0].querySelector('[data-act="up"]').title);
  ok('统计初始为 0', statOf('命中总数') === '0' && statOf('生效规则') === '0 / 1');
  ok('规则表显示未填查找内容', repCell(0, 4) === '未填查找内容', repCell(0, 4));
  ok('没有输入时命中清单是空态', $('#tr-hits .table-empty') !== null);
  ok('规则表有 5 列',
     $('#tr-rule-report thead tr').children.length === 5,
     String($('#tr-rule-report thead tr').children.length));

  /* ---------- 2. 纯文本模式 ---------- */
  section('2. 纯文本模式');

  await prep('hello world', { find: 'o', repl: '0' });
  ok('全部命中都被替换', out() === 'hell0 w0rld', JSON.stringify(out()));
  ok('命中总数', statOf('命中总数') === '2', statOf('命中总数'));
  ok('生效规则', statOf('生效规则') === '1 / 1', statOf('生效规则'));

  await prep('hello world', { find: 'l', repl: '' });
  ok('替换内容留空表示删除', out() === 'heo word', JSON.stringify(out()));

  await prep('a(b', { find: '(', repl: '[' });
  ok('查找内容按字面匹配，元字符不用转义', out() === 'a[b', JSON.stringify(out()));

  await prep('aaa', { find: 'aa', repl: 'b' });
  ok('不重叠：aaa 里的 aa 只替换一次', out() === 'ba', JSON.stringify(out()));

  /* 平台即使查找是字符串也会展开替换里的 $ —— 纯文本模式必须不展开，
     这一条是这个工具「自己走 exec 循环」的主要理由。 */
  await prep('a1b', { find: '1', repl: '$&' });
  ok('纯文本模式的替换内容按字面写入（$& 不展开）',
     out() === 'a$&b', JSON.stringify(out()));
  ok('对照：平台的 String.replace 会展开成别的东西',
     'a1b'.replace('1', '$&') === 'a1b', JSON.stringify('a1b'.replace('1', '$&')));
  await prep('a1b', { find: '1', repl: '$1' });
  ok('纯文本模式下 $1 也是字面', out() === 'a$1b', JSON.stringify(out()));

  /* ---------- 3. 交叉校验：正则模式的 $ 展开与空匹配 ---------- */
  section('3. 与平台 String.replace 交叉校验');

  /* 期望值直接取平台自己的输出。替换内容里刻意不含反斜杠 ——
     工具会先解掉 \t / \n / \\，含反斜杠的样本要单独测（见下一节）。 */
  const CASES = [
    ['abc', '(b)', '[$1]', ''],
    ['abc', '(b)', '$&!', ''],
    ['abc', '(b)', '$$', ''],
    ['abc', '(b)', '$0', ''],
    ['abc', '(b)', "$'", ''],
    ['abc', '(b)', '$`', ''],
    ['abc', '(b)', '$2', ''],
    ['abc', 'b', '$2', ''],
    ['abc', '(b)', '$', ''],
    ['abc', '(b)', '$x', ''],
    ['abc', '(b)', '$$$1', ''],
    ['2026-09-29', '(\\d{4})-(\\d{2})-(\\d{2})', '$3/$2/$1', ''],
    ['a1b2', '(?<L>[a-z])(?<N>\\d)', '$<N>$<L>', ''],
    ['a1', '(?<L>[a-z])(?<N>\\d)', '$<Q>', ''],
    ['abc', '(?<L>a)', '$<L', ''],
    ['abc', '(a)', '$<$1>', ''],
    ['abc', '(a)(b)?', '[$2]', ''],
    ['ac', '(a)(b)?(c)', '[$2]', ''],
    ['abc', '(a)(b)(c)', '$12', ''],
    ['abc', '(a)(b)(c)', '$1$2', ''],
    ['abc', '(a)(b)', '$12', ''],
    ['abc', '(a)', '$10', ''],
    ['abc', '(a)', '$99', ''],
    ['abc', '(a)', '$1$1$1', ''],
    ['XaY', 'a', '[$&]', ''],
    ['ab', 'a', "x$`y", ''],
    ['ab', 'a', "x$'y", ''],
    ['aaa', '(a)', '$&-$&', ''],
    ['xyz', '(\\w)(\\w)(\\w)', '$3$2$1', ''],
    /* 空匹配：这是最容易写错的一类，平台的推进规则要逐字对上 */
    ['bbb', 'a*', '-', ''],
    ['abc', 'x*', '-', ''],
    ['aa', 'a*', '-', ''],
    ['aXbXc', 'X*', '.', ''],
    ['ab', '(?:)', '|', ''],
    /* 标志位 */
    ['AbC', 'abc', 'x', 'i'],
    ['AbC', 'abc', 'x', ''],
    ['a\nb\nc', '^', '> ', 'm'],
    ['a\nb\nc', '^', '> ', ''],
    ['a\nb', 'a.b', 'X', 's'],
    ['a\nb', 'a.b', 'X', ''],
    /* u 标志下的空匹配按码点推进 */
    ['\u{1F600}ab', 'x*', '-', 'u'],
    ['\u{1F600}ab', 'x*', '-', '']
  ];

  await prep('x', {});   /* 先把规则与开关摆到默认，下面逐例覆盖 */
  for (const [text, pattern, repl, flags] of CASES) {
    setFlags({
      ignoreCase: flags.indexOf('i') >= 0,
      flagM: flags.indexOf('m') >= 0,
      flagS: flags.indexOf('s') >= 0,
      flagU: flags.indexOf('u') >= 0
    });
    fillRule(0, { mode: 'regex', find: pattern, repl: repl });
    await setText(text);

    const expect = text.replace(new RegExp(pattern, 'g' + flags), repl);
    const label = JSON.stringify(pattern) + ' → ' + JSON.stringify(repl) + (flags ? ' [' + flags + ']' : '');
    ok('交叉校验 ' + label, out() === expect,
       JSON.stringify(out()) + ' ≠ ' + JSON.stringify(expect));
  }

  /* 空输入不参与处理：空正则能在空串上命中一次，报出来会很奇怪 */
  await prep('', { mode: 'regex', find: 'a*', repl: '-' });
  ok('空输入不做任何替换（也不算命中）',
     out() === '' && statOf('命中总数') === '0', JSON.stringify(out()) + '/' + statOf('命中总数'));

  /* ---------- 4. 转义 ---------- */
  section('4. 查找与替换里的转义');

  await prep('a\tb', { find: '\\t', repl: ' ' });
  ok('查找内容里的 \\t 是制表符', out() === 'a b', JSON.stringify(out()));

  await prep('a,b,c', { find: ',', repl: '\\n' });
  ok('替换内容里的 \\n 是换行', out() === 'a\nb\nc', JSON.stringify(out()));

  await prep('a\nb\nc', { find: '\\n', repl: ' ' });
  ok('查找内容里的 \\n 是换行（把多行接成一行）',
     out() === 'a b c', JSON.stringify(out()));

  await prep('a', { find: 'a', repl: '\\\\' });
  ok('替换内容里的 \\\\ 是一个反斜杠', out() === '\\', JSON.stringify(out()));

  await prep('a\\b', { find: '\\\\', repl: '/' });
  ok('查找内容里的 \\\\ 是一个反斜杠', out() === 'a/b', JSON.stringify(out()));

  /* 正则规则的查找内容由引擎解释，不做这层转义 */
  await prep('a\tb', { mode: 'regex', find: '\\t', repl: '-' });
  ok('正则规则的 \\t 由正则引擎解释', out() === 'a-b', JSON.stringify(out()));

  await prep('a.b', { mode: 'regex', find: '\\.', repl: '/' });
  ok('正则规则里 \\. 不会被二次转义成字面的反斜杠点',
     out() === 'a/b', JSON.stringify(out()));

  /* ---------- 5. 匹配选项 ---------- */
  section('5. 忽略大小写与全词匹配');

  await prep('Cat cat CAT', { find: 'cat', repl: 'X' });
  ok('默认区分大小写', out() === 'Cat X CAT', JSON.stringify(out()));

  await prep('Cat cat CAT', { find: 'cat', repl: 'X', ignoreCase: true });
  ok('忽略大小写后三处都换', out() === 'X X X', JSON.stringify(out()));

  await prep('cat scatter', { find: 'cat', repl: 'X' });
  ok('不开全词匹配时会命中 scatter 里的 cat',
     out() === 'X sXter', JSON.stringify(out()));

  await prep('cat scatter', { find: 'cat', repl: 'X', wholeWord: true });
  ok('全词匹配不碰 scatter', out() === 'X scatter', JSON.stringify(out()));

  await prep('cat scatter', { mode: 'regex', find: 'cat', repl: 'X', wholeWord: true });
  ok('全词匹配对正则规则同样生效', out() === 'X scatter', JSON.stringify(out()));

  /* \b 只认 ASCII 词字符 —— 对纯中文的查找内容必然不生效，必须点出来 */
  await prep('\u82F9\u679C', { find: '\u82F9\u679C', repl: 'X', wholeWord: true });
  ok('中文查找 + 全词匹配时不生效（\\b 对中文不成立）',
     out() === '\u82F9\u679C', JSON.stringify(out()));
  ok('这件事写在状态行里', $('#tr-warn .is-warn') !== null &&
     $('#tr-warn').textContent.includes('全词匹配'), $('#tr-warn').textContent);

  await prep('cat', { find: 'cat', repl: 'X', wholeWord: true });
  ok('ASCII 查找时不提示', $('#tr-warn .is-warn') === null, $('#tr-warn').textContent);

  /* ---------- 6. 正则标志 ---------- */
  section('6. 正则标志');

  await prep('a\nb', { mode: 'regex', find: '^', repl: '# ' });
  ok('不开多行时 ^ 只命中开头', out() === '# a\nb', JSON.stringify(out()));

  await prep('a\nb\nc', { mode: 'regex', find: '^', repl: '# ', flagM: true });
  ok('多行模式下 ^ 命中每一行', out() === '# a\n# b\n# c', JSON.stringify(out()));

  await prep('a\nb', { mode: 'regex', find: 'a.b', repl: 'X' });
  ok('不开点号跨行时 a.b 跨不过换行', out() === 'a\nb', JSON.stringify(out()));

  await prep('a\nb', { mode: 'regex', find: 'a.b', repl: 'X', flagS: true });
  ok('点号跨行后 a.b 能匹配', out() === 'X', JSON.stringify(out()));

  await prep('a', { mode: 'regex', find: '\\p{Script=Han}', repl: 'X', flagU: true });
  ok('Unicode 模式下 \\p{} 可用（输入里没有汉字所以没命中）',
     out() === 'a' && statOf('命中总数') === '0');

  await prep('\u6C49', { mode: 'regex', find: '\\p{Script=Han}', repl: 'X', flagU: true });
  ok('Unicode 模式下 \\p{Script=Han} 命中汉字', out() === 'X', JSON.stringify(out()));

  await prep('a', { mode: 'regex', find: '\\p{Script=Han}', repl: 'X' });
  ok('不开 Unicode 时 \\p{} 不报错但被当成字面的 p（一个汉字都匹配不到）',
     $('#tr-warn .is-error') === null && out() === 'a' && statOf('命中总数') === '0',
     JSON.stringify(out()) + '/' + statOf('命中总数'));
  ok('这种静默失效会被点出来', $('#tr-warn .is-warn') !== null &&
     $('#tr-warn').textContent.includes('Unicode'), $('#tr-warn').textContent);

  /* ---------- 7. 多条规则与顺序 ---------- */
  section('7. 多条规则与顺序');

  await prep('a b', { rules: [
    { mode: 'text', find: 'a', repl: 'b' },
    { mode: 'text', find: 'b', repl: 'c' }
  ] });
  ok('第二条规则在第一条的结果上继续', out() === 'c c', JSON.stringify(out()));
  ok('两条规则都算生效', statOf('生效规则') === '2 / 2', statOf('生效规则'));

  await prep('a b', { rules: [
    { mode: 'text', find: 'b', repl: 'c' },
    { mode: 'text', find: 'a', repl: 'b' }
  ] });
  ok('换个顺序结果就不同（顺序真的生效）', out() === 'b c', JSON.stringify(out()));

  await prep('a b', { rules: [
    { mode: 'text', find: 'a', repl: 'b' },
    { mode: 'text', find: 'b', repl: 'c' }
  ] });
  click(ruleRows()[1].querySelector('[data-act="up"]'));
  await flush();
  ok('上移之后用新顺序重算', out() === 'b c', JSON.stringify(out()));
  ok('上移之后规则表的查找列跟着换',
     repCell(0, 1) === 'b' && repCell(1, 1) === 'a',
     repCell(0, 1) + '/' + repCell(1, 1));

  click(ruleRows()[0].querySelector('[data-act="down"]'));
  await flush();
  ok('下移能移回去', out() === 'c c', JSON.stringify(out()));
  ok('第一行的上移按钮回到禁用',
     ruleRows()[0].querySelector('[data-act="up"]').disabled === true);

  await prep('a b', { rules: [
    { mode: 'text', find: 'a', repl: 'b' },
    { mode: 'text', find: 'b', repl: 'c' }
  ] });
  click(ruleRows()[0].querySelector('[data-act="del"]'));
  await flush();
  ok('删掉第一条后只剩一条', ruleRows().length === 1, String(ruleRows().length));
  ok('删除后结果只剩第二条规则的效果', out() === 'a c', JSON.stringify(out()));

  click('#tr-add');
  await flush();
  ok('添加规则后多一行', ruleRows().length === 2, String(ruleRows().length));
  ok('新规则的查找框获得焦点',
     d.activeElement === ruleRows()[1].querySelector('[data-field="find"]'));

  await prep('aaa', { rules: [
    { mode: 'text', find: 'a', repl: 'b' },
    { mode: 'text', find: 'b', repl: 'c', enabled: false }
  ] });
  ok('禁用第二条规则后只剩第一条生效', out() === 'bbb', JSON.stringify(out()));
  ok('禁用状态写进 aria-pressed 与状态列',
     ruleRows()[1].querySelector('[data-act="toggle"]').getAttribute('aria-pressed') === 'false' &&
     repCell(1, 4) === '未启用', repCell(1, 4));
  ok('生效规则只算启用的', statOf('生效规则') === '1 / 1', statOf('生效规则'));

  /* ---------- 8. 规则表与命中清单 ---------- */
  section('8. 规则表与命中清单');

  await prep('a\nb\nc', { rules: [
    { mode: 'text', find: '\\n', repl: ' ' },
    { mode: 'text', find: 'c', repl: 'C' }
  ] });
  ok('两条规则的命中数各自统计',
     repCell(0, 3) === '2' && repCell(1, 3) === '1',
     repCell(0, 3) + '/' + repCell(1, 3));
  ok('命中清单按规则顺序排列',
     hitRows().length === 3 && hitCell(0, 0) === '规则 1' && hitCell(2, 0) === '规则 2',
     String(hitRows().length) + '/' + hitCell(0, 0));
  ok('第二条规则的行号以它执行时的文本为准（本来在第 3 行，换行被去掉后是第 1 行）',
     hitCell(2, 1) === '1', hitCell(2, 1));
  ok('命中清单的底栏说明了这条口径',
     $('#tr-hit-foot').textContent.includes('以该条规则执行时的文本为准'),
     $('#tr-hit-foot').textContent);

  await prep('a\tb\ta\tb', { find: '\\t', repl: '-' });
  ok('命中清单有 3 列',
     $('#tr-hits thead tr').children.length === 3,
     String($('#tr-hits thead tr').children.length));
  ok('命中清单里的制表符显示成 →',
     hitRows().length === 3 && hitCell(0, 2) === '\u2192',
     hitRows().length + '/' + hitCell(0, 2));

  await prep('aaa\nbbb', { mode: 'regex', find: 'z*', repl: '!' });
  ok('空匹配在清单里标成「（空匹配）」',
     hitRows().some((r) => r.children[2].textContent === '（空匹配）'),
     hitRows().map((r) => r.children[2].textContent).join(','));

  await prep('bbb', { mode: 'regex', find: 'a*', repl: '-' });
  ok('a* 在 bbb 上有 4 处命中（含末尾空匹配），结果是 -b-b-b-',
     statOf('命中总数') === '4' && out() === '-b-b-b-',
     statOf('命中总数') + '/' + JSON.stringify(out()));

  await prep('x', { find: 'zzz', repl: 'y' });
  ok('没有命中时状态列写「没有命中」', repCell(0, 4) === '没有命中', repCell(0, 4));
  ok('没有命中时状态列带琥珀色类', d.querySelector('#tr-rule-report .tr-hit-none') !== null);
  ok('没有命中时打印提示', $('#tr-out-foot').textContent.includes('没有命中'),
     $('#tr-out-foot').textContent);
  ok('没有命中时命中清单是空态', $('#tr-hits .table-empty') !== null);

  /* ---------- 9. 错误与跳过 ---------- */
  section('9. 错误与跳过');

  await prep('abc', { mode: 'regex', find: '(', repl: 'X' });
  ok('正则编译失败时报错', $('#tr-warn .is-error') !== null, $('#tr-warn').textContent);
  ok('报错指明是第几条规则',
     $('#tr-warn').textContent.includes('第 1 条规则'), $('#tr-warn').textContent);
  ok('引擎原文保留在 .err-raw 里便于搜索',
     $('#tr-warn .err-raw') !== null && $('#tr-warn .err-raw').textContent.length > 0,
     $('#tr-warn .err-raw') ? $('#tr-warn .err-raw').textContent : '（没有）');
  ok('该规则被跳过，输出与输入相同', out() === 'abc', JSON.stringify(out()));
  ok('规则表标为「正则有误」', repCell(0, 4) === '正则有误', repCell(0, 4));

  await prep('abc', { rules: [
    { mode: 'regex', find: '(', repl: 'X' },
    { mode: 'text', find: 'b', repl: 'B' }
  ] });
  ok('一条正则有误不影响别的规则继续跑', out() === 'aBc', JSON.stringify(out()));
  ok('底栏写明有几条正则有误', $('#tr-foot').textContent.includes('正则有误'),
     $('#tr-foot').textContent);

  await prep('abc', { find: '', repl: 'X' });
  ok('没填查找内容的规则被跳过', out() === 'abc', JSON.stringify(out()));
  ok('规则表说明它没做事', repCell(0, 4) === '未填查找内容', repCell(0, 4));

  /* ---------- 10. 统计与结果底栏 ---------- */
  section('10. 统计');

  await prep('abc', { find: 'b', repl: 'XX' });
  ok('输入字符 3', statOf('输入字符') === '3', statOf('输入字符'));
  ok('输出字符 4', statOf('输出字符') === '4', statOf('输出字符'));
  ok('结果底栏给出字符变化',
     $('#tr-out-foot').textContent.includes('3 字符') &&
     $('#tr-out-foot').textContent.includes('4 字符'), $('#tr-out-foot').textContent);

  await prep('abc', { find: 'z', repl: 'X' });
  ok('命中 0 次的规则状态是「没有命中」而不是「已应用」',
     repCell(0, 4) === '没有命中', repCell(0, 4));

  await prep('abc', { rules: [] , find: 'a', repl: 'b' });
  ok('规则被删空时也能正常工作', out() === 'abc', JSON.stringify(out()));
  ok('规则表是空态', $('#tr-rule-report .table-empty') !== null);

  /* ---------- 11. 复制与下载 ---------- */
  section('11. 复制与下载');

  await prep('a\nb', { find: 'a', repl: 'A' });
  copied = null;
  click('[data-copy-target="#tr-output"]');
  await flush();
  ok('复制拿到替换后的文本', copied === 'A\nb', JSON.stringify(copied));

  let dlThrew = false;
  try { click('#tr-download'); await flush(); } catch (e) { dlThrew = true; }
  ok('点击下载不抛异常', !dlThrew);

  /* ---------- 12. 示例 / 清空 / 恢复默认 ---------- */
  section('12. 示例、清空与恢复默认');

  click('[data-demo]');
  await flush();
  ok('示例带出三条规则', ruleRows().length === 3, String(ruleRows().length));
  ok('示例的输出正确',
     out() === '订单\tORD-1001\t金额 ¥1,200.00\n' +
               '订单\tORD-1002\t金额 ¥980.50\n' +
               '订单\tORD-1003\t金额 ¥12,345.00',
     JSON.stringify(out()));
  ok('示例共 12 处命中（6 + 3 + 3）', statOf('命中总数') === '12', statOf('命中总数'));
  ok('示例三条规则都生效', statOf('生效规则') === '3 / 3', statOf('生效规则'));
  ok('示例的状态行没有告警', $('#tr-warn').textContent === '', $('#tr-warn').textContent);
  ok('示例里正则规则的方式选中了「正则」',
     ruleRows()[0].querySelector('[data-field="mode"]').value === 'regex');

  click('#tr-reset');
  await flush();
  ok('恢复默认后只剩一条空规则',
     ruleRows().length === 1 && ruleRows()[0].querySelector('[data-field="find"]').value === '',
     String(ruleRows().length));
  ok('恢复默认后开关都关',
     ['ignoreCase', 'wholeWord', 'flagM', 'flagS', 'flagU']
       .every((k) => $(`[data-toggle="${k}"]`).getAttribute('aria-pressed') === 'false'));
  ok('恢复默认后输出与输入相同', out() === input.value, JSON.stringify(out().slice(0, 20)));

  await prep('abc', { find: 'b', repl: 'X' });
  click('[data-clear]');
  await flush();
  ok('清空后回到空态', out() === '' && input.value === '');
  ok('清空后统计归零', statOf('命中总数') === '0' && statOf('输入字符') === '0');
  ok('清空后命中清单回到空态', $('#tr-hits .table-empty') !== null);
  ok('清空后规则仍在（只清文本）', ruleRows().length === 1);

  ok('全程无脚本错误', errors.length === 0, errors.join(' | '));
}
