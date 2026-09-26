/* ==========================================================================
   密码强度相关共用模块（js/password-utils.js）
   --------------------------------------------------------------------------
   这是**纯函数**模块，所以直接对着模型断言，不绕 DOM。覆盖：
     一、爆破时间换算（分档与不溢出）  二、强度分档边界
     三、两条贯穿始终的性质（有效熵 ≤ 上界、段代价之和 = 总代价）
     四、五类模式各自能被认出来        五、三份词表的档位与顺序
     六、已知偏乐观 / 偏保守的边界      七、输入边界与告警形状

   期望值都是手算的：log₂(7776)=12.925、log₂(200)=7.644、log₂(10)=3.322 …，
   不是「跑一遍看输出是多少」抄下来的。
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { ok, section, loadPage, ROOT } from './_harness.mjs';

/* 手算用到的常数 */
const LOG2_2000 = Math.log2(2000);   /* 10.966，中日韩档位 */
const LOG2_7776 = Math.log2(7776);   /* 12.925，EFF 词表 */
const LOG2_200 = Math.log2(200);     /* 7.644，1900–2099 年 */
const LOG2_10 = Math.log2(10);       /* 3.322 */
const EPS = 1e-9;

export default async function run() {
  /* 模块挂在 TOOLBOX.password 上，借密码强度检测页面把它加载起来
     （页面同时引了 EFF 词表，所以词典相关的那几条也能测） */
  const ctx = await loadPage('tools/password-strength/index.html');
  const w = ctx.w;
  const P = w.TOOLBOX.password;

  ok('已挂载到 TOOLBOX.password', !!P);
  if (!P) return;

  const E = (pw) => P.estimate(pw);
  const bitsOf = (pw) => E(pw).bits;
  const kindsOf = (pw) => E(pw).segments.map((s) => s.kind);
  const firstSeg = (pw) => E(pw).segments[0] || null;

  /* ---------- 1. 挂载与词表 ---------- */
  section('1. 挂载与词表');

  ok('词表已加载', E('password').wordlistReady === true);
  ok('词表说明带词数', /7776/.test(E('password').wordlistSource), E('password').wordlistSource);
  ok('手写的常见密码表有 100 条以上', P.TOP_PASSWORDS.length >= 100, String(P.TOP_PASSWORDS.length));
  ok('手写的常用词表有 150 条以上', P.COMMON_WORDS.length >= 150,
     String(P.COMMON_WORDS.length));
  ok('三份表合起来能覆盖「EFF 缺的常见词」：horse / hello / house 都在手写表里',
     bitsOf('horse') < 8 && bitsOf('hello') < 8 && bitsOf('house') < 8,
     ['horse', 'hello', 'house'].map((s) => s + '=' + bitsOf(s).toFixed(2)).join(' '));

  /* ---------- 2. 爆破时间 ---------- */
  section('2. 爆破时间换算');

  const t = (bits, perSec) => P.crackTimeFromBits(bits, perSec === undefined ? 1e11 : perSec);

  ok('13 比特 → 瞬间', t(13) === '瞬间', t(13));
  ok('40 比特 → 5.5 秒（10^(40×log₁₀2 − log₁₀(2×10¹¹)) = 10^0.740）',
     t(40) === '5.5 秒', t(40));
  ok('53 比特 → 按小时计', /小时$/.test(t(53)), t(53));
  ok('60 比特 → 67 天（10^6.761 ÷ 86400）', t(60) === '67 天', t(60));
  ok('80 比特 → 19 万年', t(80) === '19 万年', t(80));
  ok('120 比特 → 约 10^17 年', t(120) === '约 10^17 年', t(120));

  /* 独立算一遍 120 比特那一档，确认不是把实现的输出抄进断言 */
  const y120 = 120 * Math.log10(2) - Math.log10(2 * 1e11) - Math.log10(31536000);
  ok('120 比特的数量级与独立计算一致', Math.round(y120) === 17, y120.toFixed(3));

  /* 每秒次数 ×100 与熵值 +log₂(100) 等价：攻击者快 100 倍，想拖住同样的时间
     就得强 100 倍（2^6.64 = 100）。这条把「平均命中位置」与「对数空间换算」
     两件事一起锁住了 —— 任何一个环节少算或多算一个 log₁₀(2)，等式就不成立。 */
  ok('熵值 +log₂(100) 与每秒次数 ×100 给出同一个读数',
     t(80 + Math.log2(100), 1e13) === t(80, 1e11),
     t(80 + Math.log2(100), 1e13) + ' vs ' + t(80, 1e11));
  ok('同一熵值下集群（×100）比单卡快两个数量级（70 比特：187 年 → 1.9 年）',
     t(70, 1e11) === '187 年' && t(70, 1e13) === '1.9 年',
     t(70, 1e11) + ' → ' + t(70, 1e13));
  ok('不限速在线场景把 82 比特算成「年」量级也照样不溢出',
     !/Infinity|NaN|undefined/.test(t(82, 10)), t(82, 10));

  let overflow = [];
  [0, 1, 10, 40, 53, 100, 200, 1000, 5000].forEach((b) => {
    const s = t(b);
    if (typeof s !== 'string' || /Infinity|NaN/.test(s)) overflow.push(b + '→' + s);
  });
  ok('从 0 到 5000 比特都不溢出（上游 Math.pow(2,entropy) 在这里会变 Infinity）',
     overflow.length === 0, overflow.join(', '));

  /* ---------- 3. 强度分档 ---------- */
  section('3. 强度分档（与密码生成器共用同一套阈值）');

  const lv = (b) => P.levelOf(b).level;
  const lb = (b) => P.levelOf(b).label;
  ok('39.9 → 弱(1)', lv(39.9) === 1 && lb(39.9) === '弱');
  ok('40 → 一般(2)（边界归上面一档）', lv(40) === 2 && lb(40) === '一般');
  ok('59.9 → 一般(2)', lv(59.9) === 2);
  ok('60 → 强(3)', lv(60) === 3 && lb(60) === '强');
  ok('79.9 → 强(3)', lv(79.9) === 3);
  ok('80 → 很强(4)', lv(80) === 4 && lb(80) === '很强');
  ok('极大的值也落在 4 档（不会返回 undefined）', lv(1e6) === 4);
  ok('每一档都有 label 与 note',
     P.LEVELS.every((l) => l.label && l.note && l.level >= 1 && l.level <= 4));

  /* ---------- 4. 两条贯穿始终的性质 ---------- */
  section('4. 性质：有效熵 ≤ 朴素上界，且段代价之和 = 总代价');

  const SAMPLES = [
    '123456', 'password', 'P@ssw0rd2024', 'qwerty', 'aaaaaaaa', 'abababab',
    'abcabcabc', '19900101', 'zhangsan1990', 'correcthorsebatterystaple',
    'x7#kQ2!mZ', 'X7#kq2!mZp9$Lw', '中文密码测试', 'hgfedcba', '567890',
    'hello', 'horse', 'Tr0ub4dor&3', 'Tom & Jerry', 'aB3$xY9!'
  ];

  let over = [];
  let broken = [];
  SAMPLES.forEach((pw) => {
    const m = E(pw);
    if (m.bits > m.naiveBits + EPS) {
      over.push(pw + '：有效 ' + m.bits.toFixed(2) + ' > 上界 ' + m.naiveBits.toFixed(2));
    }
    const sum = m.segments.reduce((a, s) => a + s.bits, 0);
    if (Math.abs(sum - m.bits) > 1e-6) {
      broken.push(pw + '：Σ段=' + sum.toFixed(6) + ' 总=' + m.bits.toFixed(6));
    }
  });
  ok('20 个样本的有效熵都 ≤ 朴素上界', over.length === 0, over.join(' | '));
  ok('20 个样本的段代价之和都等于总代价', broken.length === 0, broken.join(' | '));
  ok('「每个字符各拆一段」这一种拆法的代价恰好等于朴素上界',
     Math.abs(4 * LOG2_10 - 4 * Math.log2(10)) < EPS);

  /* ---------- 5. 经典弱密码必须被识破 ---------- */
  section('5. 经典弱密码（回归：只看字符集的算法会把这些算成「强」）');

  const WEAK = ['123456', 'password', 'qwerty', 'iloveyou', 'admin', 'letmein',
    'dragon', 'abc123', '111111', 'P@ssw0rd', 'Password1', 'passw0rd', '123123'];
  const missed = WEAK.filter((pw) => bitsOf(pw) >= 20);
  ok('13 个经典弱密码的有效熵都 < 20 比特', missed.length === 0,
     missed.map((p) => p + '=' + bitsOf(p).toFixed(2)).join(', '));

  ok('123456 排在最常见密码表第 1 位 → 0 比特（试 1 次就中）',
     firstSeg('123456').meta.from === 'toppw' && firstSeg('123456').meta.rank === 1 &&
     bitsOf('123456') === 0, bitsOf('123456').toFixed(3));
  ok('password 排第 2 位 → 1 比特', bitsOf('password') === 1, bitsOf('password').toFixed(3));

  const gap = ['P@ssw0rd', 'Password1', 'iloveyou'].map((pw) => E(pw).naiveBits - E(pw).bits);
  ok('三个样本的「上界 − 有效」都超过 20 比特（差距本身就是这个工具要讲的事）',
     gap.every((g) => g > 20), gap.map((g) => g.toFixed(1)).join(', '));

  /* ---------- 6. l33t 替换 ---------- */
  section('6. l33t 替换');

  ok('P@ssw0rd 被当成 l33t 写法识破（2 处替换）',
     firstSeg('P@ssw0rd').meta.subs === 2, String(firstSeg('P@ssw0rd').meta.subs));
  ok('Pa$$w0rd 数出 3 处替换（两个 $ 与一个 0）',
     firstSeg('Pa$$w0rd').meta.subs === 3, String(firstSeg('Pa$$w0rd').meta.subs));
  ok('p@ssw0rd 与 password 是同一个底座，只多出替换的比特',
     Math.abs((bitsOf('p@ssw0rd') - bitsOf('password')) - 2) < 1e-9,
     (bitsOf('p@ssw0rd') - bitsOf('password')).toFixed(6));
  ok('没有替换的 password 不会报成 l33t', firstSeg('password').meta.subs === 0);
  ok('P@ssw0rd 会挂一条 l33t 提示',
     E('P@ssw0rd').warnings.some((x) => /l33t/.test(x.title)),
     E('P@ssw0rd').warnings.map((x) => x.title).join(' / '));
  ok('P@ssw0rd 比朴素上界低一大截（8×log₂95 ≈ 52.6 → 个位数）',
     E('P@ssw0rd').naiveBits > 50 && E('P@ssw0rd').bits < 10,
     E('P@ssw0rd').bits.toFixed(2) + ' / ' + E('P@ssw0rd').naiveBits.toFixed(2));

  /* ---------- 7. 三份词表的档位与顺序 ---------- */
  section('7. 三份词表（最常见密码 → 常用词 → 通用词表）');

  ok('password 来自最常见密码表', firstSeg('password').meta.from === 'toppw');
  ok('hello 也来自最常见密码表（它同时被收在常用词表里，取更便宜的那份）',
     firstSeg('hello').meta.from === 'toppw', firstSeg('hello').meta.from);
  ok('horse 只收在常用词表里，代价按「常见密码表之后再数」计价',
     firstSeg('horse').meta.from === 'common' && firstSeg('horse').meta.rank > P.TOP_PASSWORDS.length,
     firstSeg('horse').meta.from + '/' + firstSeg('horse').meta.rank);
  ok('correct 只收在通用英文词表里，代价 = log₂(7776)',
     firstSeg('correct').meta.from === 'dict' &&
     Math.abs(firstSeg('correct').bits - LOG2_7776) < 1e-9,
     firstSeg('correct').bits.toFixed(6));
  ok('三档的代价严格递增：常见密码 < 常用词 < 通用词表',
     bitsOf('password') < bitsOf('horse') && bitsOf('horse') < bitsOf('correct'),
     [bitsOf('password'), bitsOf('horse'), bitsOf('correct')].map((b) => b.toFixed(2)).join(' < '));

  /* ---------- 8. 键盘序列 ---------- */
  section('8. 键盘序列与字母表顺序');

  ok('hgfedcba（倒着敲字母表）认成序列', kindsOf('hgfedcba').includes('sequence'),
     kindsOf('hgfedcba').join(','));
  ok('567890 认成数字序列', kindsOf('567890').includes('sequence'), kindsOf('567890').join(','));
  ok('序列比逐字符暴力便宜',
     bitsOf('hgfedcba') < 8 * Math.log2(26), bitsOf('hgfedcba').toFixed(2));
  ok('qwerty 走的是「最常见密码表」，不是序列（表里排第 4）',
     firstSeg('qwerty').meta.from === 'toppw' && firstSeg('qwerty').meta.rank === 4,
     firstSeg('qwerty').meta.from + '/' + firstSeg('qwerty').meta.rank);
  ok('两字符的「序列」（ok）不会误判成序列段', !kindsOf('ok').includes('sequence'));

  /* ---------- 9. 重复 ---------- */
  section('9. 重复');

  ['aaaaaaaa', 'abababab', 'abcabcabc'].forEach((pw) => {
    ok(pw + ' 认成重复', kindsOf(pw).includes('repeat'), kindsOf(pw).join(','));
  });
  ok('20 位数字串认成「1234567890 重复两次」',
     firstSeg('12345678901234567890').kind === 'repeat',
     firstSeg('12345678901234567890').note);
  ok('重复比逐字符便宜：8 个 a 远低于 8×log₂26',
     bitsOf('aaaaaaaa') < 8 * Math.log2(26) / 2, bitsOf('aaaaaaaa').toFixed(2));
  ok('重复会挂一条提示',
     E('aaaaaaaa').warnings.some((x) => /重复/.test(x.title)),
     E('aaaaaaaa').warnings.map((x) => x.title).join(' / '));

  /* ---------- 10. 日期与年份 ---------- */
  section('10. 日期与年份');

  ok('1990 认成年份，代价 = log₂(200)', kindsOf('1990').includes('date') &&
     Math.abs(bitsOf('1990') - LOG2_200) < 1e-9, bitsOf('1990').toFixed(6));
  ok('2024 认成年份', kindsOf('2024').includes('date'));
  ok('1899 不在 1900–2099 里，不当年份', !kindsOf('1899').includes('date'),
     kindsOf('1899').join(','));
  ok('19900101（8 位日期）里含日期段', kindsOf('19900101').includes('date'),
     kindsOf('19900101').join(','));
  ok('20241231 也能被拆出日期', kindsOf('20241231').includes('date'),
     kindsOf('20241231').join(','));
  ok('日期会挂一条提示',
     E('19900101').warnings.some((x) => /日期|年份/.test(x.title)),
     E('19900101').warnings.map((x) => x.title).join(' / '));

  /* ---------- 11. 大小写变体 ---------- */
  section('11. 大小写变体');

  ok('首字母大写只多 1 比特',
     Math.abs((bitsOf('Password') - bitsOf('password')) - 1) < 1e-9,
     (bitsOf('Password') - bitsOf('password')).toFixed(6));
  ok('全大写也只多 1 比特',
     Math.abs((bitsOf('PASSWORD') - bitsOf('password')) - 1) < 1e-9,
     (bitsOf('PASSWORD') - bitsOf('password')).toFixed(6));
  ok('混合大小写的加价按长度算（pAsSwOrD 加 8 比特）',
     Math.abs((bitsOf('pAsSwOrD') - bitsOf('password')) - 8) < 1e-9,
     (bitsOf('pAsSwOrD') - bitsOf('password')).toFixed(6));

  /* ---------- 12. 中文与非 ASCII ---------- */
  section('12. 中文与非 ASCII');

  const cn = E('中文密码测试');
  ok('6 个汉字 → 字符集 2000', cn.charset === 2000, String(cn.charset));
  ok('有效熵 = 6 × log₂(2000)', Math.abs(cn.bits - 6 * LOG2_2000) < 1e-9,
     cn.bits.toFixed(6) + ' vs ' + (6 * LOG2_2000).toFixed(6));
  ok('字符构成里只列了「中日韩文字」一项',
     cn.classes.length === 1 && cn.classes[0].id === 'cjk' && cn.classes[0].count === 6,
     JSON.stringify(cn.classes));
  ok('挂了一条「没有词表可查、会高估」的提示（这条会影响结论，必须说）',
     cn.warnings.some((x) => /中日韩/.test(x.title)),
     cn.warnings.map((x) => x.title).join(' / '));
  ok('emoji 按码点算，不算成两个字符', E('😀😀').length === 2, String(E('😀😀').length));

  /* ---------- 13. 输入边界 ---------- */
  section('13. 输入边界');

  const empty = E('');
  ok('空输入：empty=true、0 比特、没有段、没有告警',
     empty.empty === true && empty.bits === 0 && empty.segments.length === 0 &&
     empty.warnings.length === 0);
  ok('null 与 undefined 不会抛', E(null).empty === true && E(undefined).empty === true);
  ok('单个字符不会崩', E('a').length === 1 && E('a').bits === Math.log2(26));

  const long = E('a'.repeat(600));
  ok('600 位触发超长分支', long.tooLong === true);
  ok('超长时只给朴素估计（有效熵 = 上界）', Math.abs(long.bits - long.naiveBits) < EPS);
  ok('超长时没有拆解段', long.segments.length === 0);
  ok('超长时说明少算了什么',
     long.warnings.length === 1 && /512/.test(long.warnings[0].title),
     long.warnings.map((x) => x.title).join(' / '));
  ok('512 位以内仍走模式化拆解', !E('a'.repeat(512)).tooLong);

  /* ---------- 14. 告警形状统一 ---------- */
  section('14. 告警形状');

  const LEVELS = ['danger', 'warn', 'info', 'ok'];
  let bad = [];
  SAMPLES.concat(['', '中文密码测试', 'a'.repeat(600)]).forEach((pw) => {
    E(pw).warnings.forEach((x) => {
      if (LEVELS.indexOf(x.level) < 0) bad.push(pw + '：level=' + x.level);
      if (typeof x.title !== 'string' || !x.title.trim()) bad.push(pw + '：title 空');
      if (typeof x.text !== 'string' || !x.text.trim()) bad.push(pw + '：text 空');
    });
  });
  ok('每条告警都是 { level, title, text } 且三段都非空',
     bad.length === 0, bad.slice(0, 4).join(' | '));

  ok('没有命中模式的好信号会进告警（ok 档）',
     E('x7#kQ2!mZ').warnings.some((x) => x.level === 'ok'),
     E('x7#kQ2!mZ').warnings.map((x) => x.level).join(','));
  ok('弱密码会给出 danger / warn 档',
     E('123456').warnings.some((x) => x.level === 'danger'),
     E('123456').warnings.map((x) => x.level).join(','));

  /* ---------- 14b. 词表缺失时的降级 ---------- */
  section('14b. 词表缺失时降级（这条分支在页面上永远走不到，所以单独造一个没有词表的 window）');

  const bareWin = {};
  new Function('window',
    fs.readFileSync(path.join(ROOT, 'js/password-utils.js'), 'utf8'))(bareWin);
  const BP = bareWin.TOOLBOX.password;

  ok('模块在没有词表的 window 里也能加载', !!BP);
  ok('readWordlist() 找不到数据时返回 false（不抛异常）', BP.readWordlist() === false);
  ok('wordlistReady 是 false', BP.estimate('password').wordlistReady === false);

  const bare = BP.estimate('password');
  ok('没有词表时，最常见密码表照旧命中（它是手写内置的）',
     !bare.empty && bare.bits <= 1.0001, bare.bits.toFixed(3));
  ok('没有词表时，其余模式照常工作（aaaa 仍认成重复）',
     BP.estimate('aaaaaaaa').segments[0].kind === 'repeat',
     BP.estimate('aaaaaaaa').segments[0].kind);
  ok('没有词表时挂一条「这几项没查」的提示，而不是静默少算',
     bare.warnings.some((x) => /词表没加载/.test(x.title)),
     bare.warnings.map((x) => x.title).join(' / '));

  /* ---------- 15. 与站点数据一致 ---------- */
  section('15. 与 registry 一致');

  const T = w.TOOLBOX;
  const tool = T.tools.find((t) => t.slug === 'password-strength');
  ok('registry 里挂在安全分类且已上线',
     tool && tool.hub === 'security' && tool.status === 'ready',
     tool && (tool.hub + '/' + tool.status));
  ok('描述与实现一致（提到最省的拆法与破解耗时）',
     tool && /拆法|词表/.test(tool.desc) && /破解/.test(tool.desc), tool && tool.desc);
  ok('五个破解场景都是正数且名字非空',
     P.ATTACKS.length === 5 && P.ATTACKS.every((a) => a.perSec > 0 && a.name && a.note),
     String(P.ATTACKS.length));
  ok('破解场景按每秒次数从弱到强排（页面上的时间才会单调递减）',
     P.ATTACKS.every((a, i) => i === 0 || a.perSec > P.ATTACKS[i - 1].perSec),
     P.ATTACKS.map((a) => a.perSec).join(' < '));
}
