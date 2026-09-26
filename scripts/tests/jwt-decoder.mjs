/* ==========================================================================
   JWT 解码（jwt-decoder）测试
   --------------------------------------------------------------------------
   全部用真实 DOM 交互驱动：设 textarea.value + dispatch input + 等防抖，
   不直接调工具内部函数。
   期望值一律手算/独立算（字节数用 Buffer.byteLength 另算一遍，
   十六进制按「N 个 00」自己拼），不是「跑一遍看输出是多少」抄下来的。
   时间类断言一律取相对当前时间的偏移（3660 / 7260 这种留了安全余量，
   避免跨秒时把「1 小时」算成「59 分 59 秒」）。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

/* --- 造 Token 的独立实现（不复用被测代码里的任何东西） ------------------ */
const b64url = (bytes) => Buffer.from(bytes).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64std = (bytes) => Buffer.from(bytes).toString('base64');
const enc = (str) => b64url(Buffer.from(str, 'utf8'));
const str = (obj) => JSON.stringify(obj);

const SIG32 = b64url(Buffer.alloc(32, 0));          /* 32 字节全 0：十六进制是 32 个 00 */
const token = (header, payload, sig) =>
  enc(str(header)) + '.' + enc(str(payload)) + '.' + (sig === undefined ? SIG32 : sig);

export default async function run() {
  let copied = null;
  let copiedCount = 0;
  const ctx = await loadPage('tools/jwt-decoder/index.html', {
    clipboard: (t) => { copied = t; copiedCount++; }
  });
  const { d, w, errors } = ctx;

  const $ = (sel) => d.querySelector(sel);
  const input = d.getElementById('jwt-input');
  const statusEl = d.getElementById('jwt-status');
  const warnsEl = d.getElementById('jwt-warns');

  /* 代码视图渲染出的文本。renderCode 把每行放进 .code-line-body，
     textContent 读回来会把实体还原成原字符，正好等于被渲染的原文。 */
  const out = () => [...d.querySelectorAll('#jwt-code .code-line-body')]
    .map((e) => e.textContent).join('\n');

  const rows = () => [...d.querySelectorAll('#jwt-claims tbody tr')];
  const claimKeys = () => rows().map((r) => r.children[0].textContent);
  const claimRow = (key) => rows().find((r) => r.children[0].textContent === key);
  const claimText = (key, col) => {
    const r = claimRow(key);
    return r ? r.children[col].textContent : '(没有这一行)';
  };
  const statVal = (label) => {
    const hit = [...d.querySelectorAll('#jwt-stats .stat')]
      .find((s) => s.querySelector('.stat-label').textContent === label);
    return hit ? hit.querySelector('.stat-value').textContent : '(没有这一格)';
  };
  const noticeText = () => [...d.querySelectorAll('#jwt-warns .notice')]
    .map((n) => n.textContent).join(' | ');
  const warnNotices = () => [...d.querySelectorAll('#jwt-warns .notice--warn')];
  const sigRows = () => [...d.querySelectorAll('#jwt-sig .value-row')];
  const sigVal = (label) => {
    const hit = sigRows().find((r) => r.querySelector('.value-label').textContent === label);
    return hit ? hit.querySelector('.value-text').textContent : '(没有这一行)';
  };

  /* 输入走 80ms 防抖；全量测试时 CPU 很忙，余量留到 260ms
     （时间戳套件就是因为 170ms 不够而偶发失败过）。 */
  const setToken = async (text) => {
    input.value = text;
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(260);
  };
  const click = async (sel) => {
    const el = typeof sel === 'string' ? $(sel) : sel;
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(40);
  };

  /* 现取「现在」，所有用例都基于它算偏移 */
  const now = Math.floor(Date.now() / 1000);

  /* ---------- 1. 基本渲染 ---------- */
  section('1. 基本渲染');

  ok('无脚本错误', errors.length === 0, errors.join(' | '));
  ok('空输入时结果区显示空态', $('#jwt-code .code-empty') !== null);
  ok('空输入时声明区显示空态', $('#jwt-claims .table-empty') !== null);
  ok('空输入时概览六格都是「—」',
    [...d.querySelectorAll('#jwt-stats .stat-value')].length === 6 &&
    [...d.querySelectorAll('#jwt-stats .stat-value')].every((v) => v.textContent === '—'));
  ok('空输入时不渲染三段格子', count(d, '#jwt-parts .jwt-part') === 0);
  ok('空输入时状态行为空', statusEl.textContent === '', JSON.stringify(statusEl.textContent));
  ok('空输入时底栏给的是引导语', d.getElementById('jwt-foot').textContent.includes('粘贴到左侧'));
  ok('默认停在「载荷」Tab',
    $('[data-tab="payload"]').getAttribute('aria-pressed') === 'true' &&
    $('[data-tab="header"]').getAttribute('aria-pressed') === 'false' &&
    $('[data-tab="signature"]').getAttribute('aria-pressed') === 'false');
  ok('签名栏初始隐藏、代码栏可见',
    d.getElementById('jwt-sig').hidden === true && d.getElementById('jwt-code').hidden === false);

  /* ---------- 2. 典型的 HS256 Token ---------- */
  section('2. 典型 Token：三段、声明表、时效');

  const header = { alg: 'HS256', typ: 'JWT', kid: 'demo-key-1' };
  const payload = {
    iss: 'https://issuer.example.com',
    sub: 'user-1024',
    aud: ['api.example.com', 'web.example.com'],
    exp: now + 3660,
    nbf: now - 60,
    iat: now - 600,
    jti: 'J-1',
    tenant: 'acme'
  };
  const tok = token(header, payload);

  await setToken(tok);

  ok('状态行报三段与字符数',
    statusEl.textContent === '3 段 · 共 ' + tok.length + ' 个字符', statusEl.textContent);
  ok('状态行不是错误态', statusEl.className.indexOf('is-error') < 0, statusEl.className);

  /* 字节数自己算一遍：JSON 的 UTF-8 字节数 */
  const headerBytes = Buffer.byteLength(str(header), 'utf8');
  const payloadBytes = Buffer.byteLength(str(payload), 'utf8');
  ok('三段格子各报解码后的字节数',
    [...d.querySelectorAll('#jwt-parts .jwt-part')].map((p) => p.textContent.trim()).join(' / ') ===
      '头部' + headerBytes + ' 字节 / 载荷' + payloadBytes + ' 字节 / 签名32 字节',
    [...d.querySelectorAll('#jwt-parts .jwt-part')].map((p) => p.textContent.trim()).join(' / '));

  ok('时效 = 有效期内', statVal('时效') === '有效期内', statVal('时效'));
  ok('剩余时间算成 1 小时 1 分（3660 秒）', statVal('剩余 / 超期') === '还剩 1 小时 1 分',
    statVal('剩余 / 超期'));
  ok('签名算法去掉 JSON 引号显示', statVal('签名算法') === 'HS256', statVal('签名算法'));
  ok('令牌类型 = JWT', statVal('令牌类型') === 'JWT', statVal('令牌类型'));
  ok('载荷字节数与独立计算一致', statVal('载荷') === payloadBytes + ' 字节', statVal('载荷'));
  ok('签名字节数 = 32', statVal('签名') === '32 字节', statVal('签名'));

  ok('没有问题时整块安全提示隐藏', warnsEl.hidden === true && warnsEl.innerHTML === '');

  ok('声明数是 8 行', rows().length === 8, String(rows().length));
  ok('声明按「注册声明在前、其余保持原序」排列',
    claimKeys().join(',') === 'iss,sub,aud,exp,nbf,iat,jti,tenant', claimKeys().join(','));
  ok('声明计数说明注册声明的个数',
    d.getElementById('jwt-claim-count').textContent === '8 个声明 · 其中 7 个注册声明',
    d.getElementById('jwt-claim-count').textContent);
  ok('每行都标了声明类别', count(d, '#jwt-claims .jwt-claim-kind') === 8);
  ok('iss 行写明是签发者', claimText('iss', 2).includes('签发者'), claimText('iss', 2));
  ok('iss 行标成注册声明', claimText('iss', 2).includes('注册声明'), claimText('iss', 2));
  ok('数组值原样按 JSON 显示',
    claimText('aud', 1) === '["api.example.com","web.example.com"]', claimText('aud', 1));
  ok('exp 行给出本机时间与剩余时长',
    claimText('exp', 2).includes('还剩 1 小时 1 分') &&
    /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC[+-]\d{2}:\d{2}/.test(claimText('exp', 2)),
    claimText('exp', 2));
  ok('exp 的剩余时长标成 ok 色',
    claimRow('exp').querySelector('.jwt-time--ok') !== null);
  ok('iat 行给出「多久以前」', claimText('iat', 2).includes('前'), claimText('iat', 2));
  ok('nbf 行给出「已生效多久」', claimText('nbf', 2).includes('已生效'), claimText('nbf', 2));
  ok('自定义声明被标出来', claimText('tenant', 2).includes('自定义声明'), claimText('tenant', 2));
  ok('自定义声明提示要看签发方文档',
    claimText('tenant', 2).includes('签发方'), claimText('tenant', 2));

  ok('载荷 Tab 展示格式化后的 JSON',
    out().includes('"iss": "https://issuer.example.com"'), out().slice(0, 80));
  ok('载荷底注给出字节数与声明数',
    d.getElementById('jwt-tab-foot').textContent === '载荷 · ' + payloadBytes + ' 字节 · 8 个声明',
    d.getElementById('jwt-tab-foot').textContent);
  ok('底栏把三段字节数与本机时间都写出来',
    d.getElementById('jwt-foot').textContent ===
      '头部 ' + headerBytes + ' 字节 · 载荷 ' + payloadBytes + ' 字节 · 签名 32 字节 · 本机时间 ' +
      [...d.querySelectorAll('#jwt-foot')].map(() => d.getElementById('jwt-foot').textContent
        .replace(/^.*本机时间 /, ''))[0],
    d.getElementById('jwt-foot').textContent);

  /* ---------- 3. base64url 的边界 ---------- */
  section('3. base64url 与 UTF-8 的边界');

  await setToken(token({ alg: 'HS256', typ: 'JWT' }, { name: '张三', note: 'café' }));
  ok('非 ASCII 载荷能解出来', claimText('name', 1) === '"张三"', claimText('name', 1));
  ok('name 是 OpenID Connect 的姓名声明',
    claimText('name', 2).includes('姓名'), claimText('name', 2));
  ok('带重音的拉丁字母原样保留', claimText('note', 1) === '"café"', claimText('note', 1));

  /* 头部里放非法字符 → 整串解析失败，报在头部 */
  await setToken('ab%cd.' + enc(str({ alg: 'none' })) + '.' + SIG32);
  ok('头部含非法字符时报「头部解不开」',
    statusEl.textContent === '头部解不开' && statusEl.className.includes('is-error'),
    statusEl.textContent + ' / ' + statusEl.className);
  ok('头部解不开时说明里点出非法字符本身',
    $('#jwt-code .code-empty').textContent.includes('「%」'),
    $('#jwt-code .code-empty').textContent);
  ok('解析失败时声明区也是空态', $('#jwt-claims .table-empty') !== null);

  /* 签名段里的问题只警告，不阻断解码 */
  await setToken(token({ alg: 'HS256' }, { sub: 'u' }, 'ab%cd'));
  ok('签名段非法时只警告',
    noticeText().includes('签名段解不开'), noticeText().slice(0, 90));
  ok('签名段非法时签名格显示「解不开」', statVal('签名') === '解不开', statVal('签名'));
  ok('签名段非法时载荷照常解出', claimText('sub', 1) === '"u"', claimText('sub', 1));

  /* 非法 UTF-8 字节：替换成 U+FFFD 并给出提示。
     这条同时守着「告警形状写错 → 渲染成看不见的空壳」那个坑。 */
  await setToken(enc(str({ alg: 'HS256' })) + '.' +
    b64url(Buffer.from([0x22, 0xff, 0x22])) + '.' + SIG32);
  ok('非法 UTF-8 字节会给出可见的提示',
    noticeText().includes('不是合法的 UTF-8'), JSON.stringify(noticeText().slice(0, 120)));

  /* 末尾带 = 填充（不合规但常见） */
  await setToken(token({ alg: 'HS256' }, { sub: 'u' }, b64std('signature') + '='));
  ok('末尾带 = 填充会警告', noticeText().includes('末尾带了 = 填充'), noticeText().slice(0, 90));
  ok('去掉填充后签名仍解出 9 字节', statVal('签名') === '9 字节', statVal('签名'));

  /* 标准 base64 的 + / 字符（不合规但常见）。长度按 4 的倍数给，
     否则会被「长度不合法」先挡掉，测不到 + / 这条路径。
     a+/b 按 base64url 解释是 a-_b → 3 字节。 */
  await setToken(token({ alg: 'HS256' }, { sub: 'u' }, 'a+/b'));
  ok('标准 base64 的 + / 会警告',
    noticeText().includes('标准 base64'), noticeText().slice(0, 90));
  ok('按 base64url 解释后仍是 3 字节', statVal('签名') === '3 字节', statVal('签名'));

  /* base64url 的 - 与 _ 必须真的能解出字节：atob 只认标准 base64，
     这里换成 atob 之前没把 - _ 还原回去，会让这类段整段解不开。
     '----' 是 0xfb 0xef 0xbe 的标准 base64 '++++' 的 base64url 写法。 */
  await setToken(token({ alg: 'HS256' }, { sub: 'u' }, '----'));
  ok('base64url 的 - 能还原成 3 字节', statVal('签名') === '3 字节', statVal('签名'));
  await click('#jwt-parts [data-part="signature"]');
  ok('解出来的十六进制是 FB EF BE', sigVal('十六进制') === 'FB EF BE', sigVal('十六进制'));
  await click('[data-tab="payload"]');

  /* 载荷段自己带 - / _ 时也要解得开（真实 Token 里非常常见）。
     {"sub":"u","x":"ÿ"} 的 base64url 是 eyJzdWIiOiJ1IiwieCI6IsO_In0 —— 里面真的带一个 _。 */
  const trickyPayload = { sub: 'u', x: '\u00ff' };
  ok('候选载荷的 base64url 里真的带 _（用例前提）',
    enc(str(trickyPayload)).indexOf('_') >= 0, enc(str(trickyPayload)));
  await setToken(token({ alg: 'HS256' }, trickyPayload));
  ok('载荷的 base64url 里带 _ 时照样解出',
    claimText('sub', 1) === '"u"' && claimText('x', 1) === '"\u00ff"', claimText('x', 1));

  /* 长度除以 4 余 1：任何 base64 都不可能 */
  await setToken(token({ alg: 'HS256' }, { sub: 'u' }, 'abcde'));
  ok('长度余 1 时给出「长度不合法」',
    noticeText().includes('长度不合法'), noticeText().slice(0, 120));

  /* ---------- 4. 段数与三种形态 ---------- */
  section('4. 段数与 JWS / 未签名 / JWE');

  await setToken('abcdef');
  ok('一段时报「这不是一个 JWT」', statusEl.textContent === '这不是一个 JWT', statusEl.textContent);
  ok('一段时的说明提到点号', $('#jwt-code .code-empty').textContent.includes('点号'),
    $('#jwt-code .code-empty').textContent);

  await setToken(enc(str({ alg: 'HS256' })) + '.' + enc(str({ sub: 'u' })));
  ok('两段时给 info 提示（不是错误）',
    noticeText().includes('只有 2 段') && warnNotices().length === 0, noticeText().slice(0, 90));
  ok('两段时状态行点明缺签名段',
    statusEl.textContent.includes('2 段'), statusEl.textContent);
  ok('两段时签名格显示「无」',
    [...d.querySelectorAll('#jwt-parts .jwt-part')].map((p) => p.textContent).join('').includes('签名无'));
  /* 2 段的令牌第三段根本不存在，不能跟「第三段为空」（真·未签名）说成一样 */
  ok('两段时签名统计为「缺少第三段」', statVal('签名') === '缺少第三段', statVal('签名'));

  await click('#jwt-parts [data-part="signature"]');
  ok('两段时签名栏说明第三段整个缺失',
    sigVal('段原文') === '（没有第三段）' && sigVal('字节数') === '0' &&
    d.getElementById('jwt-tab-foot').textContent === '签名 · 缺少第三段',
    sigVal('段原文') + ' / ' + d.getElementById('jwt-tab-foot').textContent);
  await click('[data-tab="payload"]');

  await setToken(enc(str({ alg: 'none', typ: 'JWT' })) + '.' + enc(str({ sub: 'u' })) + '.');
  ok('alg=none 会给出危险提示',
    noticeText().includes('未签名的令牌'), noticeText().slice(0, 90));
  ok('alg=none 的提示是警告级（notice--warn）',
    warnNotices().some((n) => n.textContent.includes('未签名的令牌')));
  ok('未签名令牌的状态行点明第三段为空',
    statusEl.textContent.includes('第三段为空（未签名）'), statusEl.textContent);
  ok('未签名令牌的签名格显示「空」',
    [...d.querySelectorAll('#jwt-parts .jwt-part')].map((p) => p.textContent).join('').includes('签名空'));

  await setToken(token({ alg: 'HS256' }, { sub: 'u' }, SIG32) + '.' + SIG32);
  ok('四段时报段数不对',
    statusEl.textContent === '段数不对（4 段）', statusEl.textContent);

  /* 五段但不是 JWE：头部里没有 enc */
  await setToken(enc(str({ alg: 'HS256' })) + '.AAAA.AAAA.AAAA.AAAA');
  ok('五段且头部没有 enc 时按「粘了多个 Token」处理',
    statusEl.textContent === '段数不对（5 段）' &&
    $('#jwt-code .code-empty').textContent.includes('只粘一个'),
    statusEl.textContent + ' / ' + $('#jwt-code .code-empty').textContent);

  /* 真正的 JWE：受保护头部里有 alg 与 enc */
  const jweHeader = { alg: 'RSA-OAEP', enc: 'A256GCM', typ: 'JWE' };
  const jwe = enc(str(jweHeader)) + '.AAAA.AAAA.AAAAAAAA.AAAA';
  await setToken(jwe);
  ok('JWE 不报错，状态行标出 5 段',
    statusEl.textContent.includes('5 段（JWE）'), statusEl.textContent);
  ok('JWE 时效显示「需解密」', statVal('时效') === '需解密', statVal('时效'));
  ok('JWE 显示内容加密算法', statVal('内容加密') === 'A256GCM', statVal('内容加密'));
  ok('JWE 显示密钥算法', statVal('密钥算法') === 'RSA-OAEP', statVal('密钥算法'));
  ok('JWE 渲染 5 个格子',
    [...d.querySelectorAll('#jwt-parts .jwt-part')].map((p) => p.textContent.trim()).join(' / ') ===
      '头部' + Buffer.byteLength(str(jweHeader), 'utf8') + ' 字节 / ' +
      '加密密钥3 字节 / 初始向量3 字节 / 密文6 字节 / 认证标签3 字节',
    [...d.querySelectorAll('#jwt-parts .jwt-part')].map((p) => p.textContent.trim()).join(' / '));
  ok('JWE 的载荷格子不可点（没有按钮）',
    count(d, '#jwt-parts button.jwt-part') === 1 && count(d, '#jwt-parts .jwt-part--static') === 4);
  ok('JWE 只剩头部 Tab 可见',
    $('[data-tab="payload"]').hidden === true && $('[data-tab="signature"]').hidden === true &&
    $('[data-tab="header"]').hidden === false &&
    $('[data-tab="header"]').getAttribute('aria-pressed') === 'true');
  ok('JWE 头部按 JSON 展示',
    out().includes('"enc": "A256GCM"'), out().slice(0, 80));
  ok('JWE 的声明区说明载荷是密文',
    $('#jwt-claims .table-empty').textContent.includes('密文'),
    $('#jwt-claims .table-empty').textContent);

  /* JWE 把 Tab 强推到「头部」；换成普通 Token 之后必须回到「载荷」，
     不能停在用户从没点过的那一栏 */
  await setToken(token({ alg: 'HS256' }, { sub: 'u' }));
  const tabsNow = [...d.querySelectorAll('#jwt-tabs [data-tab]')]
    .map((b) => b.getAttribute('data-tab') + ':' + b.getAttribute('aria-pressed')).join(' ');
  ok('JWE 之后换成普通 Token，Tab 回到载荷',
    $('[data-tab="payload"]').getAttribute('aria-pressed') === 'true' &&
    $('[data-tab="signature"]').hidden === false, tabsNow);

  /* ---------- 5. 时效判定 ---------- */
  section('5. 时效判定（全部相对本机时钟）');

  await setToken(token({ alg: 'HS256' }, { exp: now - 7200 }));
  ok('过去的 exp 判为已过期', statVal('时效') === '已过期', statVal('时效'));
  ok('超期时长按 2 小时算', statVal('剩余 / 超期') === '已过期 2 小时', statVal('剩余 / 超期'));
  ok('exp 行标成过期色', claimRow('exp').querySelector('.jwt-time--bad') !== null);
  ok('过期时给 danger 色', 
    [...d.querySelectorAll('#jwt-stats .stat-value')].some((v) => v.className.includes('stat-value--danger')));

  await setToken(token({ alg: 'HS256' }, { nbf: now + 7260, exp: now + 100000 }));
  ok('未来的 nbf 判为尚未生效', statVal('时效') === '尚未生效', statVal('时效'));
  ok('未生效时给出还要多久', statVal('剩余 / 超期') === '还有 2 小时 1 分', statVal('剩余 / 超期'));
  ok('nbf 行标成 warn 色', claimRow('nbf').querySelector('.jwt-time--warn') !== null);

  await setToken(token({ alg: 'HS256' }, { iss: 'x' }));
  ok('没有 exp / nbf 时显示无时效声明', statVal('时效') === '无时效声明', statVal('时效'));
  ok('无时效声明时剩余为「—」', statVal('剩余 / 超期') === '—', statVal('剩余 / 超期'));

  /* 边界：nbf 正好是这一秒（向下取整 → 现在 ≥ nbf → 已经生效） */
  await setToken(token({ alg: 'HS256' }, { nbf: now, exp: now + 3600 }));
  ok('nbf 恰好等于当前秒时算已生效', statVal('时效') === '有效期内', statVal('时效'));

  /* 边界：exp 正好是这一秒（向下取整 → 现在 ≥ exp → 已过期） */
  await setToken(token({ alg: 'HS256' }, { exp: now }));
  ok('exp 恰好等于当前秒时算已过期', statVal('时效') === '已过期', statVal('时效'));

  /* exp 写成字符串：能用，但类型不合规 */
  await setToken(token({ alg: 'HS256' }, { exp: String(now + 3600) }));
  ok('字符串形式的 exp 仍能换算', statVal('时效') === '有效期内', statVal('时效'));
  ok('字符串形式的 exp 会被警告',
    noticeText().includes('时间声明 exp 的值不规范') && noticeText().includes('字符串'),
    noticeText().slice(0, 120));

  /* exp 写成毫秒（13 位） */
  await setToken(token({ alg: 'HS256' }, { exp: (now + 3600) * 1000 }));
  ok('毫秒量级的 exp 会被警告',
    noticeText().includes('毫秒时间戳'), noticeText().slice(0, 160));
  ok('毫秒值仍按规范当秒解释（因此显示成公元五万年）',
    /^5\d{4}-/.test(claimText('exp', 2).replace(/^[^0-9]*/, '')), claimText('exp', 2).slice(0, 80));

  /* exp 不晚于 nbf */
  await setToken(token({ alg: 'HS256' }, { exp: now - 100, nbf: now + 100 }));
  ok('exp 早于 nbf 时给出矛盾警告',
    noticeText().includes('exp 不晚于 nbf'), noticeText().slice(0, 160));

  /* iat 在未来 */
  await setToken(token({ alg: 'HS256' }, { iat: now + 7200, exp: now + 100000 }));
  ok('iat 在未来时给出警告',
    noticeText().includes('签发时间在本机时间之后'), noticeText().slice(0, 160));

  /* ---------- 6. 头部的安全提示 ---------- */
  section('6. 头部的安全提示');

  await setToken(token({ typ: 'JWT' }, { sub: 'u' }));
  ok('缺 alg 时给出警告', noticeText().includes('头部没有 alg'), noticeText().slice(0, 90));

  await setToken(token({ alg: 256, typ: 'JWT' }, { sub: 'u' }));
  ok('alg 不是字符串时给出警告',
    noticeText().includes('alg 不是字符串') && noticeText().includes('数字'),
    noticeText().slice(0, 90));

  await setToken(token({ alg: 'HS256', crit: ['exp'] }, { sub: 'u' }));
  ok('crit 存在时给出警告',
    noticeText().includes('crit') && noticeText().includes('拒绝这个令牌'),
    noticeText().slice(0, 140));

  await setToken(token({ alg: 'RS256', kid: 'k', jku: 'https://keys.example.com/jwks.json' }, { sub: 'u' }));
  ok('jku 存在时给出警告',
    noticeText().includes('密钥地址由令牌自己指定（jku）'), noticeText().slice(0, 140));
  ok('jku 的提示是警告级', warnNotices().some((n) => n.textContent.includes('jku')));

  await setToken(token({ alg: 'RS256', jwk: { kty: 'RSA', n: 'x' } }, { sub: 'u' }));
  ok('jwk 内嵌公钥给的是 info 提示（不是警告）',
    warnNotices().length === 0 && noticeText().includes('公钥内嵌在头部（jwk）'),
    warnNotices().length + ' / ' + noticeText().slice(0, 120));

  await setToken(token({ alg: 'HS256', enc: 'A256GCM' }, { sub: 'u' }));
  ok('三段令牌里出现 enc 会被指出',
    noticeText().includes('JWE 的参数'), noticeText().slice(0, 140));

  /* 头部不是 JSON 对象 */
  await setToken(enc('[1,2,3]') + '.' + enc(str({ sub: 'u' })) + '.' + SIG32);
  ok('头部是数组时给出警告',
    noticeText().includes('头部不是 JSON 对象'), noticeText().slice(0, 140));

  /* 载荷不是 JSON */
  await setToken(enc(str({ alg: 'HS256' })) + '.' + enc('not-json') + '.' + SIG32);
  ok('载荷不是 JSON 时给出警告并保留原文',
    noticeText().includes('载荷不是合法的 JSON') && out() === 'not-json',
    noticeText().slice(0, 140) + ' / ' + JSON.stringify(out()));
  /* 标题已经说了「不是合法的 JSON」，正文里不该再说一遍 */
  ok('载荷不是 JSON 的提示里结论只出现一次',
    noticeText().split('不是合法的 JSON').length - 1 === 1,
    noticeText().slice(0, 140));

  await setToken(enc(str({ alg: 'HS256' })) + '.' + enc('[1,2]') + '.' + SIG32);
  ok('载荷是数组时给出警告',
    noticeText().includes('载荷不是 JSON 对象'), noticeText().slice(0, 140));

  /* ---------- 7. Tab、签名栏与复制 ---------- */
  section('7. Tab、签名栏与复制');

  const header2 = { alg: 'HS256', typ: 'JWT', kid: 'k-9' };
  const payload2 = { sub: 'u-9', exp: now + 3600 };
  await setToken(token(header2, payload2));

  await click('[data-tab="header"]');
  ok('切到头部后 aria-pressed 跟着换',
    $('[data-tab="header"]').getAttribute('aria-pressed') === 'true' &&
    $('[data-tab="payload"]').getAttribute('aria-pressed') === 'false');
  ok('头部展示的是头部 JSON', out().includes('"kid": "k-9"'), out().slice(0, 80));
  ok('头部底注把认识的参数写成人话',
    d.getElementById('jwt-tab-foot').textContent ===
      '头部 · ' + Buffer.byteLength(str(header2), 'utf8') + ' 字节 · ' +
      'alg = HS256（签名算法） · typ = JWT（令牌类型） · kid = k-9（密钥编号）',
    d.getElementById('jwt-tab-foot').textContent);

  copied = null;
  await click('#jwt-copy');
  ok('复制按钮在头部 Tab 复制的是头部 JSON',
    copied === JSON.stringify(header2, null, 2), JSON.stringify(copied));

  /* 点三段格子里的「签名」→ 切到签名视图 */
  await click('#jwt-parts [data-part="signature"]');
  ok('点签名格子切到签名栏',
    d.getElementById('jwt-sig').hidden === false && d.getElementById('jwt-code').hidden === true);
  ok('签名格子高亮、Tab 同步', $('[data-tab="signature"]').getAttribute('aria-pressed') === 'true');
  ok('签名栏三行的标签正确',
    sigRows().map((r) => r.querySelector('.value-label').textContent).join(',') === '段原文,字节数,十六进制',
    sigRows().map((r) => r.querySelector('.value-label').textContent).join(','));
  ok('段原文与 Token 第三段一致', sigVal('段原文') === SIG32, sigVal('段原文'));
  ok('字节数是 32', sigVal('字节数') === '32', sigVal('字节数'));
  ok('十六进制是 32 个 00',
    sigVal('十六进制') === new Array(32).fill('00').join(' '), sigVal('十六进制'));
  ok('签名底注说明本站不校验签名',
    $('#jwt-sig .jwt-sig-note').textContent.includes('不校验签名'),
    $('#jwt-sig .jwt-sig-note').textContent);
  ok('签名底栏标出未校验',
    d.getElementById('jwt-tab-foot').textContent === '签名 · 32 字节 · 未校验',
    d.getElementById('jwt-tab-foot').textContent);

  copied = null;
  await click('#jwt-copy');
  ok('签名栏里复制按钮复制的是签名段', copied === SIG32, JSON.stringify(copied));

  /* 签名栏里的三行各自可点复制（走通用机制） */
  const before = copiedCount;
  copied = null;
  await click('#jwt-sig [data-copy-target="#jwt-sig-hex"]');
  await sleep(20);
  ok('点十六进制那一行复制的是十六进制',
    copied === new Array(32).fill('00').join(' '), JSON.stringify(copied));
  ok('复制走的是通用机制（有复制回调）', copiedCount > before, String(copiedCount));

  await click('[data-tab="payload"]');
  ok('切回载荷后签名栏又藏起来',
    d.getElementById('jwt-sig').hidden === true && d.getElementById('jwt-code').hidden === false);
  copied = null;
  await click('#jwt-copy');
  ok('载荷 Tab 复制的是格式化后的 JSON',
    copied === JSON.stringify(payload2, null, 2), JSON.stringify(copied));

  /* ---------- 8. 各种粘贴形态 ---------- */
  section('8. 各种粘贴形态');

  await setToken('Bearer ' + tok);
  ok('带 Bearer 前缀能解析', statusEl.textContent === '3 段 · 共 ' + tok.length + ' 个字符',
    statusEl.textContent);

  await setToken('Authorization: Bearer ' + tok);
  ok('整行 Authorization 头能解析',
    statusEl.textContent === '3 段 · 共 ' + tok.length + ' 个字符', statusEl.textContent);

  await setToken('"' + tok + '"');
  ok('被引号包起来能解析',
    statusEl.textContent === '3 段 · 共 ' + tok.length + ' 个字符', statusEl.textContent);

  await setToken(tok.slice(0, 30) + '\n   ' + tok.slice(30));
  ok('折行的 Token 能解析',
    statusEl.textContent === '3 段 · 共 ' + tok.length + ' 个字符', statusEl.textContent);

  /* 两个三段 Token 直接相连：两段之间没有分隔符，所以是 5 段
     （正好跟 JWE 的段数撞上，靠「头部里没有 enc」这条判据区分） */
  await setToken(tok + '\n' + tok);
  ok('粘了两个 Token 时报段数不对并提示一次只粘一个',
    statusEl.textContent === '段数不对（5 段）' &&
    $('#jwt-code .code-empty').textContent.includes('一次只粘一个'),
    statusEl.textContent + ' / ' + $('#jwt-code .code-empty').textContent);

  /* ---------- 9. 演示 Token 与清空 ---------- */
  section('9. 演示 Token 与清空');

  await click('[data-demo]');
  await sleep(40);
  ok('填入示例后没有错误', statusEl.className.indexOf('is-error') < 0, statusEl.className);
  ok('示例 Token 是 3 段', statusEl.textContent.includes('3 段'), statusEl.textContent);
  ok('示例 Token 在有效期内', statVal('时效') === '有效期内', statVal('时效'));
  ok('示例 Token 的剩余时间按两小时算',
    statVal('剩余 / 超期') === '还剩 2 小时', statVal('剩余 / 超期'));
  ok('示例 Token 的签名是 32 字节（合成值）', statVal('签名') === '32 字节', statVal('签名'));
  ok('示例 Token 没有安全警告', warnsEl.hidden === true, noticeText().slice(0, 90));
  ok('示例载荷里有 aud 数组',
    claimText('aud', 1) === '["api.example.com","web.example.com"]', claimText('aud', 1));
  ok('示例载荷里的 scope 被标成作用域',
    claimText('scope', 2).includes('作用域'), claimText('scope', 2));
  ok('示例按钮说明了签名是合成的',
    $('[data-demo]').getAttribute('title').includes('合成'),
    $('[data-demo]').getAttribute('title'));

  await click('[data-clear]');
  await sleep(40);
  ok('清空后回到空状态',
    input.value === '' && statusEl.textContent === '' &&
    count(d, '#jwt-parts .jwt-part') === 0 && $('#jwt-code .code-empty') !== null);

  /* ---------- 10. 与 registry / 页面的一致性 ---------- */
  section('10. 页面与 registry 的一致性');

  ok('页面声明了 data-tool 与 data-hub',
    d.body.getAttribute('data-tool') === 'jwt-decoder' &&
    d.body.getAttribute('data-hub') === 'security');
  ok('面包屑指向安全分类',
    $('.breadcrumb a[href="../../hubs/security/"]') !== null);
  ok('头部徽章标明不校验签名',
    [...d.querySelectorAll('.tool-head-meta .badge')]
      .some((b) => b.textContent.includes('不校验签名')));
  ok('常驻提示条说明「只解码，不校验签名」',
    $('.tool-stack > .notice--warn') !== null &&
    $('.tool-stack > .notice--warn').textContent.includes('只解码，不校验签名'));
  ok('相关工具区块已渲染同分类工具',
    count(d, '#related-grid .tool-card') > 0, String(count(d, '#related-grid .tool-card')));
}
