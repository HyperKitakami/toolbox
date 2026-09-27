/* ==========================================================================
   哈希摘要生成（tools/hash-generator/）
   --------------------------------------------------------------------------
   这个套件里最要紧的一条是**「文本路径与文件路径对同一串字节给出同一个摘要」**——
   上游就是在这里错的：它的 MD5 吃 JS 字符串的 UTF-16 码元、SHA 走 TextEncoder 的
   UTF-8，于是同一个字符串粘进文本框和存成文件拖进来，MD5 不一样。
   所以每条摘要都对 Node 的 crypto（OpenSSL）交叉校验，多字节输入单独列一组。

   另外覆盖：Base64 输出、来源切换、文件读取与大小上限、比对框（含几种真实粘贴形态
   与长度推断）、逐行复制、MD5/SHA-1 的「已破」标注、隐私三件套。
   ========================================================================== */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ok, section, loadPage, sleep, count, ROOT } from './_harness.mjs';

const WAIT = 260;
const MAX_FILE = 128 * 1024 * 1024;

const nodeHex = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');
const nodeB64 = (algo, buf) => crypto.createHash(algo).update(buf).digest('base64');

/* [页面上的算法名, Node 的算法名] */
const ALGOS = [
  ['MD5', 'md5'],
  ['SHA-1', 'sha1'],
  ['SHA-256', 'sha256'],
  ['SHA-384', 'sha384'],
  ['SHA-512', 'sha512']
];

export default async function run() {
  /* 装一个剪贴板桩，这样「复制」那一节能直接验内容而不只是按钮反馈 */
  const copied = [];
  const ctx = await loadPage('tools/hash-generator/index.html', {
    clipboard: (t) => copied.push(t)
  });
  const w = ctx.w;
  const d = ctx.d;
  const $ = (s) => d.querySelector(s);
  const txt = (s) => ($(s) ? $(s).textContent : '');

  const rows = () => [...d.querySelectorAll('.hash-row')];
  const rowOf = (algo) => d.querySelector('.hash-row[data-algo="' + algo + '"]');
  const valueOf = (algo) => rowOf(algo).querySelector('.hash-value').textContent;
  const stateOf = (algo) => rowOf(algo).getAttribute('data-state');
  const copyBtnOf = (algo) => rowOf(algo).querySelector('.btn');
  const formatChip = (id) => $('#hg-format [data-value="' + id + '"]');
  const sourceNote = () => txt('#hg-source-note');
  const foot = () => txt('#hg-status');
  const compareOut = () => txt('#hg-compare-out');
  const compareLevel = () => {
    const c = $('#hg-compare-out').firstElementChild;
    return c ? c.className : '';
  };

  const setText = async (v) => {
    $('#hg-input').value = v;
    $('#hg-input').dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(WAIT);
  };
  const setCompare = async (v) => {
    $('#hg-compare').value = v;
    $('#hg-compare').dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(200);
  };
  const click = async (el) => {
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(60);
  };
  /* FileReader 是异步的，等它落地 */
  const waitFor = async (fn, ms = 2000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await sleep(25);
    }
    return false;
  };
  const sendFile = async (file) => {
    Object.defineProperty($('#hg-file'), 'files', { value: [file], configurable: true });
    $('#hg-file').dispatchEvent(new w.Event('change', { bubbles: true }));
    return waitFor(() => stateOf('MD5') === 'ok' && rowOf('MD5').querySelector('.hash-value').textContent !== '');
  };

  /* ---------- 1. 初始状态 ---------- */
  section('1. 初始状态');
  ok('页面脚本没有报错', ctx.errors.length === 0, ctx.errors.slice(0, 2).join(' / '));
  ok('依赖缺失的提示没有露出来', $('#hg-error').hidden === true);
  ok('渲染出五行摘要', rows().length === 5, String(rows().length));
  ok('五行的顺序是 MD5 / SHA-1 / SHA-256 / SHA-384 / SHA-512',
    rows().map((r) => r.getAttribute('data-algo')).join(',') ===
    'MD5,SHA-1,SHA-256,SHA-384,SHA-512',
    rows().map((r) => r.getAttribute('data-algo')).join(','));
  ok('没有内容时五行都是空态', rows().every((r) => r.getAttribute('data-state') === 'empty'));
  ok('没有内容时复制按钮全部禁用',
    ALGOS.every(([a]) => copyBtnOf(a).disabled === true));
  ok('禁用原因写在 title 里', /还没有可以复制的摘要/.test(copyBtnOf('MD5').getAttribute('title')),
    copyBtnOf('MD5').getAttribute('title'));
  ok('来源行说明还没有内容', /还没有内容/.test(sourceNote()), sourceNote());
  ok('底栏在没有内容时不写实现说明', foot() === '', foot());
  ok('输出格式默认是十六进制',
    formatChip('hex').getAttribute('aria-pressed') === 'true' &&
    formatChip('base64').getAttribute('aria-pressed') === 'false');
  ok('文件面板的「移除文件」初始不显示（用 hidden 属性）',
    $('#hg-file-remove').hidden === true);
  ok('比对框初始没有提示', compareOut() === '');
  ok('每个算法都标出位数与十六进制长度',
    /128 位 · 32 个十六进制字符/.test(rowOf('MD5').querySelector('.hash-meta').textContent) &&
    /512 位 · 128 个十六进制字符/.test(rowOf('SHA-512').querySelector('.hash-meta').textContent),
    rowOf('MD5').querySelector('.hash-meta').textContent);

  /* ---------- 2. 文本摘要与 OpenSSL 交叉校验 ---------- */
  section('2. 文本摘要（每一条都对 OpenSSL 交叉校验）');
  const CASES = [
    ['abc', 'ASCII'],
    ['The quick brown fox jumps over the lazy dog', '英文句子'],
    ['中文', '中文'],
    ['你好，世界', '中文标点'],
    ['café', '拉丁扩展'],
    ['emoji 🎉 与代理对 𝄞', '代理对'],
    ['a'.repeat(55), '55 个字符（MD5/SHA 的分组边界前）'],
    ['b'.repeat(56), '56 个字符（正好跨分组）'],
    ['c'.repeat(64), '64 个字符（正好一个分组）'],
    ['d'.repeat(65), '65 个字符'],
    ['e'.repeat(119), '119 个字符（SHA-512 的分组边界前）'],
    ['f'.repeat(128), '128 个字符（正好一个 128 字节分组）']
  ];
  for (const [text, label] of CASES) {
    await setText(text);
    const buf = Buffer.from(text, 'utf8');
    const bad = ALGOS.filter(([name, algo]) => valueOf(name) !== nodeHex(algo, buf));
    ok(label + '：五种摘要全部与 OpenSSL 一致', bad.length === 0,
      bad.map(([n]) => n + '=' + valueOf(n).slice(0, 12) + ' 期望 ' +
        nodeHex(ALGOS.find((x) => x[0] === n)[1], buf).slice(0, 12)).join(' / '));
  }

  /* 空输入在这里有个**有意**的区别：
     · 文本框空着 → 当成「还没有内容」，不显示五行（清空输入框的人不该看到
       五个「空内容」的摘要）；
     · 文件是 0 字节 → 照常算，因为「给一个空文件求校验和」是合理需求。
     两种都验一遍，免得以后有人把两者统一成一个行为。 */
  await setText('');
  ok('文本为空时不当成内容，五行回到空态',
    stateOf('MD5') === 'empty' && valueOf('MD5') === '', stateOf('MD5') + '/' + valueOf('MD5'));
  ok('文本为空时来源行提示「还没有内容」', /还没有内容/.test(sourceNote()), sourceNote());
  await sendFile(new w.File([new Uint8Array(0)], 'empty.bin', { type: '' }));
  ok('0 字节的文件照常算（不是「没有内容」）', stateOf('MD5') === 'ok', stateOf('MD5'));
  ok('空内容的 MD5 是 d41d8cd98f00b204e9800998ecf8427e',
    valueOf('MD5') === 'd41d8cd98f00b204e9800998ecf8427e', valueOf('MD5'));
  const badEmpty = ALGOS.filter(([name, algo]) =>
    valueOf(name) !== nodeHex(algo, Buffer.alloc(0)));
  ok('空内容五种摘要全部与 OpenSSL 一致', badEmpty.length === 0,
    badEmpty.map(([n]) => n).join(' / '));
  await click($('#hg-clear'));
  await sleep(120);

  await setText('abc');
  ok('来源行说明在算文本、并报出字符数',
    /正在算：文本（3 个字符/.test(sourceNote()) && /UTF-8/.test(sourceNote()), sourceNote());
  ok('底栏写明全在本机、并说明走的是哪条实现',
    /全部在本机计算/.test(foot()) &&
    (/纯 JS/.test(foot()) || /crypto\.subtle/.test(foot())), foot());
  ok('底栏说明 UTF-8 口径', /UTF-8/.test(foot()), foot());

  /* ---------- 3. MD5 / SHA-1 的「已破」标注 ---------- */
  section('3. MD5 / SHA-1 的「已破」标注');
  const warnOf = (algo) => rowOf(algo).querySelector('.hash-warn');
  ok('MD5 行有「已破」胶囊', !!warnOf('MD5'));
  ok('SHA-1 行有「已破」胶囊', !!warnOf('SHA-1'));
  ok('SHA-256 / 384 / 512 没有这个胶囊',
    !warnOf('SHA-256') && !warnOf('SHA-384') && !warnOf('SHA-512'));
  ok('胶囊的文案说明它「别用于签名」', /别用于签名/.test(warnOf('MD5').textContent),
    warnOf('MD5').textContent);
  ok('胶囊的 title 讲清「当校验和可以、当签名不行」',
    /碰撞/.test(warnOf('MD5').getAttribute('title')) &&
    /校验和/.test(warnOf('MD5').getAttribute('title')),
    warnOf('MD5').getAttribute('title'));
  ok('全页只有两个「已破」胶囊', count(d, '.hash-warn') === 2, String(count(d, '.hash-warn')));

  /* ---------- 4. Base64 输出 ---------- */
  section('4. Base64 输出');
  await click(formatChip('base64'));
  ok('切到 Base64 后 chip 选中状态跟着变',
    formatChip('base64').getAttribute('aria-pressed') === 'true' &&
    formatChip('hex').getAttribute('aria-pressed') === 'false');
  const badB64 = ALGOS.filter(([name, algo]) =>
    valueOf(name) !== nodeB64(algo, Buffer.from('abc')));
  ok('五种摘要的 Base64 都与 OpenSSL 一致', badB64.length === 0,
    badB64.map(([n]) => n + '=' + valueOf(n)).join(' / '));
  ok('SHA-384 的 Base64 长度是 64（SRI 那种写法）',
    valueOf('SHA-384').length === 64, String(valueOf('SHA-384').length));
  ok('Base64 里带了填充 =（SHA-256 是 44 位、末尾一个 =）',
    valueOf('SHA-256').length === 44 && valueOf('SHA-256').endsWith('='),
    valueOf('SHA-256'));
  ok('那行小字也跟着换成 Base64 的字符数（别在 Base64 模式下标十六进制长度）',
    /128 位 · 24 个 Base64 字符/.test(rowOf('MD5').querySelector('.hash-meta').textContent) &&
    /512 位 · 88 个 Base64 字符/.test(rowOf('SHA-512').querySelector('.hash-meta').textContent),
    rowOf('MD5').querySelector('.hash-meta').textContent + ' / ' +
    rowOf('SHA-512').querySelector('.hash-meta').textContent);
  ok('Base64 字符数逐行与实际长度一致',
    ALGOS.every(([n]) => {
      var m = rowOf(n).querySelector('.hash-meta').textContent.match(/(\d+) 个 Base64 字符/);
      return m && Number(m[1]) === valueOf(n).length;
    }),
    ALGOS.map(([n]) => rowOf(n).querySelector('.hash-meta').textContent).join(' | '));
  ok('复制按钮的 title 说明当前格式',
    /Base64/.test(copyBtnOf('MD5').getAttribute('title')),
    copyBtnOf('MD5').getAttribute('title'));
  await click(formatChip('hex'));
  ok('切回十六进制后恢复', valueOf('MD5') === nodeHex('md5', Buffer.from('abc')),
    valueOf('MD5'));
  ok('切回十六进制后小字也切回来',
    /32 个十六进制字符/.test(rowOf('MD5').querySelector('.hash-meta').textContent),
    rowOf('MD5').querySelector('.hash-meta').textContent);

  /* ---------- 5. 文本路径与文件路径必须一致（上游错在这里） ---------- */
  section('5. 文本路径与文件路径对同一串字节给出同一结果');
  for (const text of ['abc', '中文', '你好，世界', 'emoji 🎉']) {
    await setText(text);
    const viaText = valueOf('MD5');
    await click($('#hg-clear'));
    const bytes = new Uint8Array(Buffer.from(text, 'utf8'));
    await sendFile(new w.File([bytes], 'x.bin', { type: 'application/octet-stream' }));
    const viaFile = valueOf('MD5');
    ok('「' + text + '」当文本算与当文件算，MD5 相同', viaText === viaFile,
      viaText + ' vs ' + viaFile);
    ok('「' + text + '」文件路径的 MD5 也与 OpenSSL 一致',
      viaFile === nodeHex('md5', Buffer.from(text, 'utf8')), viaFile);
  }
  ok('对照：上游那套做法会把 UTF-16 码元当字节塞进去，得到另一个值',
    nodeHex('md5', Buffer.from('中文', 'utf16le')) !==
    nodeHex('md5', Buffer.from('中文', 'utf8')));

  /* ---------- 6. 文件路径 ---------- */
  section('6. 文件读取');
  await click($('#hg-clear'));
  const bytes = new Uint8Array([0x00, 0x01, 0xfe, 0xff, 0x80, 0x7f]);
  await sendFile(new w.File([bytes], 'bytes.bin', { type: 'application/octet-stream' }));
  ok('文件名的信息行显示出来了', !$('#hg-file-info').hidden);
  ok('信息行报出文件名与大小', /bytes\.bin/.test(txt('#hg-file-info')) &&
    /6 字节/.test(txt('#hg-file-info')), txt('#hg-file-info'));
  ok('来源行切到「正在算：文件」', /正在算：文件 bytes\.bin/.test(sourceNote()), sourceNote());
  ok('「移除文件」按钮出现了', $('#hg-file-remove').hidden === false);
  const badBin = ALGOS.filter(([name, algo]) => valueOf(name) !== nodeHex(algo, Buffer.from(bytes)));
  ok('含 0x00 / 0xff 的二进制内容五种摘要都对', badBin.length === 0,
    badBin.map(([n]) => n).join(' / '));
  ok('底栏说明这是文件的原始字节', /原始字节/.test(foot()), foot());

  await click($('#hg-file-remove'));
  await sleep(120);
  ok('移除文件后信息行收起', $('#hg-file-info').hidden === true);
  ok('移除文件后按钮也收起', $('#hg-file-remove').hidden === true);
  ok('移除文件后回到文本来源', /文本|还没有内容/.test(sourceNote()), sourceNote());
  ok('移除文件后没有可算的内容，五行回到空态',
    rows().every((r) => r.getAttribute('data-state') === 'empty'));

  /* ---------- 7. 大小上限 ---------- */
  section('7. 文件大小上限');
  await setText('abc');
  /* 用一个只有 name/size 的替身，避免真去分配 129 MB —— useFile 在读取之前
     就会因为超限返回，所以这里走到的正是那条判断。 */
  Object.defineProperty($('#hg-file'), 'files', {
    value: [{ name: 'huge.iso', size: MAX_FILE + 1 }], configurable: true
  });
  $('#hg-file').dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(200);
  ok('超过上限的文件被拒绝，并说出实际大小',
    /128\.0 MB/.test(txt('#hg-file-info')), txt('#hg-file-info'));
  ok('拒绝时的语义色挂在子 span 上（.tool-status 用的是后代选择器）',
    $('#hg-file-info').firstElementChild &&
    $('#hg-file-info').firstElementChild.className === 'is-error',
    $('#hg-file-info').firstElementChild &&
    $('#hg-file-info').firstElementChild.className);
  ok('底栏解释原因（一次性接口 + 内存）',
    /一次性/.test(foot()) && /内存/.test(foot()), foot());
  ok('底栏给出替代方案（系统命令）',
    /sha256sum/.test(foot()) || /certutil/.test(foot()), foot());
  await setText('abc');
  ok('被拒绝之后还能继续算文本', stateOf('MD5') === 'ok', stateOf('MD5'));

  /* ---------- 8. 比对框 ---------- */
  section('8. 比对框');
  await setText('abc');
  const md5hex = nodeHex('md5', Buffer.from('abc'));
  const sha256hex = nodeHex('sha256', Buffer.from('abc'));

  await setCompare(sha256hex);
  ok('粘 SHA-256 的十六进制 → 命中，并报出算法',
    compareLevel() === 'is-ok' && /SHA-256/.test(compareOut()), compareOut());

  await setCompare(md5hex.toUpperCase());
  ok('十六进制大小写不敏感', /MD5/.test(compareOut()) && compareLevel() === 'is-ok', compareOut());
  ok('命中 MD5 时顺带提醒它不适合签名',
    /不适合用于签名|已不适合/.test(compareOut()), compareOut());

  await setCompare(nodeB64('sha256', Buffer.from('abc')));
  ok('粘 Base64 也能命中（不管当前显示的是哪种格式）',
    compareLevel() === 'is-ok' && /SHA-256/.test(compareOut()), compareOut());

  await setCompare(sha256hex + '  abc.txt');
  ok('粘 sha256sum 的整行输出也能命中',
    compareLevel() === 'is-ok' && /SHA-256/.test(compareOut()), compareOut());

  await setCompare('SHA256 (abc.txt) = ' + sha256hex);
  ok('粘 sha256sum --tag 那种写法也能命中',
    compareLevel() === 'is-ok' && /SHA-256/.test(compareOut()), compareOut());

  await setCompare(sha256hex.match(/../g).join(':'));
  ok('冒号分隔的指纹写法也能命中',
    compareLevel() === 'is-ok' && /SHA-256/.test(compareOut()), compareOut());

  await setCompare('0'.repeat(64));
  ok('长度对、值不对时指出「算法大概没猜错、是内容不一样」',
    compareLevel() === 'is-error' && /长度像是 SHA-256/.test(compareOut()) &&
    /内容不一样/.test(compareOut()), compareOut());

  await setCompare('zzzz');
  ok('长度都不像任何摘要时说清合法长度',
    compareLevel() === 'is-error' && /32\/40\/64\/96\/128/.test(compareOut()), compareOut());

  await setCompare(nodeB64('sha512', Buffer.from('abc')));
  ok('SHA-512 的 Base64（88 位）也能按长度认出并命中',
    /SHA-512/.test(compareOut()) && compareLevel() === 'is-ok', compareOut());

  await setCompare('');
  ok('清空比对框后提示也清掉', compareOut() === '', compareOut());

  await setCompare(sha256hex);
  await setText('abcd');
  ok('内容变了之后比对结果自动跟着变成不一致',
    compareLevel() === 'is-error', compareOut());
  await setText('abc');

  /* ---------- 9. 复制 ---------- */
  section('9. 复制');
  await setText('abc');
  copied.length = 0;
  await click(copyBtnOf('MD5'));
  ok('单行复制的是这一行的十六进制原文', copied[0] === nodeHex('md5', Buffer.from('abc')),
    JSON.stringify(copied[0]));
  ok('复制后按钮进入「已复制」态（T.util.copy 的反馈）',
    copyBtnOf('MD5').getAttribute('data-copied') === 'true' &&
    copyBtnOf('MD5').textContent === '已复制',
    copyBtnOf('MD5').textContent + '/' + copyBtnOf('MD5').getAttribute('data-copied'));

  await click(formatChip('base64'));
  copied.length = 0;
  await click(copyBtnOf('SHA-256'));
  ok('切到 Base64 后复制的是 Base64', copied[0] === nodeB64('sha256', Buffer.from('abc')),
    JSON.stringify(copied[0]));
  await click(formatChip('hex'));

  copied.length = 0;
  await click($('#hg-copy-all'));
  const allLines = copied[0].split('\n');
  ok('「复制全部」给出五行', allLines.length === 5, String(allLines.length));
  ok('每行是「算法: 值」的形式，且值都对',
    ALGOS.every(([name, algo], i) =>
      allLines[i] === name + ': ' + nodeHex(algo, Buffer.from('abc'))),
    allLines[0]);

  await click($('#hg-clear'));
  await sleep(120);
  ok('清空后「复制全部」被禁用', $('#hg-copy-all').disabled === true);
  ok('清空后禁用原因写在 title 里',
    /还没有可以复制的摘要/.test($('#hg-copy-all').getAttribute('title')),
    $('#hg-copy-all').getAttribute('title'));

  /* ---------- 10. 清空 ---------- */
  section('10. 清空');
  await setText('abc');
  await setCompare('0'.repeat(64));
  await click($('#hg-clear'));
  await sleep(120);
  ok('清空后输入框为空', $('#hg-input').value === '');
  ok('清空后比对框为空', $('#hg-compare').value === '');
  ok('清空后比对提示也清掉', compareOut() === '');
  ok('清空后五行回到空态', rows().every((r) => r.getAttribute('data-state') === 'empty'));
  ok('清空后复制按钮全部禁用', ALGOS.every(([a]) => copyBtnOf(a).disabled === true));

  /* ---------- 11. 隐私 ---------- */
  section('11. 不落盘、不进 URL、不挂表单');
  const SECRET = 'MFRGGZDFMZTWQ2LK';
  await setText(SECRET);
  ok('localStorage 里什么都没写', w.localStorage.length === 0,
    String(w.localStorage.length) + ' 项');
  ok('sessionStorage 里什么都没写', w.sessionStorage.length === 0);
  ok('页面里没有 form', count(d, 'form') === 0);
  ok('地址栏里没有内容', w.location.href.indexOf(SECRET) < 0, w.location.href);
  ok('页面里没有 cookie', d.cookie === '', JSON.stringify(d.cookie));
  ok('说明区写明了「没有草稿功能」', /没有.{0,4}草稿功能/.test(d.body.textContent) ||
    /刷新即清空/.test(d.body.textContent));

  /* ---------- 12. 与 registry 一致 ---------- */
  section('12. 与 registry 一致');
  const tool = w.TOOLBOX.tools.find((t) => t.slug === 'hash-generator');
  ok('registry 里已上线且挂在安全分类',
    tool && tool.status === 'ready' && tool.hub === 'security',
    tool && (tool.status + '/' + tool.hub));
  ok('描述列出了全部五种算法',
    ALGOS.every(([n]) => tool.desc.includes(n)), tool.desc);
  ok('页面 data-tool 与 slug 一致', d.body.getAttribute('data-tool') === 'hash-generator');
  ok('页面属于安全分类', d.body.getAttribute('data-hub') === 'security');

  /* ---------- 13. 与共享模块一致 ---------- */
  section('13. 用的是共享模块，不是自己那份');
  const src = d.querySelector('script[src*="hash-utils"]');
  ok('页面引入了 js/hash-utils.js', !!src);
  ok('没有引入上游那套自带的 md5 实现',
    !/function md5\(/.test(fs.readFileSync(path.join(ROOT, 'js/tools/hash-generator.js'), 'utf8')));
}
