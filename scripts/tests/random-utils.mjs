/* ==========================================================================
   随机取样公共模块（js/random-utils.js）
   两个生成器工具共用。这里重点验证两件事：
     1. 取值范围与非法参数的行为；
     2. **拒绝采样真的在丢弃越界样本** —— 不是靠统计断言猜，而是把
        crypto.getRandomValues 换成一个写死的序列，直接看它跳没跳。
        jsdom 里 window.crypto.getRandomValues 可以覆盖，所以这条能精确验证。
   ========================================================================== */

import { ok, section, loadPage } from './_harness.mjs';

export default async function run() {
  /* random-utils 挂在 TOOLBOX.random 上，借随机字符串页把它加载起来 */
  const ctx = await loadPage('tools/random-string/index.html');
  const w = ctx.w;
  const R = w.TOOLBOX.random;

  ok('随机模块已挂载到 TOOLBOX.random', !!R);
  if (!R) return;

  const C = R.CHARSETS;
  const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };

  /* ---------- 1. 随机源 ---------- */
  section('1. 随机源');
  ok('crypto.getRandomValues 可用', R.available() === true);

  /* ---------- 2. 取值范围 ---------- */
  section('2. indexes 的取值范围');
  for (const size of [1, 2, 3, 7, 16, 56, 62, 90, 7776]) {
    const v = R.indexes(300, size);
    ok(`size=${size}：300 个值都是 [0, ${size}) 内的整数`,
       v.length === 300 && v.every((x) => Number.isInteger(x) && x >= 0 && x < size),
       JSON.stringify(v.slice(0, 8)));
  }
  ok('indexes(0, 10) 返回空数组', R.indexes(0, 10).length === 0);
  ok('size=1 时全部为 0', R.indexes(5, 1).every((x) => x === 0));

  /* ---------- 3. 非法参数 ---------- */
  section('3. 非法参数直接抛错，不静默兜底');
  ok('size=0 抛错', throws(() => R.indexes(1, 0)));
  ok('size 为负抛错', throws(() => R.indexes(1, -5)));
  ok('size 为 NaN 抛错', throws(() => R.indexes(1, NaN)));

  /* ---------- 4. 拒绝采样（核心） ---------- */
  section('4. 拒绝采样：越界样本必须被丢掉');

  const real = w.crypto.getRandomValues;
  let fired = false;
  let next = 0;

  /**
   * 把 crypto.getRandomValues 换成写死的序列，并把内部缓冲区逼到
   * 「刚好重填完」的那一刻 —— 之后每次取值都严格按 script 的顺序走。
   */
  function prime(script) {
    fired = false;
    next = 0;
    w.crypto.getRandomValues = function (arr) {
      if (!fired) {
        fired = true;
        for (let k = 0; k < arr.length; k++) arr[k] = script[k % script.length];
        next = 1;            /* buf[0] 已经被下面这次「探测」取走了 */
      } else {
        for (let k = 0; k < arr.length; k++) arr[k] = script[(next++) % script.length];
      }
      return arr;
    };
    /* size=2 时不会丢弃任何样本，每次调用正好消耗 1 个值 */
    for (let guard = 0; guard < 5000 && !fired; guard++) R.indexes(1, 2);
    return fired;
  }

  /* 2^32 / 3 的整数倍上限是 4294967295，所以 4294967295 也必须被丢掉 */
  ok('缓冲区已按脚本就位', prime([4294967295, 0, 4294967295, 1, 2]) === true);
  const r1 = R.indexes(3, 3);
  ok('size=3：恰好等于上限的样本被丢弃',
     JSON.stringify(r1) === '[0,1,2]', JSON.stringify(r1));
  ok('对照：若写成 v % size 会得到 [0,0,1]',
     JSON.stringify([0, 4294967295, 1].map((v) => v % 3)) === '[0,0,1]');

  /* 2^32 / 7 的上限是 4294967292 */
  ok('缓冲区已按脚本就位（size=7）', prime([0, 4294967292, 4294967295, 6]) === true);
  const r2 = R.indexes(2, 7);
  ok('size=7：两个越界样本都被丢弃',
     JSON.stringify(r2) === '[6,0]', JSON.stringify(r2));
  ok('对照：若写成 v % size 会得到 [0,3]',
     JSON.stringify([4294967292, 4294967295].map((v) => v % 7)) === '[0,3]');

  /* size 整除 2^32 时不该丢弃任何样本 */
  ok('缓冲区已按脚本就位（size=16）', prime([0, 4294967295, 7]) === true);
  const r3 = R.indexes(1, 16);
  ok('size=16 整除 2^32，最大值 4294967295 不被丢弃', r3[0] === 15, String(r3[0]));

  delete w.crypto.getRandomValues;   /* 还原成原型上的真实现 */
  ok('还原后随机源仍可用', R.available() === true && R.indexes(1, 10)[0] < 10);

  /* ---------- 5. chars / pick ---------- */
  section('5. chars / bytes / pick');
  const set = 'abc';
  const s = R.chars(set, 400);
  ok('chars 返回指定长度', s.length === 400, String(s.length));
  ok('chars 只取字符集里的字符', [...s].every((c) => set.includes(c)), s.slice(0, 12));
  ok('chars 能取到字符集里每一个字符',
     [...set].every((c) => s.includes(c)), s.slice(0, 12));
  ok('chars(set, 0) 返回空串', R.chars(set, 0) === '');
  ok('chars 对单字符集正常工作', R.chars('x', 5) === 'xxxxx');

  /* bytes：UUID 生成器要用 */
  const by = R.bytes(16);
  ok('bytes 返回指定长度的 Uint8Array',
     by instanceof w.Uint8Array && by.length === 16, String(by.length));
  ok('bytes(0) 返回空数组', R.bytes(0).length === 0);
  const byBytes = R.bytes(3000);
  ok('3000 个字节不全是同一个值', new Set(byBytes).size > 200, String(new Set(byBytes).size));
  ok('每个字节都在 0–255', [...byBytes].every((b) => Number.isInteger(b) && b >= 0 && b <= 255));

  const arr = ['a', 'b', 'c', 'd'];  ok('pick 返回数组里的元素', arr.includes(R.pick(arr)));
  ok('pickMany 返回指定个数', R.pickMany(arr, 9).length === 9);
  ok('pickMany 的元素都来自数组', R.pickMany(arr, 50).every((x) => arr.includes(x)));

  /* ---------- 6. shuffle ---------- */
  section('6. shuffle');
  const src = Array.from({ length: 50 }, (_, i) => i);
  const mixed = R.shuffle(src);
  ok('长度不变', mixed.length === src.length);
  ok('元素多重集不变（是排列）',
     JSON.stringify([...mixed].sort((a, b) => a - b)) === JSON.stringify(src));
  ok('确实打乱了顺序', JSON.stringify(mixed) !== JSON.stringify(src));
  ok('不修改原数组', JSON.stringify(src) === JSON.stringify(Array.from({ length: 50 }, (_, i) => i)));
  ok('空数组与单元素数组安全',
     R.shuffle([]).length === 0 && JSON.stringify(R.shuffle([7])) === '[7]');

  /* ---------- 7. 字符集处理 ---------- */
  section('7. 字符集处理');
  ok('filterAmbiguous 去掉 0OoIl1',
     R.filterAmbiguous('a0OoIl1z') === 'az', R.filterAmbiguous('a0OoIl1z'));
  ok('易混字符表就是 0OoIl1', R.AMBIGUOUS === '0OoIl1', R.AMBIGUOUS);

  ok('normalizeCharset 去重且保序',
     R.normalizeCharset('aabbcc') === 'abc', R.normalizeCharset('aabbcc'));
  ok('normalizeCharset 去掉空白',
     R.normalizeCharset('a b\tc\nd') === 'abcd', JSON.stringify(R.normalizeCharset('a b\tc\nd')));
  ok('normalizeCharset 区分大小写',
     R.normalizeCharset('aA') === 'aA', R.normalizeCharset('aA'));
  ok('normalizeCharset 容忍 null', R.normalizeCharset(null) === '');

  /* ---------- 8. 字符集常量 ---------- */
  section('8. 字符集常量');
  ok('大写字母 26 个', C.upper === 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', C.upper);
  ok('小写字母 26 个', C.lower === 'abcdefghijklmnopqrstuvwxyz', C.lower);
  ok('数字 10 个', C.digits === '0123456789', C.digits);
  ok('符号 28 个', C.symbols.length === 28, String(C.symbols.length));
  ok('符号里没有需要转义的 " \' ` \\',
     ['"', "'", '`', '\\'].every((c) => !C.symbols.includes(c)), C.symbols);
  ok('符号里没有空白与易混字符',
     !/\s/.test(C.symbols) &&
     [...R.AMBIGUOUS].every((c) => !C.symbols.includes(c)), C.symbols);
  ok('四类合起来 90 个字符且无重复',
     new Set(C.upper + C.lower + C.digits + C.symbols).size === 90,
     String(new Set(C.upper + C.lower + C.digits + C.symbols).size));

  /* ---------- 9. 熵 ---------- */
  section('9. 熵');
  ok('entropyPerChar(2) = 1', R.entropyPerChar(2) === 1);
  ok('entropyPerChar(62) ≈ 5.954', Math.abs(R.entropyPerChar(62) - Math.log2(62)) < 1e-12);
  ok('字符集为 1 时熵为 0（没有不确定性）', R.entropyPerChar(1) === 0);
  ok('字符集为 0 时不返回 NaN', R.entropyPerChar(0) === 0);
}
