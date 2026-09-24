/* ==========================================================================
   进制转换
   自研工具。测试重点：
     - 大整数精确：2^64 附近的数不能像 Number 那样丢低位 —— 核心回归
     - 任意 2–36 进制互转（含自定义进制输入）
     - 0x / 0b / 0o 前缀优先且不回落
     - 位宽补齐与负数补码；超出位宽只警告不截断
     - 分隔符剥离、非法字符定位、超长拦截
   期望值全部手工核对过，不依赖运行结果反推。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/base-converter/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;

  const $ = (sel) => d.querySelector(sel);
  const main = () => $('#bc-main-text').textContent;
  const rowMap = () => {
    const out = {};
    for (const r of d.querySelectorAll('#bc-rows .value-row')) {
      out[r.querySelector('.value-label').textContent] = r.querySelector('.value-text').textContent;
    }
    return out;
  };
  const get = (label) => rowMap()[label];
  const rowLabels = () => Object.keys(rowMap());
  const stats = () => {
    const out = {};
    for (const s of d.querySelectorAll('#bc-stats .stat')) {
      out[s.querySelector('.stat-label').textContent] = s.querySelector('.stat-value').textContent;
    }
    return out;
  };
  const status = () => $('#bc-status').textContent;

  const click = async (sel, wait = 40) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const setInput = async (v) => {
    const el = $('#bc-input');
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(170);                        /* 输入走 90ms 防抖 */
  };
  const setSrc = (id) => click('#bc-src [data-src="' + id + '"]');
  const setDst = (id) => click('#bc-dst [data-dst="' + id + '"]');
  const setWidth = (id) => click('#bc-width [data-width="' + id + '"]');
  const setCustom = async (which, v) => {
    const el = $(which === 'src' ? '#bc-src-custom' : '#bc-dst-custom');
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(170);
  };
  const setUpper = async (on) => {
    const el = $('#bc-upper');
    el.checked = on;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(40);
  };
  const reset = async () => {
    await setSrc('10');
    await setDst('16');
    await setWidth('none');
    await setUpper(false);
  };

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('源进制 5 个胶囊，默认 10',
     count(d, '#bc-src .choice-chip') === 5 &&
     $('#bc-src [data-src="10"]').getAttribute('aria-pressed') === 'true');
  ok('目标进制 5 个胶囊，默认 16',
     count(d, '#bc-dst .choice-chip') === 5 &&
     $('#bc-dst [data-dst="16"]').getAttribute('aria-pressed') === 'true');
  ok('位宽 5 个胶囊，默认「不补齐」',
     count(d, '#bc-width .choice-chip') === 5 &&
     $('#bc-width [data-width="none"]').getAttribute('aria-pressed') === 'true');
  ok('自定义进制输入框默认隐藏',
     $('#bc-src-custom-wrap').hidden && $('#bc-dst-custom-wrap').hidden);
  ok('大写开关默认关闭', $('#bc-upper').checked === false);
  ok('首屏主结果 255 → ff', main() === 'ff', main());
  ok('结果 4 行（单字节时不出现字节视图）',
     rowLabels().join(',') === '二进制,八进制,十进制,十六进制', rowLabels().join(','));
  ok('二进制按 4 位分组', get('二进制') === '1111 1111', get('二进制'));
  ok('八进制 377', get('八进制') === '377', get('八进制'));
  ok('十进制 255', get('十进制') === '255', get('十进制'));
  ok('十六进制 ff', get('十六进制') === 'ff', get('十六进制'));
  ok('统计四项正确',
     stats()['二进制位'] === '8 位' && stats()['字节数'] === '1 字节' &&
     stats()['置 1 位'] === '8 位' && stats()['结果位数'] === '2 位',
     JSON.stringify(stats()));
  ok('状态行说明按十进制解析', status() === '按十进制解析', status());
  ok('目标进制徽章显示十六进制',
     $('#bc-dst-label').textContent === '十六进制', $('#bc-dst-label').textContent);

  /* ---------- 2. 基本转换 ---------- */
  section('2. 基本转换');
  await setDst('2');
  ok('255 → 二进制 11111111', main() === '11111111', main());
  ok('目标进制徽章跟着变', $('#bc-dst-label').textContent === '二进制',
     $('#bc-dst-label').textContent);
  await setDst('8');
  ok('255 → 八进制 377', main() === '377', main());
  await setDst('10');
  ok('255 → 十进制 255', main() === '255', main());

  await setSrc('2');
  await setInput('1010');
  await setDst('16');
  ok('二进制 1010 → 十六进制 a', main() === 'a', main());
  ok('状态行说明按二进制解析', status() === '按二进制解析', status());

  await setSrc('16');
  await setInput('ff');
  await setDst('10');
  ok('十六进制 ff → 十进制 255', main() === '255', main());
  await setInput('FF');
  ok('十六进制大小写不敏感', main() === '255', main());

  await setSrc('8');
  await setInput('377');
  await setDst('10');
  ok('八进制 377 → 十进制 255', main() === '255', main());

  /* ---------- 3. 大整数精确（核心回归） ---------- */
  section('3. 大整数精确');
  await reset();
  await setInput('18446744073709551615');
  ok('2^64−1 → 十六进制全 f',
     main() === 'ffffffffffffffff', main());
  ok('十进制行加千分位',
     get('十进制') === '18,446,744,073,709,551,615', get('十进制'));
  ok('二进制 64 位全是 1',
     get('二进制') === '1111 1111 1111 1111 1111 1111 1111 1111 ' +
       '1111 1111 1111 1111 1111 1111 1111 1111',
     get('二进制'));
  ok('字节视图出现并分成 8 组',
     get('字节视图') === 'ff ff ff ff ff ff ff ff', get('字节视图'));
  ok('统计：64 位 / 8 字节 / 64 个 1',
     stats()['二进制位'] === '64 位' && stats()['字节数'] === '8 字节' &&
     stats()['置 1 位'] === '64 位', JSON.stringify(stats()));

  /* Number 在这里会给出 18446744073709552000 —— 差 383 */
  await setInput('18446744073709551617');
  ok('2^64+1 → 10000000000000001（Number 会算错）',
     main() === '10000000000000001', main());
  ok('十进制行原样保留', get('十进制') === '18,446,744,073,709,551,617', get('十进制'));
  ok('统计：65 位 / 9 字节 / 2 个 1',
     stats()['二进制位'] === '65 位' && stats()['字节数'] === '9 字节' &&
     stats()['置 1 位'] === '2 位', JSON.stringify(stats()));

  /* 更长的：10^40（34 位十六进制 / 133 位二进制） */
  await setInput('1' + '0'.repeat(40));
  ok('10^40 的十六进制',
     main() === '1d6329f1c35ca4bfabb9f5610000000000', main());
  ok('10^40 的二进制位数为 133', stats()['二进制位'] === '133 位', stats()['二进制位']);

  /* ---------- 4. 前缀 ---------- */
  section('4. 前缀');
  await reset();
  await setInput('0xff');
  ok('0xff 按十六进制解析', main() === 'ff', main());
  ok('状态行说明按前缀解释',
     status().includes('按前缀解释为十六进制'), status());

  await setInput('0b1010');
  ok('0b1010 按二进制解析', main() === 'a', main());
  await setInput('0o377');
  await setDst('10');
  ok('0o377 按八进制解析', main() === '255', main());

  /* 前缀优先于源进制选择 */
  await setSrc('2');
  await setInput('0xff');
  await setDst('10');
  ok('前缀优先于源进制选择', main() === '255', main());

  /* 前缀解释失败时不回落到源进制 */
  await reset();
  await setSrc('16');
  await setInput('0b1f');
  ok('0b1f 报错而不是当成十六进制',
     status().includes('不是合法的数字'), status());
  ok('错误提示里点明了前缀的含义',
     $('#bc-rows .code-empty').textContent.includes('前缀 0b 表示按 2 进制解析'),
     $('#bc-rows .code-empty').textContent);
  ok('错误提示里给出原始输入',
     $('#bc-status .err-raw').textContent.includes('0b1f'),
     $('#bc-status .err-raw').textContent);

  await reset();
  await setInput('0x');
  ok('只有前缀没有数字时报错',
     $('#bc-rows .code-empty').textContent.includes('后面没有数字'),
     $('#bc-rows .code-empty').textContent);

  /* ---------- 5. 分隔符 ---------- */
  section('5. 分隔符');
  await reset();
  await setSrc('2');
  await setInput('1111 1111');
  await setDst('10');
  ok('空格分隔的二进制', main() === '255', main());
  await setInput('1111_1111');
  ok('下划线分隔的二进制', main() === '255', main());
  await setInput('1111,1111');
  ok('逗号分隔的二进制', main() === '255', main());
  ok('状态行说明剥掉了分隔符',
     status().includes('已剥掉输入里的分隔符'), status());

  await reset();
  await setInput('1,234,567');
  ok('十进制千分位剥离后正确',
     main() === '12d687', main());

  /* ---------- 6. 位宽与补码 ---------- */
  section('6. 位宽与补码');
  await reset();
  await setInput('-1');
  ok('不选位宽时负数按符号 + 绝对值', main() === '-1', main());
  ok('状态行说明不做补码',
     status().includes('不做补码'), status());

  await setWidth('8');
  ok('-1 在 8 位下是 ff', main() === 'ff', main());
  ok('8 位补码的二进制', get('二进制') === '1111 1111', get('二进制'));
  ok('状态行说明已按 8 位补码显示',
     status().includes('已按 8 位补码显示'), status());

  await setWidth('16');
  ok('-1 在 16 位下是 ffff', main() === 'ffff', main());
  await setWidth('32');
  ok('-1 在 32 位下是 ffffffff', main() === 'ffffffff', main());
  await setWidth('64');
  ok('-1 在 64 位下是 16 个 f', main() === 'ffffffffffffffff', main());

  await setWidth('8');
  await setInput('5');
  ok('8 位下正数左侧补零（十六进制）', main() === '05', main());
  ok('8 位下正数左侧补零（二进制）', get('二进制') === '0000 0101', get('二进制'));
  await setWidth('16');
  await setDst('2');
  ok('16 位二进制补齐', main() === '0000000000000101', main());
  await setDst('16');

  /* 超出位宽只警告不截断 */
  await setWidth('8');
  await setInput('300');
  ok('300 放不进 8 位时按原样显示', main() === '12c', main());
  ok('给出超范围警告',
     $('#bc-status .is-warn') !== null && status().includes('放不进 8 位'), status());
  ok('警告里写出该位宽的范围',
     status().includes('-128 … 127'), status());

  await setInput('-300');
  ok('负向超范围也按原样显示', main() === '-12c', main());
  ok('负向超范围也警告', $('#bc-status .is-warn') !== null);

  /* 八进制与十进制不受位宽影响 */
  await setWidth('8');
  await setInput('255');
  await setDst('8');
  ok('八进制不受位宽影响（不做补码也不补零）', main() === '377', main());
  await setDst('10');
  ok('十进制不受位宽影响', main() === '255', main());

  await setInput('-1');
  await setDst('10');
  ok('十进制负数仍是 -1', main() === '-1', main());
  await setDst('16');

  /* ---------- 7. 大写 ---------- */
  section('7. 十六进制大写');
  await reset();
  await setInput('255');
  await setUpper(true);
  ok('主结果大写', main() === 'FF', main());
  ok('十六进制行大写', get('十六进制') === 'FF', get('十六进制'));
  ok('二进制行不受影响', get('二进制') === '1111 1111', get('二进制'));
  await setInput('3735928559');
  ok('字节视图也大写',
     get('字节视图') === 'DE AD BE EF', get('字节视图'));
  await setUpper(false);
  ok('关掉后回到小写', main() === 'deadbeef', main());

  /* ---------- 8. 自定义进制 ---------- */
  section('8. 自定义进制');
  await reset();
  await setSrc('custom');
  ok('选「自定义」后源进制输入框出现', $('#bc-src-custom-wrap').hidden === false);
  await setCustom('src', 3);
  await setInput('210');
  await setDst('10');
  ok('三进制 210 = 十进制 21', main() === '21', main());
  ok('状态行说明按三进制解析', status() === '按三进制解析', status());

  await setSrc('10');
  await setDst('custom');
  ok('选「自定义」后目标进制输入框出现', $('#bc-dst-custom-wrap').hidden === false);
  await setCustom('dst', 36);
  await setInput('255');
  ok('十进制 255 → 三十六进制 73', main() === '73', main());
  ok('目标进制徽章显示三十六进制',
     $('#bc-dst-label').textContent === '三十六进制', $('#bc-dst-label').textContent);

  /* 自定义进制非法时标红 + 失焦回退 */
  await setCustom('dst', 37);
  ok('超出 36 时标红', $('#bc-dst-custom').classList.contains('input--invalid'));
  await setCustom('dst', 1);
  ok('小于 2 时标红', $('#bc-dst-custom').classList.contains('input--invalid'));
  $('#bc-dst-custom').dispatchEvent(new w.Event('blur', { bubbles: true }));
  await sleep(40);
  ok('失焦后回退到最近的合法值 2', $('#bc-dst-custom').value === '2',
     $('#bc-dst-custom').value);
  ok('失焦后清掉标红', !$('#bc-dst-custom').classList.contains('input--invalid'));

  /* ---------- 9. 非法输入 ---------- */
  section('9. 非法输入');
  await reset();
  await setInput('xyz');
  ok('非法字符报错', status().includes('不是合法的数字'), status());
  ok('提示里定位到具体字符',
     $('#bc-rows .code-empty').textContent.includes('第 1 个字符「x」'),
     $('#bc-rows .code-empty').textContent);
  ok('提示里列出该进制的合法数字',
     $('#bc-rows .code-empty').textContent.includes('0123456789'),
     $('#bc-rows .code-empty').textContent);
  ok('解析失败时主结果不可复制',
     $('#bc-main').getAttribute('data-copy-target') === null);

  await setSrc('2');
  await setInput('102');
  ok('二进制里的 2 被定位到第 3 个字符',
     $('#bc-rows .code-empty').textContent.includes('第 3 个字符「2」'),
     $('#bc-rows .code-empty').textContent);
  ok('提示里列出二进制的合法数字',
     $('#bc-rows .code-empty').textContent.includes('只允许 01'),
     $('#bc-rows .code-empty').textContent);

  await reset();
  await setInput('1.5');
  ok('小数被拒绝（不猜截断精度）', status().includes('不是合法的数字'), status());

  await setInput('1' + '0'.repeat(2000));
  ok('超过 2000 位被拦下', status().includes('输入位数超过 2000 位'), status());

  await setInput('');
  ok('空输入显示占位', main() === '—', main());
  ok('空输入进入空状态', $('#bc-rows .code-empty') !== null);
  ok('空输入清空统计', count(d, '#bc-stats .stat') === 0);
  ok('空输入的状态提示', status() === '输入一个数字', status());

  /* ---------- 10. 复制 ---------- */
  section('10. 复制');
  await reset();
  await setInput('255');
  copied = null;
  await click('#bc-rows .value-row:nth-child(1)');
  ok('点第 1 行复制二进制', copied === '1111 1111', JSON.stringify(copied));
  copied = null;
  await click('#bc-main');
  ok('点主结果复制', copied === 'ff', JSON.stringify(copied));

  copied = null;
  await click('#bc-copy-all');
  const lines = (copied || '').split('\n');
  ok('复制全部 5 行（1 行主结果 + 4 行）', lines.length === 5, String(lines.length));
  ok('首行带进制名', lines[0] === '十六进制\tff', JSON.stringify(lines[0]));
  ok('含八进制行', lines[2] === '八进制\t377', JSON.stringify(lines[2]));

  /* ---------- 11. 页面结构 ---------- */
  section('11. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为转换类的青色',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#0d9488',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('说明区解释了 Number 的精度上限',
     d.querySelector('.tool-notes').textContent.includes('9007 万亿'));
  ok('说明区解释了补码与位宽的关系',
     d.querySelector('.tool-notes').textContent.includes('补码'));
  ok('说明区解释了为什么不支持小数',
     d.querySelector('.tool-notes').textContent.includes('无限循环'));
  ok('工具页没有内联事件处理器',
     !/on(click|change|input)=/.test(ctx.html));
}
