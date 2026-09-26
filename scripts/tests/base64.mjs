/* ==========================================================================
   Base64 编解码（base64）测试
   --------------------------------------------------------------------------
   全部用真实 DOM 交互驱动：设 textarea.value + dispatch input + 等防抖，
   不直接调工具内部函数。
   期望值一律用 Node 的 Buffer 独立算一遍（那是另一套实现），
   不是「跑一遍看输出是多少」抄下来的。

   两个「用例前提」断言（先断样本真的具备那个性质，再断行为）：
     - 折行样本里真的有换行、且剥掉空白后长度能被 4 整除；
     - 普通单词样本真的是纯 ASCII 字母。
   否则哪天换了样本，那几条用例会静默变成「什么都没测」。
   ========================================================================== */

import { ok, section, loadPage, count, sleep, loadRegistry } from './_harness.mjs';

/* --- 独立实现（不复用被测代码里的任何东西） ------------------------------ */
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const enc = (str) => Buffer.from(str, 'utf8').toString('base64');
const bytesOf = (arr) => Uint8Array.from(arr);
const hexOf = (arr) => [...arr]
  .map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const urlSafe = (s) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* 折行的 MIME 风格样本：每 20 个字符插一个换行 */
const PLAIN = 'The quick brown fox jumps over the lazy dog. '.repeat(2);
const WRAPPED = b64(Buffer.from(PLAIN, 'utf8')).replace(/(.{20})/g, '$1\n').trim();

/* 上游只看「字符集 + 长度」，这些普通英文单词全会被误判成 Base64。
   本项目加了两道闸门后必须一个都不中 —— 这里逐个验证。 */
const WORDS = ['hello', 'test', 'abcdef', 'content', 'Hello', 'London',
  'abandon', 'xylophone', 'internationalization'];

export default async function run() {
  let copied = null;
  let copiedCount = 0;
  const ctx = await loadPage('tools/base64/index.html', {
    clipboard: (t) => { copied = t; copiedCount++; }
  });
  const { d, w, errors } = ctx;

  const $ = (sel) => d.querySelector(sel);
  const input = d.getElementById('b64-input');
  const output = d.getElementById('b64-output');
  const statusEl = d.getElementById('b64-status');
  const urlBox = d.getElementById('b64-urlsafe');
  const autoBox = d.getElementById('b64-auto');
  const fileEl = d.getElementById('b64-file');
  const preview = d.getElementById('b64-preview');
  const fileCard = d.getElementById('b64-filecard');
  const nameEl = d.getElementById('b64-filename');
  const metaEl = d.getElementById('b64-filemeta');

  const out = () => output.textContent;
  const status = () => statusEl.textContent;

  const statVal = (label) => {
    const hit = [...d.querySelectorAll('#b64-stats .stat')]
      .find((s) => s.querySelector('.stat-label').textContent === label);
    return hit ? hit.querySelector('.stat-value').textContent : '(没有这一格)';
  };
  const statLabels = () => [...d.querySelectorAll('#b64-stats .stat .stat-label')]
    .map((e) => e.textContent);

  /* 输入走 90ms 防抖；全量测试时 CPU 很忙，余量留到 200ms */
  const setInput = async (text) => {
    input.value = text;
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(200);
  };
  const setCheck = async (el, v) => {
    el.checked = v;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(200);
  };
  const click = async (sel) => {
    const el = typeof sel === 'string' ? $(sel) : sel;
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(60);
  };
  const waitFor = async (fn, ms = 2000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await sleep(25);
    }
    return false;
  };
  /* 「文件已读进来」的判据：文件名那一行有内容了（FileReader 是异步的） */
  const fileLoaded = () => nameEl.textContent !== '';
  const sendFile = async (file) => {
    Object.defineProperty(fileEl, 'files', { value: [file], configurable: true });
    fileEl.dispatchEvent(new w.Event('change', { bubbles: true }));
    return waitFor(fileLoaded);
  };

  /* ---------- 1. 基本渲染 ---------- */
  section('1. 基本渲染');

  ok('无脚本错误', errors.length === 0, errors.join(' | '));
  ok('页面声明了 data-tool 与 data-hub',
    d.body.getAttribute('data-tool') === 'base64' &&
    d.body.getAttribute('data-hub') === 'security');
  ok('面包屑中间一项指向安全分类',
    $('.breadcrumb a[href="../../hubs/security/"]') !== null);
  ok('头部徽章标明本地运行',
    [...d.querySelectorAll('.tool-head-meta .badge')].some((b) => b.textContent.includes('本地运行')));
  ok('首屏结果区为空（显示占位）', out() === '');
  ok('首屏统计是四个占位格子',
    statLabels().join('|') === '输入字符数|字节数|结果字符数|结果 / 输入',
    statLabels().join('|'));
  ok('首屏占位值都是破折号',
    [...d.querySelectorAll('#b64-stats .stat-value')].every((e) => e.textContent === '—'));
  ok('首屏「结果换到输入」是禁用的', d.getElementById('b64-swap').disabled === true);
  ok('相关工具区块渲染了同分类工具',
    count(d, '#related-grid .tool-card') > 0, String(count(d, '#related-grid .tool-card')));

  /* ---------- 2. 编码 ---------- */
  section('2. UTF-8 编码');

  await setInput('hello');
  ok('hello → aGVsbG8=', out() === enc('hello'), out());
  ok('编码结果带 .b64-out（按任意位置断行）', output.classList.contains('b64-out'));
  ok('状态行说明是自动判定、按 UTF-8 编码',
    status().includes('自动判定为普通文本') && status().includes('UTF-8'), status());
  ok('统计：输入 5 字符 / 5 字节 / 结果 8 字符',
    statVal('输入字符数') === '5' && statVal('输入字节数（UTF-8）') === '5' &&
    statVal('结果字符数') === '8',
    [statVal('输入字符数'), statVal('输入字节数（UTF-8）'), statVal('结果字符数')].join(' / '));
  ok('统计：结果 / 输入 = ×1.60', statVal('结果 / 输入') === '×1.60', statVal('结果 / 输入'));

  await setInput('你好');
  ok('中文按 UTF-8 编码（你好 → 5L2g5aW9）', out() === '5L2g5aW9', out());
  ok('中文的字节数按 UTF-8 算（2 字符 / 6 字节）',
    statVal('输入字符数') === '2' && statVal('输入字节数（UTF-8）') === '6',
    [statVal('输入字符数'), statVal('输入字节数（UTF-8）')].join(' / '));

  await setInput('中文测试');
  ok('中文测试 → 5Lit5paH5rWL6K+V', out() === '5Lit5paH5rWL6K+V', out());

  await setInput('😀');
  ok('emoji（代理对）能原样编码', out() === enc('😀'), out() + ' vs ' + enc('😀'));
  ok('emoji 不触发「代理项被替换」告警', !status().includes('代理项'), status());

  await setInput('Tom & Jerry');
  ok('编码结果里只有 Base64 字符集',
    /^[A-Za-z0-9+/]*={0,2}$/.test(out()), out());

  /* ---------- 3. 解码 ---------- */
  section('3. 解码');

  await setInput('aGVsbG8=');
  ok('aGVsbG8= → hello', out() === 'hello', out());
  ok('解码结果不带 .b64-out（不按任意位置断行）', !output.classList.contains('b64-out'));
  ok('状态行说明判定为 Base64', status().includes('自动判定为 Base64'), status());
  ok('统计：编码方向是「输入字节数」，解码方向换成「解出字节数」',
    statLabels().includes('解出字节数') && statVal('解出字节数') === '5',
    statLabels().join('|'));

  await setInput('5Lit5paH5rWL6K+V');
  ok('中文 Base64 解回中文', out() === '中文测试', out());

  await setInput('5Lit5paH5rWL6K-V');
  ok('URL 安全字符集（- _）能直接解，不需要先勾开关', out() === '中文测试', out());

  await setInput('YQ==');
  ok('带填充的短串能解（YQ== → a）', out() === 'a', out());

  await setInput('YQ');
  ok('前提：YQ 是纯字母，会被自动判定当成文本', /^[A-Za-z]+$/.test('YQ'));
  ok('纯字母串自动判定走编码（这是文档里写明的取舍）', out() === enc('YQ'), out());
  await click('#b64-decode');
  ok('手动点「Base64 解码」能解出缺填充的 YQ → a', out() === 'a', out());

  await setInput('AAAA');
  await click('#b64-decode');
  ok('AAAA 解出 3 个 NUL 字节：NUL 也是合法 UTF-8，所以给文本视图而不是字节视图',
    out() === '\u0000\u0000\u0000' && statVal('解出字节数') === '3',
    JSON.stringify(out()) + ' / ' + statVal('解出字节数'));

  /* 折行样本的两个「用例前提」 */
  ok('前提：折行样本里真的有换行', /\n/.test(WRAPPED));
  ok('前提：剥掉空白后长度能被 4 整除',
    WRAPPED.replace(/\s+/g, '').length % 4 === 0);
  await setInput(WRAPPED);
  ok('MIME 折行的 Base64 能自动判成 Base64 并解回原文',
    out() === PLAIN, JSON.stringify(out().slice(0, 40)));
  ok('折行不影响解码，但「输入字符数」按输入框里的原始长度算（含换行）',
    statVal('输入字符数') === String(WRAPPED.length),
    statVal('输入字符数') + ' vs ' + WRAPPED.length);

  /* ---------- 4. URL 安全输出 ---------- */
  section('4. URL 安全字符集只影响结果的写法');

  await setInput('>>>???');
  ok('标准字符集下 >>>??? → Pj4+Pz8/', out() === 'Pj4+Pz8/', out());
  await setCheck(urlBox, true);
  ok('勾上 URL 安全后 + / 换成 - _ 并省略填充', out() === 'Pj4-Pz8_', out());
  ok('URL 安全的写法与独立实现一致', out() === urlSafe(enc('>>>???')), out());
  ok('状态行说明省略了填充', status().includes('省略 = 填充'), status());
  await setCheck(urlBox, false);
  ok('取消勾选后回到标准写法', out() === 'Pj4+Pz8/', out());

  /* ---------- 5. 自动判定：普通英文单词不能被误判 ---------- */
  section('5. 自动判定（回归：上游把 78.5% 的常用英文单词当成 Base64）');

  let misjudged = [];
  for (const word of WORDS) {
    /* 前提：样本真的是纯 ASCII 字母 —— 这正是判定的关键条件 */
    if (!/^[A-Za-z]+$/.test(word)) { misjudged.push(word + '(样本不合格)'); continue; }
    await setInput(word);
    if (out() !== enc(word)) misjudged.push(word + '→' + JSON.stringify(out().slice(0, 24)));
  }
  ok(WORDS.length + ' 个普通英文单词没有一个被当成 Base64',
    misjudged.length === 0, misjudged.join(' | '));

  await setInput('abcdef');
  ok('abcdef 被编码而不是被解码（上游会报 Invalid Base64 string）',
    out() === 'YWJjZGVm', out());
  ok('自动判定下不会出现「Invalid Base64 string」这种英文报错',
    !/Invalid Base64/i.test(status()), status());

  await setInput('YWJj');
  ok('前提：YWJj 也是纯字母（本项目会漏判它）', /^[A-Za-z]+$/.test('YWJj'));
  ok('漏判的代价：YWJj 被当成文本编码', out() === enc('YWJj'), out());
  await click('#b64-decode');
  ok('手动解码后 YWJj → abc（取舍可恢复，只差一次点击）', out() === 'abc', out());

  /* ---------- 6. 非法输入：三条原因各不相同 ---------- */
  section('6. 非法输入的错误定位');

  await setCheck(autoBox, false);
  ok('关掉自动判定后，输入不再自动跑（等用户点按钮）',
    status().includes('自动判定已关'), status());

  await setInput('ab*d');
  await click('#b64-decode');
  ok('非法字符指出是第几个、是哪个字符',
    status().includes('第 3 个字符') && status().includes('*'), status());
  ok('非法字符时结果区被清空（不留上一次的旧结果）', out() === '');

  await setInput('YQ==X');
  await click('#b64-decode');
  ok('「=」位置不对单独报（不是笼统的「无效」）',
    status().includes('位置不对') && !status().includes('不是 Base64 字符'), status());

  await setInput('abcde');
  await click('#b64-decode');
  ok('长度 %4 余 1 单独报，并说明为什么不可能',
    status().includes('长度不合法') && status().includes('余 1'), status());

  await setInput('YQ==');
  await click('#b64-decode');
  ok('合法的串能正常解出来，恢复正常状态', out() === 'a', out());

  await setCheck(autoBox, true);
  ok('重新打开自动判定后立刻按新输入重跑', status().includes('自动判定'), status());

  /* ---------- 7. 二进制：给字节视图，不说「无效」 ---------- */
  section('7. 解出来不是 UTF-8 文本时给字节视图');

  const BIN = [0xff, 0xfe, 0x00, 0x9f, 0x92, 0x96];
  const BIN_B64 = b64(bytesOf(BIN));
  await setInput(BIN_B64);
  ok('前提：这个样本确实带 / 与 =（字符集覆盖到了）', /[+/=]/.test(BIN_B64), BIN_B64);
  ok('自动判定对二进制 Base64 保持保守（走编码，不把普通文本搅成字节视图）',
    out() === enc(BIN_B64), out());
  ok('但状态行点出「这串本身也是合法的 Base64」并给出字节数',
    status().includes('也是合法的 Base64') && status().includes('6 字节'), status());

  await click('#b64-decode');
  ok('点「Base64 解码」后给出十六进制字节视图',
    out() === hexOf(BIN), out() + ' vs ' + hexOf(BIN));
  ok('字节视图带 .b64-hex 样式', output.classList.contains('b64-hex'));
  ok('状态行是警告、并说清「合法但不是 UTF-8 文本」',
    status().includes('是合法的') && status().includes('不是 UTF-8 文本'), status());
  ok('状态行不再出现「Invalid Base64 string」', !/Invalid Base64/i.test(status()), status());
  ok('状态行给出总字节数', status().includes('6 字节'), status());
  ok('统计：解出 6 字节', statVal('解出字节数') === '6', statVal('解出字节数'));
  ok('字节视图下「结果换到输入」不可用（换回去没有意义）',
    d.getElementById('b64-swap').disabled === true);

  await setInput('5L2g5aW9');
  ok('换成文本 Base64 后恢复正常视图', out() === '你好' && !output.classList.contains('b64-hex'), out());

  /* ---------- 8. 不成对的代理项 ---------- */
  section('8. 不成对的代理项会被显式指出');

  await setInput('\uD800');
  ok('落单的代理项被替换成 U+FFFD，结果是 77+9', out() === enc('\uD800'), out());
  ok('状态行指出有 1 个代理项被替换', status().includes('1 个不成对的代理项'), status());
  ok('状态行提醒是哪一个字符没了', status().includes('U+FFFD'), status());

  await setInput('ok');
  ok('正常输入不出现代理项告警', !status().includes('代理项'), status());

  /* ---------- 9. 换到输入 ---------- */
  section('9. 「结果换到输入」按反方向再跑一遍');

  await setInput('hello');
  ok('先编码得到 aGVsbG8=', out() === 'aGVsbG8=', out());
  await click('#b64-swap');
  ok('交换后输入框里是结果', input.value === 'aGVsbG8=', input.value);
  ok('交换后自动反向解码回 hello', out() === 'hello', out());
  await click('#b64-swap');
  ok('再交换一次能回到编码（来回都通）', input.value === 'hello' && out() === 'aGVsbG8=',
    input.value + ' / ' + out());

  /* ---------- 10. 文件 ---------- */
  section('10. 文件转 Base64 与 Data URL');

  const file1 = new w.File([bytesOf(BIN)], 'blob.bin', { type: '' });
  await sendFile(file1);
  ok('文件结果 = 该文件字节的 Base64', out() === BIN_B64, out());
  ok('文件卡片显示出来了', fileCard.hidden === false);
  ok('文件名显示在卡片里', nameEl.textContent === 'blob.bin', nameEl.textContent);
  ok('非图片不出预览', preview.hidden === true);
  ok('类型为空时补上 application/octet-stream（不拼出 data:;base64,）',
    metaEl.textContent.includes('application/octet-stream'), metaEl.textContent);
  ok('统计显示文件大小与类型', statVal('文件类型') === 'application/octet-stream',
    statVal('文件类型'));

  copied = null;
  await click('#b64-copy-dataurl');
  ok('「复制 Data URL」复制的是带 MIME 头的完整 Data URL',
    copied === 'data:application/octet-stream;base64,' + BIN_B64, String(copied));

  copied = null;
  await click('#b64-copy-b64');
  ok('「复制 Base64」复制的是纯 Base64', copied === BIN_B64, String(copied).slice(0, 40));

  await setCheck(urlBox, true);
  ok('转换文件后勾 URL 安全，结果按新写法重算（不会被空输入框清掉）',
    out() === urlSafe(BIN_B64), out() + ' vs ' + urlSafe(BIN_B64));
  await setCheck(urlBox, false);
  ok('取消勾选后文件结果回到标准写法', out() === BIN_B64, out());

  const png = bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const file2 = new w.File([png], 'dot.png', { type: 'image/png' });
  Object.defineProperty(fileEl, 'files', { value: [file2], configurable: true });
  fileEl.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok('读到第二个文件', await waitFor(() => nameEl.textContent === 'dot.png'), nameEl.textContent);
  ok('图片文件结果正确', out() === b64(png), out());
  ok('图片出预览，src 是带 MIME 的 Data URL',
    preview.hidden === false &&
    (preview.getAttribute('src') || '').startsWith('data:image/png;base64,'),
    String(preview.getAttribute('src')).slice(0, 40));

  /* ---------- 11. 复制与清空 ---------- */
  section('11. 复制、填入示例与清空');

  await setInput('hello');
  copied = null;
  const beforeCount = copiedCount;
  await click('[data-copy-target="#b64-output"]');
  ok('结果区的「复制」按钮复制的是结果原文', copied === 'aGVsbG8=', String(copied));
  ok('复制走的是通用代理（有回执）', copiedCount === beforeCount + 1);

  await click('[data-demo]');
  ok('填入示例填的是 JWT 头部那段 Base64', input.value === 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', input.value);
  ok('示例被自动判定为 Base64 并解码',
    out() === '{"alg":"HS256","typ":"JWT"}', out());

  await click('[data-clear]');
  ok('清空后输入框为空', input.value === '');
  ok('清空后结果区为空', out() === '');
  ok('清空后状态行清空', status() === '');
  ok('清空后统计回到占位', statVal('输入字符数') === '—', statVal('输入字符数'));
  ok('清空后文件卡片收起', fileCard.hidden === true);

  /* ---------- 12. 与 registry 的一致性 ---------- */
  section('12. 与 registry 的一致性');

  const T = loadRegistry();
  const tool = T.tools.find((t) => t.slug === 'base64');
  ok('registry 里 base64 在安全分类', tool && tool.hub === 'security');
  ok('registry 里状态是 ready', tool && tool.status === 'ready', tool && tool.status);
  ok('registry 描述与实现一致（提到 URL 安全与文件）',
    tool && tool.desc.includes('URL 安全') && tool.desc.includes('文件'), tool && tool.desc);
}
