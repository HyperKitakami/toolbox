/* ==========================================================================
   TOTP 动态口令（tools/totp-generator/）
   --------------------------------------------------------------------------
   规范符合性是重点：**让页面通过自己的 UI 复现 RFC 6238 附录 B 的官方向量**。
   做法是把页面的 `Date.now` 换成固定值（工具只在 `now()` 里读一次时钟），
   于是「第 59 秒该出 94287082」这种断言才能真正钉住 ——
   否则只能拿当前时刻算一个自我一致的期望值，证明不了任何东西。

   除此之外覆盖：密钥校验的每一条错误、口令分组与复制、倒计时档位、
   排查表的中间值、otpauth 链接的编码规则、二维码反推矩阵、
   隐私三件套与「显示」开关的一致性、两条实现路径结果一致。
   ========================================================================== */

import crypto from 'node:crypto';
import { ok, section, loadPage, sleep, count } from './_harness.mjs';

/* --- 测试自己的参考实现（先用官方向量验它，再拿它当期望值） -------------- */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function refBase32(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = ((val << 8) | b) & 0xfffff;
    bits += 8;
    while (bits >= 5) { bits -= 5; out += B32[(val >>> bits) & 31]; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  while (out.length % 8) out += '=';
  return out;
}

function refTotp(secret, counter, digits, algo) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac(algo, secret).update(msg).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | ((mac[off + 1] & 0xff) << 16) |
    ((mac[off + 2] & 0xff) << 8) | (mac[off + 3] & 0xff);
  return String(bin % Math.pow(10, digits)).padStart(digits, '0');
}

const RFC_SECRETS = {
  'SHA-1': Buffer.from('12345678901234567890'),
  'SHA-256': Buffer.from('12345678901234567890123456789012'),
  'SHA-512': Buffer.from('1234567890123456789012345678901234567890123456789012345678901234')
};

/* RFC 6238 附录 B 的官方向量（8 位、周期 30、T0 = 0） */
const RFC_VECTORS = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826']
];

const WAIT = 260;
const SAMPLE = 'JBSWY3DPEHPK3PXP';
/* 用一个**不与页面文案撞车**的密钥做通用用例：页面说明区里出现过
   JBSWY3DPEHPK3PXP 和 RFC 的向量密钥，拿它们做「整页搜不到密钥」的断言会误报。 */
const SECRET = 'MFRGGZDFMZTWQ2LK';   /* 10 字节，与示例同为 80 位但字符串不同 */
/* 5 字节 = 40 位：短于 RFC 4226 的 128 位、也短于页面报警告的 64 位门槛 */
const SHORT = refBase32(Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01]));

export default async function run() {
  /* ---------- 0. 先验测试自己的参考实现 ---------- */
  section('0. 参考实现自检（用官方向量验它，否则期望值不可信）');
  const algos = ['SHA-1', 'SHA-256', 'SHA-512'];
  let refBad = 0;
  RFC_VECTORS.forEach(([t, ...want]) => {
    algos.forEach((a, i) => {
      if (refTotp(RFC_SECRETS[a], Math.floor(t / 30), 8, a.toLowerCase()) !== want[i]) refBad++;
    });
  });
  ok('参考实现复现全部 18 条官方向量', refBad === 0, String(refBad) + ' 条不符');

  const B32_SECRETS = {};
  algos.forEach((a) => { B32_SECRETS[a] = refBase32(RFC_SECRETS[a]); });
  ok('RFC 的 SHA-1 密钥 base32 是 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    B32_SECRETS['SHA-1'] === 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', B32_SECRETS['SHA-1']);

  /* ---------- 页面 ---------- */
  const copied = [];
  const ctx = await loadPage('tools/totp-generator/index.html', {
    clipboard: (t) => copied.push(t)
  });
  const w = ctx.w;
  const d = ctx.d;
  const $ = (s) => d.querySelector(s);
  const txt = (s) => ($(s) ? $(s).textContent : '');

  const status = () => txt('#totp-secret-status');
  /* 语义色按本站约定加在**子 span** 上（CSS 是 .tool-status .is-error 这种后代选择器） */
  const level = () => {
    const c = $('#totp-secret-status').firstElementChild;
    return c ? c.className : '';
  };
  const foot = () => txt('#totp-status');
  const codeText = () => txt('#totp-code');
  const codeState = () => $('#totp-code').getAttribute('data-state');
  const remaining = () => txt('#totp-remaining');
  const barWidth = () => parseFloat($('#totp-bar').style.width) || 0;
  const barState = () => $('#totp-bar').getAttribute('data-state');
  const parts = () => {
    const out = {};
    [...d.querySelectorAll('#totp-parts .value-row')].forEach((r) => {
      out[r.querySelector('.value-label').textContent] = r.querySelector('.value-text').textContent;
    });
    return out;
  };
  const uriText = () => txt('#totp-uri-text');
  const qrSvg = () => $('#totp-qr svg');

  const click = async (el) => {
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(WAIT);
  };
  const setInput = async (el, v) => {
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(WAIT);
  };
  const chip = (groupId, value) =>
    d.querySelector('#' + groupId + ' [data-value="' + value + '"]');
  const setSecret = (v) => setInput($('#totp-secret'), v);

  const revealBtn = $('#totp-reveal');
  const ensureHidden = async () => {
    if (revealBtn.textContent === '隐藏') await click(revealBtn);
  };
  const ensureRevealed = async () => {
    if (revealBtn.textContent !== '隐藏') await click(revealBtn);
  };

  /* 把页面读到的时钟换成固定值。工具只在 now() 里调用 Date.now()，
     所以替换 window.Date 就够了（不动宿主环境的 Date）。 */
  const RealDate = w.Date;
  const freeze = (sec) => {
    w.Date = { now: () => sec * 1000 };
  };
  const unfreeze = () => { w.Date = RealDate; };

  /* ---------- 1. 初始状态 ---------- */
  section('1. 初始状态');
  ok('页面脚本没有报错', ctx.errors.length === 0, ctx.errors.slice(0, 2).join(' / '));
  ok('依赖缺失的提示没有露出来', $('#totp-error').hidden === true);
  ok('口令是占位符', codeText() === '—', codeText());
  ok('口令处于空态', codeState() === 'empty');
  ok('复制按钮被禁用', $('#totp-copy').disabled === true);
  ok('禁用原因写在 title 里', /还没有可复制的口令/.test($('#totp-copy').getAttribute('title')),
    $('#totp-copy').getAttribute('title'));
  ok('倒计时提示是「填入密钥后开始计时」', remaining() === '填入密钥后开始计时', remaining());
  ok('倒计时条是 0 宽', barWidth() === 0);
  ok('三个选项组都渲染出来了',
    count(d, '#totp-digits .choice-chip') === 2 &&
    count(d, '#totp-period .choice-chip') === 2 &&
    count(d, '#totp-algos .choice-chip') === 0 &&
    count(d, '#totp-algo .choice-chip') === 3,
    ['#totp-digits', '#totp-period', '#totp-algo'].map((s) => count(d, s + ' .choice-chip')).join('/'));
  ok('默认选中 6 位 / 30 秒 / SHA-1',
    chip('totp-digits', '6').getAttribute('aria-pressed') === 'true' &&
    chip('totp-period', '30').getAttribute('aria-pressed') === 'true' &&
    chip('totp-algo', 'SHA-1').getAttribute('aria-pressed') === 'true');
  ok('密钥框默认是遮着的', $('#totp-secret').getAttribute('type') === 'password');
  ok('密钥框关掉了自动完成与拼写检查',
    $('#totp-secret').getAttribute('autocomplete') === 'off' &&
    $('#totp-secret').getAttribute('spellcheck') === 'false' &&
    !$('#totp-secret').hasAttribute('name'));
  ok('排查表显示空状态', count(d, '#totp-parts .totp-empty') === 1);
  ok('二维码区显示「还没有二维码」', /还没有二维码/.test(txt('#totp-qr')));
  ok('链接按钮是禁用的', $('#totp-uri').disabled === true);

  /* ---------- 2. 密钥校验 ---------- */
  section('2. 密钥校验（逐条给原因）');
  await setSecret('ABC');
  ok('长度不对时标红输入框', $('#totp-secret').classList.contains('input--invalid'));
  ok('长度不对时说清合法长度', /去掉填充后有 3 个字符/.test(status()) && /0 \/ 2 \/ 4 \/ 5 \/ 7/.test(status()),
    status());
  ok('状态行是错误档', level() === 'is-error', level());
  /* 回归：`.tool-status .is-error` 是后代选择器，类必须挂在子 span 上。
     挂在同一个元素上「测试还是会绿」（classList 里查得到），但颜色与加粗
     一点都吃不到 —— 浏览器里截图才发现文案是灰的。 */
  ok('语义色的类挂在子 span 上，不是同一个元素上',
    $('#totp-secret-status').className === 'tool-status' &&
    $('#totp-secret-status').firstElementChild.tagName === 'SPAN',
    $('#totp-secret-status').className + ' / ' +
    $('#totp-secret-status').firstElementChild.tagName);

  await setSecret('MFRGGZDFMZTWQ2L1');
  ok('非法字符指出是第几个、是哪个字符',
    /第 16 个有效字符/.test(status()) && /「1」/.test(status()), status());

  await setSecret('MFRGGZDFMZTWQ2L');
  ok('残留位非零时说「不是规范编码」', /不是规范编码/.test(status()), status());

  await setSecret('MFRGGZDFMZTWQ2LK=');
  ok('填充个数不对时说出来', /填充符个数不对|长度不对/.test(status()), status());

  await setSecret('AB');
  ok('残留位非零的短串也被拒', /不是规范编码/.test(status()), status());
  ok('被拒时口令仍是占位符', codeText() === '—', codeText());
  ok('被拒时不生成二维码', qrSvg() === null);
  ok('被拒时倒计时不启动', remaining() === '填入密钥后开始计时', remaining());

  /* 上游宽松实现会把这些接下去，这里贴出来当对照 */
  ok('对照：上游对同样的输入会算出口令（本实现拒绝）',
    ['ABC', 'AB', 'MFRGGZDFMZTWQ2L'].every((s) => w.TOOLBOX.hash.base32Decode(s).error !== null));

  await setSecret(SECRET);
  ok('合法密钥不再标红', !$('#totp-secret').classList.contains('input--invalid'));
  ok('状态行报出字节数与位数', /10 字节（80 位）/.test(status()), status());
  ok('80 位不算太短，是 ok 档而不是警告', level() === 'is-ok',
    $('#totp-secret-status').className);
  ok('底栏说明不保存、不联网', /不会保存/.test(foot()) && /本机/.test(foot()), foot());

  await setSecret(SHORT);
  ok('短于 64 位时给警告并说明原因',
    level() === 'is-warn' && /只有 40 位/.test(status()), level() + ' / ' + status());
  ok('短密钥仍然能算出口令（只是警告）', /^\d{3} \d{3}$/.test(codeText()), codeText());

  await setSecret(SECRET);
  ok('改回长密钥后回到 ok 档', level() === 'is-ok', level());

  /* ---------- 3. RFC 6238 官方向量 ---------- */
  section('3. RFC 6238 附录 B 官方向量（把页面时钟冻住）');

  /* 8 位、周期 30 —— 与 RFC 的取值一致 */
  await click(chip('totp-digits', '8'));

  const vecCases = [];
  algos.forEach((a, i) => {
    vecCases.push([a, 59, RFC_VECTORS[0][1 + i]]);
  });
  vecCases.push(['SHA-1', 1111111109, '07081804']);
  vecCases.push(['SHA-1', 1234567890, '89005924']);
  /* RFC 6238 §4.2 明确要求 T 支持超过 32 位的时间；这条专门压那一段 */
  vecCases.push(['SHA-1', 20000000000, '65353130']);
  vecCases.push(['SHA-256', 20000000000, '77737706']);
  vecCases.push(['SHA-512', 1111111111, '99943326']);

  for (const [algo, t, want] of vecCases) {
    await click(chip('totp-algo', algo));
    await setSecret(B32_SECRETS[algo]);
    freeze(t);
    await click(chip('totp-period', '30'));
    await sleep(120);
    const got = codeText().replace(' ', '');
    ok('t=' + t + ' · ' + algo + ' + 8 位 → ' + want,
      got === want, got + '（页面上是「' + codeText() + '」）');
  }
  ok('带填充的 SHA-512 向量密钥通过了校验',
    !$('#totp-secret').classList.contains('input--invalid'), status());

  /* 交叉验证：同一时刻，页面与测试自己的参考实现要一致 */
  freeze(1700000000);
  await click(chip('totp-algo', 'SHA-256'));
  await setSecret(SECRET);
  await sleep(120);
  const counterNow = Math.floor(1700000000 / 30);
  const want256 = refTotp(w.TOOLBOX.hash.base32Decode(SECRET).bytes, counterNow, 8, 'sha256');
  ok('换个时刻、换个算法，页面与参考实现给出同一个口令',
    codeText().replace(' ', '') === want256, codeText() + ' vs ' + want256);

  await click(chip('totp-digits', '6'));
  await click(chip('totp-algo', 'SHA-1'));   /* 复位，后面的用例都按默认档位走 */
  unfreeze();
  await sleep(120);

  /* ---------- 4. 分组与复制 ---------- */
  section('4. 口令分组与复制');
  freeze(59);
  await setSecret(SECRET);
  await sleep(120);
  ok('6 位口令按「3 + 空格 + 3」分组', /^\d{3} \d{3}$/.test(codeText()), codeText());
  await click(chip('totp-digits', '8'));
  ok('8 位口令按「4 + 空格 + 4」分组', /^\d{4} \d{4}$/.test(codeText()), codeText());
  await click(chip('totp-digits', '6'));

  copied.length = 0;
  await click($('#totp-copy'));
  ok('复制的是**不含空格**的六位数字', /^\d{6}$/.test(copied[0]), JSON.stringify(copied[0]));
  ok('复制的内容与显示一致（去掉空格）', copied[0] === codeText().replace(' ', ''));

  copied.length = 0;
  await click($('#totp-code'));
  ok('点口令本身也能复制', /^\d{6}$/.test(copied[0]), JSON.stringify(copied[0]));
  ok('口令的 title 写明点一下会复制',
    /点击复制 \d{6}（不含空格）/.test($('#totp-code').getAttribute('title')),
    $('#totp-code').getAttribute('title'));
  ok('口令是 <button>（键盘可达），不是 <div>', $('#totp-code').tagName === 'BUTTON');
  ok('口令外面那层是 aria-live 区域',
    $('#totp-code-live').getAttribute('aria-live') === 'polite');

  /* ---------- 5. 倒计时 ---------- */
  section('5. 倒计时');
  freeze(59);            /* 59 秒 → 桶内第 29 秒，还剩 1 秒 */
  await setSecret(SECRET);
  await sleep(120);
  ok('还剩 1 秒', /还剩 1 秒/.test(remaining()), remaining());
  ok('每 30 秒换一次也写出来了', /每 30 秒换一次/.test(remaining()), remaining());
  ok('剩 1 秒时进度条进 crit 档', barState() === 'crit', barState());
  ok('进度条宽度接近 0', barWidth() < 5, String(barWidth()));

  freeze(75);            /* 桶内第 15 秒 → 还剩 15 秒 */
  await sleep(60);
  await setSecret(SECRET);
  await sleep(120);
  ok('还剩 15 秒', /还剩 15 秒/.test(remaining()), remaining());
  ok('剩 15 秒是 ok 档', barState() === 'ok', barState());
  ok('进度条约一半宽', barWidth() > 45 && barWidth() < 55, String(barWidth()));

  freeze(84);            /* 桶内第 24 秒 → 还剩 6 秒 */
  await sleep(60);
  await setSecret(SECRET);
  await sleep(120);
  ok('还剩 6 秒时进 low 档', barState() === 'low', remaining() + ' / ' + barState());

  /* 时间桶的边界：30 秒一个桶，桶是 [30k, 30k+30)。
     所以 59 与 60 跨桶，60 与 89 同桶。 */
  freeze(59);
  await setSecret(SECRET);
  await sleep(120);
  const codeAt59 = codeText();
  freeze(60);
  await setSecret(SECRET);
  await sleep(120);
  const codeAt60 = codeText();
  ok('59 → 60 跨过桶边界（⌊59/30⌋=1 vs ⌊60/30⌋=2），口令变了',
    codeAt60 !== codeAt59, codeAt59 + ' vs ' + codeAt60);
  freeze(89);
  await setSecret(SECRET);
  await sleep(120);
  ok('60 与 89 在同一个桶里（都是 ⌊·/30⌋=2），口令一样',
    codeText() === codeAt60, codeAt60 + ' vs ' + codeText());

  /* ---------- 6. 排查表 ---------- */
  section('6. 排查表（中间值）');
  freeze(59);
  await setSecret(SECRET);
  await sleep(120);
  const p = parts();
  ok('列出了当前时刻', p['当前时刻'] === '59 秒（Unix 时间）', p['当前时刻']);
  ok('列出了步长', p['步长 X'] === '30 秒', p['步长 X']);
  ok('计数器是 ⌊59 ÷ 30⌋ = 1', /^1（⌊59 ÷ 30⌋）$/.test(p['计数器 T']), p['计数器 T']);
  ok('计数器按 8 字节大端给出，就是 HMAC 的输入',
    p['HMAC 输入'] === '0000000000000001（计数器，8 字节大端）', p['HMAC 输入']);
  ok('标出算法与密钥长度', /^SHA-1 · 10 字节（80 位）$/.test(p['算法 / 密钥']), p['算法 / 密钥']);
  ok('标出用的是哪条实现（jsdom 没有 crypto.subtle，所以是纯 JS）',
    p['计算方式'] === '纯 JS 实现（没有 crypto.subtle）', p['计算方式']);
  ok('排查表有 6 行', Object.keys(p).length === 6, String(Object.keys(p).length));

  freeze(20000000000);
  await setSecret(SECRET);
  await sleep(120);
  const p2 = parts();
  ok('超大时刻的计数器按 8 字节补零',
    /^666666666（⌊20000000000 ÷ 30⌋）$/.test(p2['计数器 T']), p2['计数器 T']);
  ok('计数器十六进制是 0000000027bc86aa',
    p2['HMAC 输入'].indexOf('0000000027bc86aa') === 0, p2['HMAC 输入']);

  /* ---------- 7. otpauth 链接 ---------- */
  section('7. otpauth 链接');
  freeze(59);
  await setSecret(SECRET);
  await ensureRevealed();
  await setInput($('#totp-account'), '');
  await setInput($('#totp-issuer'), '');
  const uri = uriText();
  ok('以 otpauth://totp/ 开头', uri.startsWith('otpauth://totp/'), uri);
  ok('secret 是重新编码后的规范 Base32（含填充）',
    uri.includes('secret=' + w.TOOLBOX.hash.base32Encode(
      w.TOOLBOX.hash.base32Decode(SECRET).bytes)), uri);
  ok('算法参数不带连字符（Key URI Format 的写法）', uri.includes('algorithm=SHA1'), uri);
  ok('带 digits 与 period', uri.includes('digits=6') && uri.includes('period=30'), uri);
  ok('没有发行方时不写 issuer 参数', !uri.includes('issuer='), uri);
  ok('账号留空时 label 用「工具箱」兜底',
    uri.startsWith('otpauth://totp/' + encodeURIComponent('工具箱') + '?'), uri);

  await setInput($('#totp-account'), 'you@example.com');
  ok('账号进了 label', uriText().includes('totp/' + encodeURIComponent('you@example.com') + '?'),
    uriText());

  await setInput($('#totp-issuer'), 'Example Inc');
  ok('有发行方时 label 变成「发行方:账号」',
    uriText().includes('totp/' + encodeURIComponent('Example Inc') + ':' +
      encodeURIComponent('you@example.com') + '?'), uriText());
  ok('发行方同时写进 issuer 参数', uriText().includes('issuer=Example%20Inc'), uriText());
  ok('label 里的冒号是分隔符本身，没有被编成 %3A',
    uriText().includes('%20Inc:' + encodeURIComponent('you@example.com')) &&
    !uriText().includes('%20Inc%3A'), uriText());

  await setInput($('#totp-account'), 'a:b');
  ok('账号里的冒号被百分号编码，**不是**被悄悄删掉',
    uriText().includes('a%3Ab') && !uriText().includes('ab?'), uriText());

  await setInput($('#totp-account'), '张三');
  ok('中文账号被正确编码', uriText().includes(encodeURIComponent('张三')), uriText());

  await setInput($('#totp-account'), '');
  await setInput($('#totp-issuer'), '');
  copied.length = 0;
  await click($('#totp-uri'));
  ok('点链接会复制 otpauth 链接', copied[0] === uriText() && copied[0].startsWith('otpauth://'),
    JSON.stringify(copied[0]));

  await click(chip('totp-digits', '8'));
  await click(chip('totp-period', '60'));
  await click(chip('totp-algo', 'SHA-256'));
  ok('改选项后链接跟着变',
    uriText().includes('digits=8') && uriText().includes('period=60') &&
    uriText().includes('algorithm=SHA256'), uriText());
  await click(chip('totp-digits', '6'));
  await click(chip('totp-period', '30'));
  await click(chip('totp-algo', 'SHA-1'));

  /* ---------- 8. 二维码 ---------- */
  section('8. 二维码（反推矩阵与内置库比对）');

  const matrixFromSvg = (node) => {
    const total = Number(node.getAttribute('viewBox').split(/\s+/)[2]);
    const grid = Array.from({ length: total }, () => new Array(total).fill(0));
    [...node.querySelectorAll('rect')].forEach((r) => {
      if (r.getAttribute('width') === '100%') return;
      if (r.getAttribute('width') !== '1') return;
      grid[Number(r.getAttribute('y'))][Number(r.getAttribute('x'))] = 1;
    });
    return { total, grid };
  };
  const matrixFromLib = (text) => {
    const q = w.qrcode(0, 'M');
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    const quiet = 4;
    const total = n + quiet * 2;
    const grid = Array.from({ length: total }, () => new Array(total).fill(0));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (q.isDark(r, c)) grid[r + quiet][c + quiet] = 1;
    }
    return { total, grid };
  };
  const sameMatrix = (a, b) =>
    a.total === b.total && a.grid.every((row, r) => row.every((v, c) => v === b.grid[r][c]));

  await setSecret(SECRET);
  await ensureRevealed();
  ok('显示状态下生成了 SVG 二维码', qrSvg() !== null);
  ok('SVG 带 role 与可读名称',
    qrSvg().getAttribute('role') === 'img' &&
    qrSvg().getAttribute('aria-label') === 'otpauth 二维码',
    qrSvg().getAttribute('aria-label'));
  ok('二维码反推出来的矩阵，等于内置库对同一条 otpauth 链接算出来的矩阵',
    sameMatrix(matrixFromSvg(qrSvg()), matrixFromLib(uriText())),
    '维度 ' + matrixFromSvg(qrSvg()).total + ' vs ' + matrixFromLib(uriText()).total);
  ok('二维码固定用深模块 + 白底（不跟随主题，反色扫不出来）',
    qrSvg().querySelector('rect[width="100%"]').getAttribute('fill') === '#ffffff' &&
    qrSvg().querySelector('g').getAttribute('fill') === '#111111',
    qrSvg().querySelector('g').getAttribute('fill'));

  const m1 = matrixFromSvg(qrSvg());
  await setInput($('#totp-account'), 'changed@example.com');
  const m2 = matrixFromSvg(qrSvg());
  ok('账号变化后二维码内容跟着变', !sameMatrix(m1, m2));
  ok('新二维码仍然等于内置库对当前链接算出来的矩阵',
    sameMatrix(m2, matrixFromLib(uriText())),
    '维度 ' + m2.total + ' vs ' + matrixFromLib(uriText()).total);
  await setInput($('#totp-account'), '');

  /* 引擎缺失时的降级 */
  const realQrcode = w.qrcode;
  w.qrcode = undefined;
  await setInput($('#totp-account'), 'x');
  await setInput($('#totp-account'), '');
  ok('二维码引擎缺失时给说明，而不是静默消失',
    qrSvg() === null && /二维码引擎没加载上/.test(txt('#totp-qr')), txt('#totp-qr'));
  ok('引擎缺失不影响 otpauth 链接', uriText().startsWith('otpauth://'), uriText());
  w.qrcode = realQrcode;
  await setInput($('#totp-account'), 'x');
  await setInput($('#totp-account'), '');
  ok('恢复引擎后二维码回来了', qrSvg() !== null);

  /* ---------- 9. 隐私与遮罩一致性 ---------- */
  section('9. 隐私与「显示 / 隐藏」的一致性');
  await ensureHidden();
  ok('默认是隐藏态', revealBtn.textContent === '显示', revealBtn.textContent);
  ok('按钮不假装自己是开关（没有 aria-pressed）', !revealBtn.hasAttribute('aria-pressed'));
  ok('按钮用 aria-controls 指向输入框',
    revealBtn.getAttribute('aria-controls') === 'totp-secret');
  ok('隐藏时输入框是 password', $('#totp-secret').getAttribute('type') === 'password');
  ok('隐藏时**不生成**二维码（二维码就是密钥的另一种写法）',
    qrSvg() === null && /已隐藏/.test(txt('#totp-qr')), txt('#totp-qr'));
  ok('隐藏时链接按钮被禁用', $('#totp-uri').disabled === true);
  ok('隐藏时链接显示出「已隐藏」而不是密钥原文',
    /已隐藏/.test(uriText()) && !uriText().includes('secret='), uriText());
  ok('隐藏时整页 DOM 里搜不到密钥（正文与 innerHTML 都搜）',
    d.body.textContent.indexOf(SECRET) < 0 &&
    d.body.innerHTML.indexOf(SECRET) < 0 &&
    d.body.innerHTML.toLowerCase().indexOf(SECRET.toLowerCase()) < 0);
  ok('口令本身照常显示（它是派生的、30 秒就过期）', /^\d{6}$|^\d{3} \d{3}$/.test(codeText()), codeText());

  await ensureRevealed();
  ok('显示后输入框变 text', $('#totp-secret').getAttribute('type') === 'text');
  ok('按钮文案变成「隐藏」', revealBtn.textContent === '隐藏');
  ok('显示后二维码出现', qrSvg() !== null);
  ok('显示后链接可用且带出密钥原文',
    $('#totp-uri').disabled === false && uriText().includes('secret='), uriText());

  await ensureHidden();
  ok('再点一次能回到隐藏（来回都通）',
    $('#totp-secret').getAttribute('type') === 'password' && qrSvg() === null &&
    $('#totp-uri').disabled === true && !uriText().includes('secret='));
  await ensureRevealed();
  ok('第二次显示也正常（不是单向开关）', qrSvg() !== null && uriText().includes('secret='));
  await ensureHidden();

  section('10. 不落盘、不进 URL、不挂表单');
  ok('localStorage 里什么都没写', w.localStorage.length === 0,
    String(w.localStorage.length) + ' 项');
  ok('sessionStorage 里什么都没写', w.sessionStorage.length === 0);
  ok('页面里没有 form（不会被浏览器当登录表单接管）', count(d, 'form') === 0);
  ok('地址栏里没有密钥', w.location.href.indexOf(SECRET) < 0, w.location.href);
  ok('页面里没有 cookie', d.cookie === '', JSON.stringify(d.cookie));

  /* ---------- 11. 两条实现路径 ---------- */
  section('11. 平台实现与纯 JS 实现给出同一个口令');
  freeze(1700000000);
  await setSecret(SECRET);
  await sleep(120);
  const pureCode = codeText();
  const pureParts = parts();
  /* 把 Node 的 crypto.subtle 借给 jsdom —— 页面会认成「浏览器原生实现」 */
  Object.defineProperty(w.crypto, 'subtle', {
    value: globalThis.crypto.subtle, configurable: true
  });
  /* 换一次周期再换回来，强制走一次重算（口令本身不变，因为时间桶会被换回同一个） */
  await click(chip('totp-period', '60'));
  await click(chip('totp-period', '30'));
  await sleep(200);
  ok('页面认出了平台实现',
    parts()['计算方式'] === '浏览器原生 crypto.subtle', parts()['计算方式']);
  ok('原生实现算出的口令与纯 JS 一致', codeText() === pureCode,
    pureCode + ' vs ' + codeText());
  ok('排查表的其它行也不变',
    JSON.stringify(Object.keys(parts())) === JSON.stringify(Object.keys(pureParts)));

  /* ---------- 12. 示例与清空 ---------- */
  section('12. 填入示例与清空');
  unfreeze();
  await ensureHidden();
  await click($('#totp-demo'));
  ok('示例密钥填进去了', $('#totp-secret').value === SAMPLE, $('#totp-secret').value);
  ok('示例不改动「显示 / 隐藏」的状态（遮着就还是遮着）',
    revealBtn.textContent === '显示' &&
    $('#totp-secret').getAttribute('type') === 'password');
  ok('示例立刻算出六位口令', /^\d{3} \d{3}$/.test(codeText()), codeText());
  ok('页面里写的示例密钥与「填入示例」用的是同一个',
    ($('#totp-secret').getAttribute('placeholder') || '').includes(SAMPLE),
    $('#totp-secret').getAttribute('placeholder'));

  await click($('#totp-clear'));
  ok('清空后输入框为空', $('#totp-secret').value === '');
  ok('清空后账号与发行方也清掉',
    $('#totp-account').value === '' && $('#totp-issuer').value === '');
  ok('清空后口令回到占位符', codeText() === '—' && codeState() === 'empty');
  ok('清空后复制按钮禁用', $('#totp-copy').disabled === true);
  ok('清空后二维码与链接也收起来',
    qrSvg() === null && $('#totp-uri').disabled === true);
  ok('清空后状态行只剩「还没填密钥」', status() === '还没填密钥。', status());
  ok('清空后整页搜不到刚才那个密钥', d.body.innerHTML.indexOf(SECRET) < 0);
  ok('清空后排查表回到空状态', count(d, '#totp-parts .totp-empty') === 1);

  /* ---------- 13. 与 registry 一致 ---------- */
  section('13. 与 registry 一致');
  const tool = w.TOOLBOX.tools.find((t) => t.slug === 'totp-generator');
  ok('registry 里已上线且挂在安全分类',
    tool && tool.status === 'ready' && tool.hub === 'security',
    tool && (tool.status + '/' + tool.hub));
  ok('描述与实现一致（提到 RFC、二维码、严格校验）',
    /RFC 6238/.test(tool.desc) && /二维码/.test(tool.desc) && /校验/.test(tool.desc),
    tool.desc);
  ok('页面 data-tool 与 slug 一致', d.body.getAttribute('data-tool') === 'totp-generator');
  ok('页面属于安全分类', d.body.getAttribute('data-hub') === 'security');
}
