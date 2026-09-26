/* ==========================================================================
   摘要 / HMAC / Base32 共用模块（js/hash-utils.js）
   --------------------------------------------------------------------------
   这个模块里有一段**自己写的密码学**，所以验证方式是这个套件的重点：
   把 SHA-1 / SHA-256 / SHA-512 / HMAC 逐个与 **Node 的 crypto（OpenSSL）**
   交叉比对，而不是拿自己算出来的值当期望值。

   覆盖：
     · 分组边界 0/1/55/56/63/64/65/111…129/255/256/1000 字节
     · 已知向量（'abc'、空串、一次分组填满分界的输入）
     · 多字节 UTF-8 与代理对（emoji）
     · HMAC 三种算法 × 密钥短于 / 等于 / 长于分组（长于分组要先摘要一次）
     · 平台实现可用时与纯 JS 实现结果一致
     · Base32 的 RFC 4648 向量，以及**严格校验**（非法字符 / 非法长度 /
       残留位非零 / 填充位置与个数）—— 上游宽松实现会把抄错的密钥
       解成一个看起来正常的密钥
     · 缺少 BigInt 时 SHA-512 明确不可用，而不是算错
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ok, section, ROOT, loadRegistry } from './_harness.mjs';

const SRC = () => fs.readFileSync(path.join(ROOT, 'js/hash-utils.js'), 'utf8');

/** 把模块装进一个（可以定制的）假 window 里 */
function loadHash(win) {
  const w = win || {};
  new Function('window', SRC())(w);
  if (!w.TOOLBOX || !w.TOOLBOX.hash) throw new Error('hash-utils.js 没有导出 TOOLBOX.hash');
  return w.TOOLBOX.hash;
}

const nodeHex = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');
const nodeHmacHex = (algo, key, msg) =>
  crypto.createHmac(algo, key).update(msg).digest('hex');
const eqBytes = (a, b) =>
  a && b && a.length === b.length && Buffer.from(a).equals(Buffer.from(b));

export default async function run() {
  const H = loadHash();

  ok('模块导出 TOOLBOX.hash', !!H);

  /* ---------- 1. 与 Node 的 crypto 交叉校验 ---------- */
  section('1. 与 Node crypto 交叉校验（这是这个套件的核心）');

  const CORPUS = [];
  const push = (buf, label) => CORPUS.push({ buf, label });

  /* 分组边界：SHA-1/256 的分组是 64 字节，SHA-512 是 128 字节。
     填充算法在「差 1 字节就要多吃一个分组」的地方最容易写错，
     所以 55/56/63/64/65 与 111~129 这两段必须逐个覆盖。 */
  for (const n of [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 31, 32, 33, 55, 56, 57,
    63, 64, 65, 111, 112, 113, 119, 120, 121, 127, 128, 129, 255, 256, 1000]) {
    const b = Buffer.alloc(n);
    for (let i = 0; i < n; i++) b[i] = (i * 167 + 13) & 0xff;
    push(b, n + ' 字节');
  }
  push(Buffer.from(''), '空');
  push(Buffer.from('abc'), 'abc');
  push(Buffer.from('The quick brown fox jumps over the lazy dog'), 'fox');
  push(Buffer.from('中文测试'), '中文');
  push(Buffer.from('emoji 🎉 与代理对 𝄞'), '代理对');
  push(Buffer.alloc(64, 0xff), '64 个 0xff');
  push(Buffer.alloc(128, 0x00), '128 个 0x00');
  push(Buffer.from([0x80]), '单个 0x80（与填充字节同形）');
  push(Buffer.alloc(63, 0x00), '63 个 0x00');

  const shas = [
    ['sha1', 'sha1'],
    ['sha256', 'sha256'],
    ['sha512', 'sha512']
  ];
  for (const [fn, algo] of shas) {
    const bad = [];
    for (const c of CORPUS) {
      const got = H[fn](c.buf);
      if (!got || Buffer.from(got).toString('hex') !== nodeHex(algo, c.buf)) {
        bad.push(c.label + '（' + (got ? Buffer.from(got).toString('hex') : 'null') +
          ' vs ' + nodeHex(algo, c.buf) + '）');
      }
    }
    ok(fn + '：' + CORPUS.length + ' 组输入全部与 Node 一致', bad.length === 0,
      bad.slice(0, 3).join(' / '));
  }

  /* 已知向量单独列出来：它们是最容易被人肉复核的锚点 */
  section('2. 公开的已知向量');
  ok('SHA-1("abc")', H.hex(H.sha1(Buffer.from('abc'))) ===
    'a9993e364706816aba3e25717850c26c9cd0d89d', H.hex(H.sha1(Buffer.from('abc'))));
  ok('SHA-1("")', H.hex(H.sha1(Buffer.from(''))) ===
    'da39a3ee5e6b4b0d3255bfef95601890afd80709', H.hex(H.sha1(Buffer.from(''))));
  ok('SHA-256("abc")', H.hex(H.sha256(Buffer.from('abc'))) ===
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    H.hex(H.sha256(Buffer.from('abc'))));
  ok('SHA-512("abc")', H.hex(H.sha512(Buffer.from('abc'))) ===
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
    '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    H.hex(H.sha512(Buffer.from('abc'))));
  ok('摘要长度分别是 20 / 32 / 64 字节',
    H.sha1(Buffer.from('x')).length === 20 &&
    H.sha256(Buffer.from('x')).length === 32 &&
    H.sha512(Buffer.from('x')).length === 64);
  ok('ALGOS 的 block 与摘要长度声明与实际一致',
    H.ALGOS.SHA1.block === 64 && H.ALGOS.SHA1.bytes === H.sha1(Buffer.from('')).length &&
    H.ALGOS.SHA256.block === 64 && H.ALGOS.SHA256.bytes === H.sha256(Buffer.from('')).length &&
    H.ALGOS.SHA512.block === 128 && H.ALGOS.SHA512.bytes === H.sha512(Buffer.from('')).length);

  /* ---------- 3. HMAC ---------- */
  section('3. HMAC 与 Node 交叉校验');
  const KEY_LENS = [0, 1, 20, 63, 64, 65, 100, 128, 129, 200];
  for (const [fn, algo] of shas) {
    const name = H.ALGOS[fn === 'sha1' ? 'SHA1' : fn === 'sha256' ? 'SHA256' : 'SHA512'].name;
    const bad = [];
    for (const n of KEY_LENS) {
      const key = Buffer.alloc(n);
      for (let i = 0; i < n; i++) key[i] = (i * 91 + 7) & 0xff;
      for (const c of CORPUS.slice(0, 12)) {
        const got = H.hmac(name, key, c.buf);
        const want = nodeHmacHex(algo, key, c.buf);
        if (!got || Buffer.from(got).toString('hex') !== want) {
          bad.push(n + ' 字节密钥 / ' + c.label);
        }
      }
    }
    ok(name + '：10 种密钥长度 × 12 组消息全部与 Node 一致', bad.length === 0,
      bad.slice(0, 3).join(' / '));
  }

  /* 长于分组的密钥必须先摘要一次 —— 这条单独钉住，因为漏掉它时
     短密钥的用例全都还是绿的 */
  section('4. HMAC 的长密钥分支');
  const longKey = Buffer.alloc(200, 0xab);
  ok('200 字节密钥（> 64）SHA-256 正确',
    H.hex(H.hmac('SHA-256', longKey, Buffer.from('msg'))) ===
    nodeHmacHex('sha256', longKey, Buffer.from('msg')));
  ok('200 字节密钥（> 128）SHA-512 正确',
    H.hex(H.hmac('SHA-512', longKey, Buffer.from('msg'))) ===
    nodeHmacHex('sha512', longKey, Buffer.from('msg')));
  ok('对照：把长密钥生硬截断成 128 字节会算错（证明这一步不是白写的）',
    H.hex(H.hmac('SHA-512', longKey, Buffer.from('msg'))) !==
    nodeHmacHex('sha512', longKey.subarray(0, 128), Buffer.from('msg')));
  ok('刚好等于分组长度的密钥不做摘要',
    H.hex(H.hmac('SHA-256', Buffer.alloc(64, 1), Buffer.from('m'))) ===
    nodeHmacHex('sha256', Buffer.alloc(64, 1), Buffer.from('m')));
  ok('空密钥也能算（HMAC 规格允许）',
    H.hex(H.hmac('SHA-256', new Uint8Array(0), Buffer.from('m'))) ===
    nodeHmacHex('sha256', Buffer.alloc(0), Buffer.from('m')));

  /* ---------- 5. 平台实现与纯 JS 一致 ---------- */
  section('5. 平台实现（crypto.subtle）与纯 JS 结果一致');
  ok('假 window 里没有 crypto.subtle 时走纯 JS 路径',
    H.hasSubtle() === false && H.impl() === 'pure', H.impl());

  const native = loadHash({ crypto: { subtle: globalThis.crypto.subtle } });
  ok('注入 crypto.subtle 后认出来是平台实现',
    native.hasSubtle() === true && native.impl() === 'native', native.impl());

  const sample = Buffer.from('中文 abc 🎉');
  const nSha = await native.digestAsync('SHA-256', sample);
  ok('digestAsync 与纯 JS 一致', eqBytes(nSha, H.sha256(sample)),
    nSha && Buffer.from(nSha).toString('hex'));
  const nHmac = await native.hmacAsync('SHA-1', Buffer.from('k'), sample);
  ok('hmacAsync 与纯 JS 一致', eqBytes(nHmac, H.hmac('SHA-1', Buffer.from('k'), sample)));
  const nLong = await native.hmacAsync('SHA-512', longKey, sample);
  ok('hmacAsync 的长密钥与纯 JS 一致', eqBytes(nLong, H.hmac('SHA-512', longKey, sample)));
  ok('没有平台实现时 digestAsync 返回 null（而不是抛错或返回错值）',
    H.digestAsync('SHA-256', sample) === null);
  ok('没有平台实现时 hmacAsync 返回 null', H.hmacAsync('SHA-1', new Uint8Array(1), sample) === null);

  /* ---------- 6. Base32 ---------- */
  section('6. Base32：RFC 4648 向量');
  /* '' 这一条（RFC 4648 里 BASE32("") = ""）在这里是特例：这个解码器是给
     「密钥」用的，空串按无效处理，见第 8 节。其余六条是完整向量。 */
  const VEC = [['f', 'MY======'], ['fo', 'MZXQ===='], ['foo', 'MZXW6==='],
    ['foob', 'MZXW6YQ='], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI======']];
  ok('空串按「密钥为空」拒绝（RFC 向量 BASE32("")="" 的另一面）',
    H.base32Decode('').error !== null && H.base32Decode('').error.code === 'empty');
  ok('base32Encode(空) 得到空串', H.base32Encode(new Uint8Array(0)) === '',
    JSON.stringify(H.base32Encode(new Uint8Array(0))));
  for (const [plain, want] of VEC) {
    ok('编码 ' + JSON.stringify(plain) + ' → ' + want,
      H.base32Encode(Buffer.from(plain)) === want, H.base32Encode(Buffer.from(plain)));
    const got = H.base32Decode(want);
    ok('解码 ' + want + ' → ' + JSON.stringify(plain),
      got.error === null && Buffer.from(got.bytes).toString('utf8') === plain,
      got.error ? got.error.message : Buffer.from(got.bytes).toString('hex'));
  }

  section('7. Base32：往返与容错');
  const ROUND = [1, 2, 3, 4, 5, 8, 10, 16, 20, 32, 33, 64, 100];
  const badRound = [];
  for (const n of ROUND) {
    const raw = Buffer.alloc(n);
    for (let i = 0; i < n; i++) raw[i] = (i * 53 + 29) & 0xff;
    const enc = H.base32Encode(raw);
    if (enc.length % 8 !== 0) { badRound.push(n + ' 字节：编码长度不是 8 的倍数'); continue; }
    const dec = H.base32Decode(enc);
    if (dec.error || !Buffer.from(dec.bytes).equals(raw)) badRound.push(n + ' 字节');
  }
  ok(ROUND.length + ' 种长度 encode → decode 往返一致', badRound.length === 0,
    badRound.slice(0, 3).join(' / '));

  ok('大写小写都接受', H.base32Decode('mzxw6ytb').error === null);
  ok('中间空格被忽略（用户常从文档里粘）',
    Buffer.from(H.base32Decode('MZXW 6YTB').bytes).toString('utf8') === 'fooba');
  ok('换行 / 制表符也被忽略',
    H.base32Decode('MZXW6YT\nBOI======').error === null);
  ok('去掉填充也能解', Buffer.from(H.base32Decode('MZXW6YTB').bytes).toString('utf8') === 'fooba');
  ok('标准填充个数被接受', H.base32Decode('MZXW6YQ=').error === null);

  section('8. Base32：严格校验（上游在这里是宽松的）');
  const REJECT = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['A', 'length'],
    ['ABC', 'length'],
    ['AB', 'dangling'],
    ['AC', 'dangling'],
    ['MZXW', 'dangling'],
    ['MZXW6YTB1', 'char'],
    ['MZXW6YTB!', 'char'],
    ['MZXW6YTB0', 'char'],
    ['MZXW6YTB8', 'char'],
    ['MZXW6YTB9', 'char'],
    ['ABC=DEFG', 'padding'],
    ['MZXW6==', 'padding'],
    ['MZXW6YQ==', 'padding']
  ];
  for (const [input, code] of REJECT) {
    const got = H.base32Decode(input);
    ok('拒绝 ' + JSON.stringify(input) + '（' + code + '）',
      got.error !== null && got.error.code === code,
      got.error ? got.error.code : '却解出了 ' + Buffer.from(got.bytes).toString('hex'));
  }

  /* 上游的对照行为：这个长度（9）会静默丢掉最后一个字符 */
  section('9. 与上游宽松实现的对照');
  const loose = (b32) => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const clean = b32.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
    if (!clean) return null;
    let bits = 0, value = 0; const out = [];
    for (let i = 0; i < clean.length; i++) {
      const idx = alphabet.indexOf(clean[i]);
      if (idx === -1) return null;
      value = (value << 5) | idx; bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
    }
    return new Uint8Array(out);
  };
  ok('上游把 "MZXW6YTBO"（9 字符）静默解成 5 字节',
    loose('MZXW6YTBO') !== null && loose('MZXW6YTBO').length === 5,
    loose('MZXW6YTBO') && String(loose('MZXW6YTBO').length));
  ok('本实现同样拒绝 "MZXW6YTBO"（9 % 8 = 1，凑不出完整字节）',
    H.base32Decode('MZXW6YTBO').error !== null, H.base32Decode('MZXW6YTBO').error.code);
  ok('上游把残留位非零的 "AB" 解成 1 字节（本实现拒绝）',
    loose('AB') !== null && loose('AB').length === 1 && H.base32Decode('AB').error !== null);
  ok('Google Authenticator 那种 16 字符密钥两边都能解',
    loose('JBSWY3DPEHPK3PXP').length === 10 &&
    Buffer.from(H.base32Decode('JBSWY3DPEHPK3PXP').bytes).equals(loose('JBSWY3DPEHPK3PXP')));

  /* ---------- 10. 字节辅助 ---------- */
  section('10. 字节辅助函数');
  ok('hex 补零', H.hex(new Uint8Array([0, 1, 15, 16, 255])) === '00010f10ff');
  ok('fromHex 往返', H.hex(H.fromHex('00010f10ff')) === '00010f10ff');
  ok('fromHex 接受冒号分隔的指纹写法', H.hex(H.fromHex('00:01:0f')) === '00010f');
  ok('fromHex 拒绝奇数长度', H.fromHex('abc') === null);
  ok('fromHex 拒绝非法字符', H.fromHex('zz') === null);
  ok('toBase64("foobar")', H.toBase64(Buffer.from('foobar')) === 'Zm9vYmFy');
  ok('fromBase64 处理 base64url 的 - 与 _',
    Buffer.from(H.fromBase64('-_8=')).equals(Buffer.from([0xfb, 0xff])),
    Buffer.from(H.fromBase64('-_8=')).toString('hex'));
  ok('fromBase64 非法输入返回 null', H.fromBase64('!!!') === null);
  ok('utf8Bytes 与 Node 一致',
    Buffer.from(H.utf8Bytes('中文🎉')).equals(Buffer.from('中文🎉', 'utf8')));
  ok('concat', Buffer.from(H.concat(new Uint8Array([1, 2]), new Uint8Array([3])))
    .equals(Buffer.from([1, 2, 3])));
  ok('equal 相同为真', H.equal(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])) === true);
  ok('equal 长度不同为假', H.equal(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])) === false);
  ok('equal 只差末位也为假', H.equal(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])) === false);

  /* ---------- 11. 算法名与可用性 ---------- */
  section('11. 算法名与降级分支');
  ok('带连字符的名字能认（otpauth URI 里用这个）',
    H.byName('SHA-1').name === 'SHA-1' && H.byName('SHA-256').name === 'SHA-256');
  ok('不带连字符 / 大小写混写也能认',
    H.byName('sha1').name === 'SHA-1' && H.byName('Sha512').name === 'SHA-512');
  ok('不认识的名字返回 null', H.byName('MD5') === null && H.byName('') === null);
  ok('hmac 遇到不认识的算法返回 null',
    H.hmac('MD5', new Uint8Array(1), new Uint8Array(1)) === null);
  ok('纯 JS 路径下三种算法都可用（本机有 BigInt）',
    !H.hasSubtle() && H.canUse('SHA-1') && H.canUse('SHA-256') && H.canUse('SHA-512'));

  /* 把 BigInt 遮掉，验证「没有 BigInt 时 SHA-512 明确不可用」这条分支。
     这在页面上永远走不到（现代浏览器都有 BigInt），只能这样测。 */
  const noBig = {};
  new Function('window', 'BigInt', SRC())(noBig, undefined);
  const NB = noBig.TOOLBOX.hash;
  ok('没有 BigInt 时 hasBigInt 是 false', NB.hasBigInt === false);
  ok('没有 BigInt 时 sha512 返回 null（不返回错值）', NB.sha512(Buffer.from('abc')) === null);
  ok('没有 BigInt 时 hmac("SHA-512") 返回 null',
    NB.hmac('SHA-512', new Uint8Array(1), new Uint8Array(1)) === null);
  ok('没有 BigInt 时 canUse("SHA-512") 是 false', NB.canUse('SHA-512') === false);
  ok('没有 BigInt 时 SHA-1 / SHA-256 仍然可用（没被连累）',
    NB.canUse('SHA-1') && NB.canUse('SHA-256') &&
    NB.hex(NB.sha256(Buffer.from('abc'))) ===
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  ok('没有 BigInt 时 SHA-1 结果依然正确',
    NB.hex(NB.sha1(Buffer.from('abc'))) ===
      'a9993e364706816aba3e25717850c26c9cd0d89d');
  ok('没有 BigInt 时 hmac("SHA-256") 依然正确',
    NB.hex(NB.hmac('SHA-256', Buffer.from('k'), Buffer.from('m'))) ===
      nodeHmacHex('sha256', Buffer.from('k'), Buffer.from('m')));

  /* ---------- 12. 与站点数据一致 ---------- */
  section('12. 与 registry 一致');
  const T = loadRegistry();
  const tool = T.tools.find((t) => t.slug === 'totp-generator');
  ok('registry 里挂了 TOTP 工具且在安全分类',
    tool && tool.hub === 'security', tool && tool.hub);
}
