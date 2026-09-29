/* ==========================================================================
   URL 编解码
   重点在四件事上：
     1. 编解码结果与平台实现（encodeURIComponent / encodeURI / decodeURIComponent /
        decodeURI）逐条对齐 —— 全 ASCII 扫描 + 多字节样本，自研实现最容易在
        「哪些字符放行」上手滑，靠 V8 当参照物比手写期望值可靠；
     2. 上游三处缺陷的回归：自动判定把含字面 %XX 的文本当已编码串、
        解码前 trim 吃掉首尾空格、失败只报一句「Invalid encoded string」；
     3. 错误定位（第几个字符、哪几个字节）与 GBK 推测；
     4. 安全分类的隐私硬约束：不落盘、不进 URL、不挂表单、不拼 HTML。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  const ctx = await loadPage('tools/url-encoder/index.html');
  const { d, w } = ctx;

  const inputEl = () => d.getElementById('ue-input');
  const outputEl = () => d.getElementById('ue-output');
  const statusEl = () => d.getElementById('ue-status');
  const out = () => outputEl().textContent;
  const statusText = () => statusEl().textContent;
  const statusLevel = () => {
    const s = statusEl().querySelector('span');
    return s ? s.className : '';
  };
  const stats = () => {
    const o = {};
    for (const s of d.querySelectorAll('#ue-stats .stat')) {
      o[s.querySelector('.stat-label').textContent] = s.querySelector('.stat-value').textContent;
    }
    return o;
  };
  const partsRows = () => [...d.querySelectorAll('#ue-parts .value-row')].map((r) => ({
    label: r.querySelector('.value-label').textContent,
    value: r.querySelector('.value-text').textContent
  }));
  const paramRows = () => [...d.querySelectorAll('#ue-params tr')].map((tr) => ({
    key: tr.children[0].textContent,
    raw: tr.children[1].textContent,
    value: tr.children[2].textContent
  }));

  const setText = async (text, wait = 140) => {
    const el = inputEl();
    el.value = text;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(wait);
  };
  const click = async (sel, wait = 60) => {
    const el = d.querySelector(sel);
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const setSwitch = async (id, on) => {
    const el = d.getElementById(id);
    el.checked = on;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(60);
  };
  /** 用显式按钮编码，绕开自动判定 —— 这样断言的是按钮语义 */
  const encode = async (text) => {
    await setText(text);
    await click('#ue-encode');
  };
  const decode = async (text) => {
    await setText(text);
    await click('#ue-decode');
  };

  /* ---------- 1. 首屏与空态 ---------- */
  section('1. 首屏与空态');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('统计格子 4 个', count(d, '#ue-stats .stat') === 4, String(count(d, '#ue-stats .stat')));
  ok('四个指标齐全',
    Object.keys(stats()).join(',') === '输入字符数,输出字符数,百分号转义,非 ASCII 字符',
    Object.keys(stats()).join(','));
  ok('空输入时结果区为空（走 data-placeholder 空态）',
    out() === '' && outputEl().getAttribute('data-placeholder') !== null);
  ok('空输入时统计归零',
    JSON.stringify(stats()) === JSON.stringify({
      输入字符数: '0', 输出字符数: '0', 百分号转义: '0', '非 ASCII 字符': '0'
    }), JSON.stringify(stats()));
  ok('空输入时状态行为空', statusText() === '');
  ok('空输入时拆解面板显示空态', d.getElementById('ue-parts-empty').hidden === false);
  ok('拆解列表与参数表在空态下都隐藏',
    d.getElementById('ue-parts').hidden === true && d.getElementById('ue-params-wrap').hidden === true);
  ok('三个模式胶囊齐备且默认选中「组件」',
    count(d, '#ue-modes [data-mode]') === 3 &&
    d.querySelector('[data-mode="component"]').getAttribute('aria-pressed') === 'true');
  ok('「自动判定方向」默认开启', d.getElementById('ue-auto').checked === true);
  ok('「结果换到输入」初始禁用', d.getElementById('ue-swap').disabled === true);
  ok('禁用按钮带 title 说明原因',
    /空的|没有/.test(d.getElementById('ue-swap').getAttribute('title') || ''),
    d.getElementById('ue-swap').getAttribute('title'));

  /* ---------- 2. 编码：与平台实现逐条对齐 ---------- */
  section('2. 编码与平台实现对齐');
  /* 全 ASCII 一次过：自研编码表只要漏掉或多放行一个字符，这里就红。
     期望值取**输入框读回来的值**而不是原串 —— textarea 的 value 读出来时
     会把 \r\n 与 \r 归一成 \n（HTML 规范里的 API value），照原串比会冤枉实现。 */
  const ASCII = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)).join('');
  await encode(ASCII);
  const ASCII_IN = inputEl().value;
  ok('全 ASCII 128 个字符没在途中丢字符', ASCII_IN.length === 128, String(ASCII_IN.length));
  ok('组件模式 = encodeURIComponent（全 ASCII 128 字符）',
    out() === encodeURIComponent(ASCII_IN));

  await click('[data-mode="uri"]');
  await encode(ASCII);
  ok('整条 URL 模式 = encodeURI（全 ASCII 128 字符）', out() === encodeURI(ASCII_IN));

  await click('[data-mode="strict"]');
  await encode(ASCII);
  const strictRef = encodeURIComponent(ASCII_IN).replace(/[!'()*]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase());
  ok('严格模式 = 非保留字之外全编码', out() === strictRef);
  ok('严格模式确实多编了 ! ( ) *',
    out().indexOf('%21') >= 0 && out().indexOf('%28') >= 0 &&
    out().indexOf('%29') >= 0 && out().indexOf('%2A') >= 0);

  const SAMPLES = [
    'abc', 'a b', 'a+b', 'a/b?c=d&e=f#g', '100%', '你好，世界',
    'café', '日本語と한국어', 'emoji 🎉', "~!*'()", '[]{}|\\^`<>"',
    'user:pass@host:8080/p a t h?a=1&b=中文'
  ];
  for (const mode of ['component', 'uri', 'strict']) {
    await click(`[data-mode="${mode}"]`);
    let allOk = true;
    for (const s of SAMPLES) {
      await encode(s);
      const want = mode === 'component' ? encodeURIComponent(s)
        : mode === 'uri' ? encodeURI(s)
          : encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
      if (out() !== want) { allOk = false; ok(`[${mode}] ${JSON.stringify(s)}`, false, out()); }
    }
    if (allOk) ok(`${mode} 模式 12 个样本全部与平台实现一致`, true);
  }

  await click('[data-mode="component"]');
  await encode('中文');
  ok('汉字编成 3 个字节 = 9 个字符', out() === '%E4%B8%AD%E6%96%87', out());
  await encode('😀');
  ok('emoji 编成 4 个字节 = 12 个字符', out() === '%F0%9F%98%80', out());

  /* ---------- 3. 编码：选项开关 ---------- */
  section('3. 编码选项');
  await setSwitch('ue-space-plus', true);
  await encode('a b c');
  ok('空格编码为 +', out() === 'a+b+c', out());
  await encode('a+b');
  ok('字面的加号仍编成 %2B（不会与空格混淆）', out() === 'a%2Bb', out());
  await setSwitch('ue-space-plus', false);

  await setSwitch('ue-lower', true);
  await encode('中');
  ok('小写十六进制', out() === '%e4%b8%ad', out());
  await setSwitch('ue-lower', false);
  await encode('中');
  ok('回到大写十六进制（默认）', out() === '%E4%B8%AD', out());

  await encode('\uD800x');
  ok('落单代理项编成 U+FFFD', out() === encodeURIComponent('\uFFFDx'), out());
  ok('落单代理项会在状态行里说出来',
    statusLevel() === 'is-warn' && statusText().includes('代理项'), statusText());
  await encode('🎉');
  ok('成对的代理项不报警', statusLevel() !== 'is-warn', statusLevel());

  /* ---------- 4. 解码：与平台实现逐条对齐 ---------- */
  section('4. 解码与平台实现对齐');
  const DECODE_SAMPLES = [
    'a%20b', 'abc', '%25', '%2525', '%2F', '%2f', '%3F%23%26%3D', 'a%09b',
    'https%3A%2F%2Fexample.com%2Fa%2Fb%3Fq%3D%31', '%F0%9F%8E%89',
    'x%7E%2D%2E%5F', '%C3%A9', '%E4%B8%AD%E6%96%87'
  ];
  await click('[data-mode="component"]');
  let compOk = true;
  for (const s of DECODE_SAMPLES) {
    await decode(s);
    if (out() !== decodeURIComponent(s)) { compOk = false; ok(`组件解码 ${s}`, false, out()); }
  }
  if (compOk) ok(`组件模式解码 ${DECODE_SAMPLES.length} 个样本全部与 decodeURIComponent 一致`, true);

  await click('[data-mode="uri"]');
  let uriOk = true;
  for (const s of DECODE_SAMPLES) {
    await decode(s);
    if (out() !== decodeURI(s)) { uriOk = false; ok(`整条 URL 解码 ${s}`, false, out()); }
  }
  if (uriOk) ok(`整条 URL 模式解码 ${DECODE_SAMPLES.length} 个样本全部与 decodeURI 一致`, true);

  await click('[data-mode="component"]');
  await decode('%2F');
  ok('组件模式把 %2F 解成斜线', out() === '/', out());
  await click('[data-mode="uri"]');
  await decode('%2F');
  ok('整条 URL 模式保留 %2F（解出来会改掉 URL 结构）', out() === '%2F', out());
  await decode('%2f');
  ok('小写的保留字转义也原样保留大小写', out() === '%2f', out());
  await click('[data-mode="component"]');

  /* ---------- 5. 解码：`+` 与首尾空格 ---------- */
  section('5. + 与空格');
  await decode('a+b+c');
  ok('默认不把 + 当空格', out() === 'a+b+c', out());
  await setSwitch('ue-plus-space', true);
  await decode('a+b+c');
  ok('打开开关后 + 解成空格', out() === 'a b c', out());
  await decode('%2B');
  ok('%2B 解出来仍是字面的加号（不会被再当一次空格）', out() === '+', out());
  await decode('a+b%20c');
  ok('+ 与 %20 混用时都是空格', out() === 'a b c', out());
  await setSwitch('ue-plus-space', false);

  await decode('%20abc%20');
  ok('转义空格原样保留', out() === ' abc ', JSON.stringify(out()));
  /* 上游在解码前 trim()：' ab%20' 会被悄悄改成 'ab%20'，首尾空格不见了 */
  await decode(' %20abc ');
  ok('首尾的字面空格不会被 trim 吃掉', out() === '  abc ', JSON.stringify(out()));

  /* ---------- 6. 解码：错误定位 ---------- */
  section('6. 解码错误定位');
  await decode('%E4%B8');
  ok('截断的多字节序列报错', statusLevel() === 'is-error', statusLevel());
  ok('指出第几个字符', statusText().includes('第 1 个字符'), statusText());
  ok('说明是 UTF-8 字节不合法', statusText().includes('UTF-8'), statusText());
  ok('报出字节序列', /E4 B8/.test(statusText()), statusText());
  ok('失败时结果区为空', out() === '');
  ok('失败时输出字符数是破折号', stats()['输出字符数'] === '—', stats()['输出字符数']);
  ok('失败时「换到输入」仍禁用', d.getElementById('ue-swap').disabled === true);

  await decode('ab%2G');
  ok('% 后不是十六进制 → 指出位置', statusText().includes('第 3 个字符'), statusText());
  ok('报出问题片段', statusText().includes('%2G'), statusText());

  await decode('ab%');
  ok('结尾孤零零的 % → 说不完整', /不完整/.test(statusText()), statusText());
  ok('并给出正确写法 %25', statusText().includes('%25'), statusText());

  await decode('%80');
  ok('孤立续接字节 → 首字节非法', statusText().includes('0x80'), statusText());

  await decode('%C0%80');
  ok('过长编码 → 单独说清', statusText().includes('过长'), statusText());

  await decode('%ED%A0%80');
  ok('代理项码位 → 单独说清', statusText().includes('代理项'), statusText());

  await decode('%C4%E3');
  ok('GBK 字节 → 说清不是 UTF-8', statusText().includes('UTF-8'), statusText());
  ok('GBK 字节 → 附一句 GBK 推测值（不冒充结论）',
    statusText().includes('GBK') && statusText().includes('你') && /推测/.test(statusText()),
    statusText());

  await decode('中文%20abc');
  ok('字面非 ASCII 与转义混排照样能解', out() === '中文 abc', out());

  /* ---------- 7. 自动判定方向 ---------- */
  section('7. 自动判定方向');
  await setText('%E4%B8%AD');
  ok('像是已编码 → 自动解码', out() === '中', out());
  ok('状态行说明是自动判定的', statusText().includes('自动判定'), statusText());
  ok('结果区粘进来就直接出结果，不用点按钮', statusLevel() === 'is-ok', statusLevel());

  await setText('进度 100%25');
  ok('含字面 %XX 的文本会被当成已编码（这就是上游那条缺陷的正脸）',
    out() === '进度 100%', out());
  await click('#ue-encode');
  ok('但点「URL 编码」照样能编码它（上游这时没有出路）',
    out() === encodeURIComponent('进度 100%25'), out());

  await setText('abc%zz');
  ok('不是合法转义 → 按编码处理', out() === encodeURIComponent('abc%zz'), out());
  ok('自动判定不会报错', statusLevel() !== 'is-error', statusLevel());
  ok('并在状态行里点明原因',
    statusText().includes('自动判定') && /不像已编码的串/.test(statusText()), statusText());

  /* 转义写法合法、但字节不是 UTF-8：自动判定同样按编码处理，并给出完整的解释 */
  await setText('a%C4%E3b');
  ok('转义合法但字节不是 UTF-8 → 自动判定按编码处理（不报错）',
    out() === encodeURIComponent('a%C4%E3b') && statusLevel() !== 'is-error', out());
  ok('状态行说的是「转义解不出文本」', /转义解不出文本/.test(statusText()), statusText());
  ok('并解释「% 后面是两位十六进制、解出来还得是合法 UTF-8」',
    /两位十六进制/.test(statusText()) && /合法 UTF-8/.test(statusText()), statusText());

  await setSwitch('ue-auto', false);
  await setText('%E4%B8%AD');
  ok('关掉自动判定后默认编码', out() === encodeURIComponent('%E4%B8%AD'), out());
  await click('#ue-decode');
  ok('关掉自动判定后按钮完全按点的走', out() === '中', out());
  ok('点过按钮后状态行写明是按钮触发的', statusText().includes('你点的按钮'), statusText());
  await setSwitch('ue-auto', true);

  /* ---------- 8. 往返 ---------- */
  section('8. 往返');
  for (const s of SAMPLES) {
    await encode(s);
    const enc = out();
    await decode(enc);
    if (out() !== s) { ok(`往返 ${JSON.stringify(s)}`, false, out()); }
  }
  ok('12 个样本编码后再解码都能还原', true);

  /* ---------- 9. 统计 ---------- */
  section('9. 统计');
  await encode('中文');
  ok('输入 2 个字符', stats()['输入字符数'] === '2', stats()['输入字符数']);
  ok('输出 18 个字符（2 字 × 3 字节 × 3 个字符）', stats()['输出字符数'] === '18', stats()['输出字符数']);
  ok('转义 6 个（2 字 × 3 字节）', stats()['百分号转义'] === '6', stats()['百分号转义']);
  ok('非 ASCII 记 2 个', stats()['非 ASCII 字符'] === '2', stats()['非 ASCII 字符']);

  await decode('中文');
  ok('解码方向：转义数数输入里的（0 个）', stats()['百分号转义'] === '0', stats()['百分号转义']);
  ok('解码方向：非 ASCII 数结果里的', stats()['非 ASCII 字符'] === '2', stats()['非 ASCII 字符']);

  await encode('🎉');
  ok('emoji 按码点算 1 个字符（不是 2）', stats()['输入字符数'] === '1', stats()['输入字符数']);

  await encode('中'.repeat(1500));
  ok('千位分隔', stats()['输入字符数'] === '1,500', stats()['输入字符数']);

  /* ---------- 10. URL 结构拆解 ---------- */
  section('10. URL 结构拆解');
  await click('[data-demo]');
  const demo = partsRows();
  ok('示例填进了输入框', inputEl().value.startsWith('https://example.com/search'), inputEl().value);
  ok('示例自动解码出中文', out().includes('q=你好 世界'), out());
  ok('拆解出 6 行', demo.length === 6, String(demo.length));
  ok('协议 / 主机 / 端口 / 路径 / 查询串 / 片段齐全',
    demo.map((r) => r.label).join(',') === '协议,主机,端口,路径,查询串,片段',
    demo.map((r) => r.label).join(','));
  ok('协议是 https', demo[0].value === 'https', demo[0].value);
  ok('主机是 example.com', demo[1].value === 'example.com', demo[1].value);
  ok('端口显示默认值 443', demo[2].value.includes('443'), demo[2].value);
  ok('路径是 /search', demo[3].value === '/search', demo[3].value);
  ok('片段解码成中文', demo[5].value === '第一页', demo[5].value);

  const pr = paramRows();
  ok('查询参数拆成 3 条', pr.length === 3, String(pr.length));
  ok('第一条参数名是 q', pr[0].key === 'q', pr[0].key);
  ok('第一条解码后是「你好 世界」', pr[0].value === '你好 世界', pr[0].value);
  ok('第二条参数名是 lang', pr[1].key === 'lang', pr[1].key);
  ok('参数表保留原样值一列（未解码的转义）',
    pr[0].raw.includes('%E4%BD%A0') && !pr[0].raw.includes('q='), pr[0].raw);

  await setText('example.com/a?b=1');
  ok('缺协议时给专门的空态提示',
    d.getElementById('ue-parts-empty').hidden === false &&
    d.getElementById('ue-parts-empty').textContent.includes('缺少协议'),
    d.getElementById('ue-parts-empty').textContent);
  ok('缺协议时不显示拆解列表', d.getElementById('ue-parts').hidden === true);

  await setText('这不是网址');
  ok('不是 URL 时提示这是哪一类问题',
    d.getElementById('ue-parts-empty').textContent.includes('绝对 URL'),
    d.getElementById('ue-parts-empty').textContent);

  await setText('https://user:pw@host.example:8443/a%2Fb?x=1&y=%26&#frag');
  const rows2 = partsRows();
  ok('有用户信息时多一行', rows2.map((r) => r.label).join(',').includes('用户信息'),
    rows2.map((r) => r.label).join(','));
  ok('非默认端口照实显示', rows2.some((r) => r.value === '8443'));
  ok('路径里的 %2F 会被解出来显示（路径行按组件语义解）',
    rows2.find((r) => r.label === '路径').value === '/a/b',
    rows2.find((r) => r.label === '路径').value);
  const pr2 = paramRows();
  ok('空参数的段被跳过（x=1、y=%26、# 之后的空段）', pr2.length === 2, String(pr2.length));
  ok('参数值里的 %26 解成 &', pr2[1].value === '&', pr2[1].value);

  await setText('https://example.com/?a');
  ok('无值的参数显示（无值）', paramRows()[0].value === '（无值）', paramRows()[0].value);

  await setText('https://example.com/');
  ok('没有查询串时不显示参数表', d.getElementById('ue-params-wrap').hidden === true);
  ok('没有查询串时也没有附注', d.getElementById('ue-params-note').hidden === true);

  /* 参数值不是合法 UTF-8：单元格标红并给一条附注（不是静默按原样显示） */
  await setText('https://example.com/?a=%E4&b=ok');
  ok('解不开的参数值单元格标红',
    d.querySelector('#ue-params tr td.cell-error') !== null);
  ok('并给出附注说明有几条没解开',
    d.getElementById('ue-params-note').hidden === false &&
    d.getElementById('ue-params-note').textContent.includes('1 个'), 
    d.getElementById('ue-params-note').textContent);

  /* 参数很多时（只列前 200 条）也要说清楚，别让人以为参数就这么多 */
  await setText('https://example.com/?' + Array.from({ length: 205 }, (_, i) => 'k' + i + '=' + i).join('&'));
  ok('只列出前 200 条', count(d, '#ue-params tr') === 200, String(count(d, '#ue-params tr')));
  ok('并说明总数（205 条）',
    d.getElementById('ue-params-note').textContent.includes('205'), 
    d.getElementById('ue-params-note').textContent);

  await setText('https://例子.jp/');
  const rows3 = partsRows();
  ok('IDN 主机名会转 punycode（浏览器原生解析的标准化行为）',
    rows3[1].value === 'xn--fsqu00a.jp', rows3[1].value);

  /* 拆解行点了即复制 */
  await setText('https://example.com/a');
  const firstRow = d.querySelector('#ue-parts .value-row');
  firstRow.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  ok('点拆解行会打上已复制标记', firstRow.getAttribute('data-copied') === 'true');

  /* ---------- 11. 常用字符转义对照表 ---------- */
  section('11. 转义对照表');
  const refRows = [...d.querySelectorAll('#ue-ref tr')];
  ok('对照表有 36 行', refRows.length === 36, String(refRows.length));
  const refCell = (i, n) => refRows[i].children[n].textContent;
  const findRef = (ch) => refRows.findIndex((tr) => tr.children[0].textContent === ch);
  ok('空格那一行用 · 表示（与空白清理的可见化视图同一套写法）', findRef('·') >= 0);
  ok('空格 → %20', refCell(findRef('·'), 2) === '%20', refCell(findRef('·'), 2));
  ok('加号 → %2B', refCell(findRef('+'), 2) === '%2B', refCell(findRef('+'), 2));
  ok('汉字「中」→ %E4%B8%AD', refCell(findRef('中'), 2) === '%E4%B8%AD', refCell(findRef('中'), 2));
  ok('「中」的字节是 E4 B8 AD', refCell(findRef('中'), 1) === 'E4 B8 AD', refCell(findRef('中'), 1));
  ok('é → %C3%A9（两字节）', refCell(findRef('é'), 2) === '%C3%A9', refCell(findRef('é'), 2));
  ok('emoji → 四字节', refCell(findRef('😀'), 1) === 'F0 9F 98 80', refCell(findRef('😀'), 1));
  ok('未编码的字符也用 - 之类标出（%2D 只是它的编码，实际不编）',
    refCell(findRef('-'), 2) === '%2D', refCell(findRef('-'), 2));
  /* 表里的编码必须与实现对得上 —— 抽查一行真跑一遍 */
  await encode('a b');
  ok('表与实现对得上：空格在组件模式下编成 %20', out() === 'a%20b', out());

  /* ---------- 12. 隐私硬约束 ---------- */
  section('12. 隐私硬约束');
  ok('localStorage 里一个键都没写（本页没有草稿功能）',
    w.localStorage.length === 0, JSON.stringify(Object.keys(w.localStorage)));
  ok('页面上没有 form（不可能被提交出去）', count(d, 'form') === 0);
  await setText('https://example.com/?token=UNIQUE_MARKER_9f2a');
  ok('输入不会被写进地址栏', !w.location.href.includes('UNIQUE_MARKER'), w.location.href);
  ok('页脚之外的提示里写明了「本页没有草稿保存」',
    [...d.querySelectorAll('.panel-foot')].some((el) => el.textContent.includes('没有草稿')), '');

  /* 拼 HTML 的反向兜底：让解码结果里带一段「标签」，看它是被当成文本还是被当成元素 */
  await decode('%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
  ok('解码出来的 <img …> 只是文本，没有变成真的元素', count(d, 'img') === 0,
    String(count(d, 'img')));
  ok('它出现在输出区的是转义后的文本',
    out() === '<img src=x onerror=alert(1)>' && d.body.innerHTML.includes('&lt;img'));
  await decode('%3Cuexss%3Eboom%3C%2Fuexss%3E');
  ok('解码出来的 <uexss> 也没有变成元素', count(d, 'uexss') === 0, String(count(d, 'uexss')));
  ok('按文本原样显示', out() === '<uexss>boom</uexss>', out());
  ok('整页 innerHTML 里它是转义形式', d.body.innerHTML.includes('&lt;uexss'), '');

  /* ---------- 13. 按钮与边界 ---------- */
  section('13. 按钮与边界');
  await setText('a b');
  await click('#ue-encode');
  ok('编码后有结果', out() === 'a%20b', out());
  ok('有结果后「换到输入」可用', d.getElementById('ue-swap').disabled === false);
  await click('#ue-swap');
  ok('换到输入：结果进了输入框', inputEl().value === 'a%20b', inputEl().value);
  ok('换到输入后按新内容重新处理', out() === 'a b', out());

  await click('[data-clear]');
  ok('清空后输入框为空', inputEl().value === '');
  ok('清空后结果区为空', out() === '');
  ok('清空后状态行清空', statusText() === '');
  ok('清空后统计归零', stats()['输入字符数'] === '0', stats()['输入字符数']);
  ok('清空后拆解回到空态', d.getElementById('ue-parts-empty').hidden === false);

  await setText('   ');
  ok('只有空格时照常处理（不当作空输入）', stats()['输入字符数'] === '3', stats()['输入字符数']);
  await encode('   ');
  ok('三个空格 → %20%20%20', out() === '%20%20%20', out());

  await encode('');
  ok('空串编码结果为空', out() === '', out());

  await setText('%');
  ok('只有一个 % 时自动判定按编码处理（不报错）',
    out() === '%25' && statusLevel() !== 'is-error', out());

  await setText('a'.repeat(20000));
  ok('两万字符不卡死且长度正确', out().length === 20000, String(out().length));

  await decode('a'.repeat(5000) + '%20b');
  ok('五千字符带转义也能解', out().endsWith(' b'), String(out().length));

  /* ---------- 14. 页面结构 ---------- */
  section('14. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
    String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为安全分类的红色',
    d.documentElement.style.getPropertyValue('--hub-accent') === '#e5484d',
    d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('说明区有一节讲「来源与致谢」',
    [...d.querySelectorAll('.tool-note h3')].some((h) => h.textContent.includes('来源与致谢')));
  ok('说明区讲清了三种模式的区别',
    d.querySelector('.tool-notes').textContent.includes('encodeURIComponent') &&
    d.querySelector('.tool-notes').textContent.includes('encodeURI'));
  ok('说明区点明本页不保存草稿',
    d.querySelector('.tool-notes').textContent.includes('localStorage'));
}
