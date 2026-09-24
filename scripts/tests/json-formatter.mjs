/* ==========================================================================
   JSON 格式化
   移植自 Praticulus 的 json-formatter，重点验证重写后的语法高亮，
   以及上游因「先转义再匹配」而完全失效的着色问题。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/json-formatter/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;

  const $ = (sel) => d.querySelector(sel);
  const status = () => d.getElementById('jf-status').textContent.trim();
  const statusHtml = () => d.getElementById('jf-status').innerHTML;
  const mode = () => d.getElementById('jf-mode').textContent;
  const stats = () => {
    const out = {};
    for (const s of d.querySelectorAll('#jf-stats .stat')) {
      out[s.querySelector('.stat-label').textContent] = s.querySelector('.stat-value').textContent;
    }
    return out;
  };
  const bodies = () => [...d.querySelectorAll('#jf-output .code-line-body')];
  const lineText = (i) => (bodies()[i] || {}).textContent;
  const lineHtml = (i) => (bodies()[i] || {}).innerHTML;
  const lineCount = () => bodies().length;

  const setInput = async (text) => {
    const el = d.getElementById('jf-input');
    el.value = text;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const click = async (sel, wait = 40) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('显示空状态提示', $('#jf-output .code-empty') !== null);
  ok('模式徽章为 —', mode() === '—', mode());
  ok('统计面板 6 项', count(d, '#jf-stats .stat') === 6, String(count(d, '#jf-stats .stat')));
  ok('统计初始为 0', stats()['键总数'] === '0' && stats()['最大层级'] === '0',
     JSON.stringify(stats()));

  /* ---------- 2. 载入示例并格式化 ---------- */
  section('2. 载入示例 / 格式化');
  await click('[data-demo]', 60);

  const demoText = d.getElementById('jf-input').value;
  const expected = JSON.stringify(JSON.parse(demoText), null, 2);
  const expectedLines = expected.split('\n').length;

  ok('状态显示合法', $('#jf-status .is-ok') !== null, status());
  ok('模式徽章为已格式化', mode() === '已格式化', mode());
  ok(`输出 ${expectedLines} 行`, lineCount() === expectedLines, String(lineCount()));
  ok('每行都有行号',
     [...d.querySelectorAll('#jf-output .code-line-num')].map((n) => n.textContent)[0] === '1');
  ok('复制目标保存了原始文本',
     d.getElementById('jf-output-text').textContent === expected);

  /* ---------- 3. 语法高亮（上游完全失效的部分） ---------- */
  section('3. 语法高亮');
  ok('键名有着色', count(d, '#jf-output .tok-key') > 0,
     String(count(d, '#jf-output .tok-key')));
  ok('字符串值有着色', count(d, '#jf-output .tok-str') > 0,
     String(count(d, '#jf-output .tok-str')));
  ok('数字有着色', count(d, '#jf-output .tok-num') > 0,
     String(count(d, '#jf-output .tok-num')));
  ok('布尔与 null 有着色', count(d, '#jf-output .tok-bool') > 0,
     String(count(d, '#jf-output .tok-bool')));

  const keyTexts = [...d.querySelectorAll('#jf-output .tok-key')].map((x) => x.textContent);
  ok('键名列表正确', keyTexts.includes('"name"') && keyTexts.includes('"version"'),
     JSON.stringify(keyTexts.slice(0, 5)));
  ok('没有把 &quot; 当键名', !keyTexts.some((k) => k.includes('&quot;')), JSON.stringify(keyTexts.slice(0, 3)));

  const strTexts = [...d.querySelectorAll('#jf-output .tok-str')].map((x) => x.textContent);
  ok('字符串值列表正确', strTexts.includes('"工具箱"') && strTexts.includes('"hyperkitakami"'),
     JSON.stringify(strTexts.slice(0, 5)));

  /* ---------- 4. 回归：字符串里的数字不能被当成数字 ---------- */
  section('4. 回归：字符串内的数字不着色');
  await setInput('{"note": "time: 9", "n": 42}');
  await click('#jf-format', 60);

  const noteLine = bodies().find((b) => b.textContent.includes('note'));
  ok('note 行存在', !!noteLine);
  ok('字符串值整体着色（含冒号与数字）',
     noteLine.querySelector('.tok-str') !== null &&
     noteLine.querySelector('.tok-str').textContent === '"time: 9"',
     noteLine.innerHTML);
  ok('字符串里没有混入数字着色',
     noteLine.querySelector('.tok-str').querySelector('.tok-num') === null,
     noteLine.innerHTML);
  ok('键名着色正确',
     noteLine.querySelector('.tok-key').textContent === '"note"', noteLine.innerHTML);
  ok('真实数字仍然着色',
     (bodies().find((b) => b.textContent.includes('"n"')) || {}).querySelector
       ? bodies().find((b) => b.textContent.includes('"n"')).querySelector('.tok-num').textContent === '42'
       : false);

  /* ---------- 5. 回归：数组元素也要着色（上游只处理冒号后的值） ---------- */
  section('5. 回归：数组元素着色');
  await setInput('[1, "x", true, null, -2.5, 1e3]');
  await click('#jf-format', 60);

  ok('数组元素：数字着色',
     lineHtml(1).includes('tok-num') && lineText(1).trim() === '1,', lineHtml(1));
  ok('数组元素：字符串着色',
     lineHtml(2).includes('tok-str') && lineText(2).trim() === '"x",', lineHtml(2));
  ok('数组元素：true 着色',
     lineHtml(3).includes('tok-bool') && lineText(3).trim() === 'true,', lineHtml(3));
  ok('数组元素：null 着色',
     lineHtml(4).includes('tok-bool') && lineText(4).trim() === 'null,', lineHtml(4));
  ok('负数着色', lineHtml(5).includes('tok-num') && lineText(5).trim() === '-2.5,', lineHtml(5));
  ok('科学计数法着色', lineHtml(6).includes('tok-num') && lineText(6).trim() === '1000', lineText(6));
  ok('数组元素着色数量正确',
     count(d, '#jf-output .tok-num') === 3 && count(d, '#jf-output .tok-bool') === 2 &&
     count(d, '#jf-output .tok-str') === 1,
     `num=${count(d, '#jf-output .tok-num')} bool=${count(d, '#jf-output .tok-bool')} str=${count(d, '#jf-output .tok-str')}`);

  /* ---------- 6. 统计 ---------- */
  section('6. 结构统计');
  await click('[data-demo]', 60);
  ok('根类型为 Object', stats()['根类型'] === 'Object', stats()['根类型']);
  ok('键总数 15', stats()['键总数'] === '15', stats()['键总数']);
  ok('最大层级 3', stats()['最大层级'] === '3', stats()['最大层级']);
  ok('对象数 4', stats()['对象'] === '4', stats()['对象']);
  ok('数组数 1', stats()['数组'] === '1', stats()['数组']);
  ok('行数与渲染一致', stats()['行数'] === String(lineCount()), stats()['行数']);

  await setInput('[1, 2, 3]');
  await click('#jf-format', 60);
  ok('根类型为 Array', stats()['根类型'] === 'Array', stats()['根类型']);
  ok('数组状态文案正确', status().includes('3 个元素'), status());

  /* ---------- 7. 压缩 ---------- */
  section('7. 压缩');
  await setInput('{\n  "a": 1,\n  "b": [1, 2],\n  "c": "x"\n}');
  await click('#jf-minify', 60);
  ok('模式徽章为已压缩', mode() === '已压缩', mode());
  ok('输出为单行', lineCount() === 1, String(lineCount()));
  ok('输出无多余空白', lineText(0) === '{"a":1,"b":[1,2],"c":"x"}', lineText(0));
  ok('状态提示节省字符', status().includes('省'), status());

  /* ---------- 8. 缩进 ---------- */
  section('8. 缩进设置');
  await setInput('{"a": {"b": 1}}');
  await click('#jf-format', 60);
  ok('默认 2 空格', lineText(1) === '  "a": {', JSON.stringify(lineText(1)));

  const indent = d.getElementById('jf-indent');
  indent.value = '4';
  indent.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(60);
  ok('切到 4 空格后重新排版', lineText(1) === '    "a": {', JSON.stringify(lineText(1)));

  indent.value = 'tab';
  indent.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(60);
  ok('切到 Tab 后使用制表符', lineText(1) === '\t"a": {', JSON.stringify(lineText(1)));

  indent.value = '2';
  indent.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(60);

  /* ---------- 9. 校验与报错 ---------- */
  section('9. 校验与中文报错');

  await setInput('{"a": 1}');
  await click('#jf-validate', 60);
  ok('合法时显示 ✓', $('#jf-status .is-ok') !== null, status());
  ok('校验不改动输出区（仍是上一次的结果）', mode() === '已格式化', mode());

  await setInput('{');
  await click('#jf-format', 60);
  ok('不完整 JSON 报错', $('#jf-status .is-error') !== null, status());
  ok('报错带行列号', status().includes('第 1 行，第 2 列'), status());
  ok('报错翻译成中文', status().includes('属性名'), status());
  ok('保留原始英文信息', $('#jf-status .err-raw') !== null &&
     $('#jf-status .err-raw').textContent.includes('Expected'), statusHtml());

  await setInput('{"a":1,}');
  await click('#jf-format', 60);
  ok('尾随逗号报错带行列', status().includes('第 1 行，第 8 列'), status());
  ok('尾随逗号提示提到尾随逗号', status().includes('尾随逗号'), status());

  await setInput('{a:1}');
  await click('#jf-format', 60);
  ok('键名缺引号报错', status().includes('属性名'), status());

  await setInput('{"a": "x\ty"}');
  await click('#jf-format', 60);
  ok('控制字符报错并给出正确写法', status().includes('\\t'), status());

  await setInput('[1,2,]');
  await click('#jf-format', 60);
  ok('无位置信息的报错也能处理', status().includes('意料之外'), status());

  /* ---------- 10. 自动换行 ---------- */
  section('10. 自动换行');
  ok('默认开启', d.getElementById('jf-output').className.includes('code-view--wrap'));
  const wrap = d.getElementById('jf-wrap');
  wrap.checked = false;
  wrap.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(30);
  ok('可关闭', !d.getElementById('jf-output').className.includes('code-view--wrap'));
  wrap.checked = true;
  wrap.dispatchEvent(new w.Event('change', { bubbles: true }));

  /* ---------- 11. 复制与清空 ---------- */
  section('11. 复制与清空');
  await setInput('{"a":1}');
  await click('#jf-format', 60);
  copied = null;
  await click('[data-copy-target="#jf-output-text"]', 60);
  ok('复制的是格式化后的文本',
     copied === '{\n  "a": 1\n}', JSON.stringify(copied));

  await click('[data-clear]', 60);
  ok('清空后回到空状态', $('#jf-output .code-empty') !== null);
  ok('清空后输入框为空', d.getElementById('jf-input').value === '');
  ok('清空后统计归零', stats()['键总数'] === '0', stats()['键总数']);
  ok('清空后状态行清空', status() === '', JSON.stringify(status()));

  /* ---------- 12. 边界 ---------- */
  section('12. 边界情况');
  await setInput('   ');
  await click('#jf-format', 60);
  ok('只有空白时视为空', $('#jf-output .code-empty') !== null);

  await setInput('"just a string"');
  await click('#jf-format', 60);
  ok('标量根节点可格式化', lineText(0) === '"just a string"', lineText(0));
  ok('标量根类型正确', stats()['根类型'] === 'string', stats()['根类型']);

  await setInput('{"a":1}');
  const inp = d.getElementById('jf-input');
  inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  await sleep(60);
  ok('Ctrl+Enter 触发格式化', mode() === '已格式化', mode());

  await setInput('{"中文键": "中文值", "emoji": "🎉"}');
  await click('#jf-format', 60);
  ok('中文键名可着色',
     [...d.querySelectorAll('#jf-output .tok-key')].some((k) => k.textContent === '"中文键"'));
  ok('emoji 未被拆坏', d.getElementById('jf-output').textContent.includes('🎉'));

  /* ---------- 13. 页面结构 ---------- */
  section('13. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('页面注明了来源与许可',
     d.querySelector('.tool-notes').textContent.includes('jamalofski/praticulus') &&
     d.querySelector('.tool-notes').textContent.includes('MIT'));
}
