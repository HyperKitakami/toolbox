/* ==========================================================================
   数字格式化
   自研工具。测试重点：
     - 十进制取整：1.005 保留两位必须是 1.01（toFixed 会给 1.00）—— 核心回归
     - 大整数不丢精度（20 位数字原样保留，不经过 Number）
     - 三种取整模式（四舍五入 / 银行家舍入 / 截断）
     - 分组方式（3 位 / 印度式 3-2-2）与小数分隔符
     - 输入解析：千分位逗号、下划线、空格、科学计数法、非法写法
     - 人民币大写金额的零与「整」的规则
   期望值全部手工核对过，不依赖运行结果反推。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/number-formatter/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;

  const $ = (sel) => d.querySelector(sel);
  const main = () => $('#nf-main-text').textContent;
  const rowMap = () => {
    const out = {};
    for (const r of d.querySelectorAll('#nf-rows .value-row')) {
      out[r.querySelector('.value-label').textContent] = r.querySelector('.value-text').textContent;
    }
    return out;
  };
  const get = (label) => rowMap()[label];
  const stats = () => {
    const out = {};
    for (const s of d.querySelectorAll('#nf-stats .stat')) {
      out[s.querySelector('.stat-label').textContent] = s.querySelector('.stat-value').textContent;
    }
    return out;
  };
  const status = () => $('#nf-status').textContent;

  const click = async (sel, wait = 40) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const setInput = async (v) => {
    const el = $('#nf-input');
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(170);                        /* 输入走 90ms 防抖 */
  };
  const setOpt = (boxSel, attr, id) => click(boxSel + ' [data-' + attr + '="' + id + '"]');
  const setCurrency = async (code) => {
    const el = $('#nf-currency');
    el.value = code;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(40);
  };
  /** 回到默认选项，避免用例之间互相影响 */
  const reset = async () => {
    await setOpt('#nf-decimals', 'dec', 'auto');
    await setOpt('#nf-group', 'group', 'west');
    await setOpt('#nf-sep', 'sep', 'dot');
    await setOpt('#nf-round', 'round', 'halfUp');
    await setCurrency('CNY');
  };

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('小数位 8 个档位，默认「自动」',
     count(d, '#nf-decimals .choice-chip') === 8 &&
     $('#nf-decimals [data-dec="auto"]').getAttribute('aria-pressed') === 'true',
     String(count(d, '#nf-decimals .choice-chip')));
  ok('分组 3 个，默认「3 位分组」',
     count(d, '#nf-group .choice-chip') === 3 &&
     $('#nf-group [data-group="west"]').getAttribute('aria-pressed') === 'true');
  ok('小数分隔符 2 个，默认「1.23」',
     count(d, '#nf-sep .choice-chip') === 2 &&
     $('#nf-sep [data-sep="dot"]').getAttribute('aria-pressed') === 'true');
  ok('取整 3 个，默认「四舍五入」',
     count(d, '#nf-round .choice-chip') === 3 &&
     $('#nf-round [data-round="halfUp"]').getAttribute('aria-pressed') === 'true');
  ok('货币 10 个选项，默认 CNY',
     count(d, '#nf-currency option') === 10 && $('#nf-currency').value === 'CNY');
  ok('首屏主结果 1,234,567.89', main() === '1,234,567.89', main());
  ok('结果区 7 行',
     Object.keys(rowMap()).join(',') ===
     '无分组,代码字面量,科学计数法,工程计数法,百分比（×100）,货币（CNY）,人民币大写',
     Object.keys(rowMap()).join(','));
  ok('统计四项正确',
     stats()['整数位'] === '7 位' && stats()['小数位'] === '2 位' &&
     stats()['数量级'] === '10^6' && stats()['精度'] === '安全',
     JSON.stringify(stats()));
  ok('状态行给出解析结果', status().includes('已解析为 1234567.89'), status());
  ok('状态行说明小数位是自动',
     status().includes('小数位为「自动」'), status());

  /* ---------- 2. 各种格式 ---------- */
  section('2. 各种格式（默认选项）');
  ok('无分组', get('无分组') === '1234567.89', get('无分组'));
  ok('代码字面量用下划线分组',
     get('代码字面量') === '1_234_567.89', get('代码字面量'));
  ok('科学计数法', get('科学计数法') === '1.23456789e+6', get('科学计数法'));
  ok('工程计数法（指数是 3 的倍数）',
     get('工程计数法') === '1.23456789e+6', get('工程计数法'));
  ok('百分比（×100）', get('百分比（×100）') === '123,456,789%', get('百分比（×100）'));
  ok('货币 CNY', get('货币（CNY）') === '¥1,234,567.89', get('货币（CNY）'));
  ok('人民币大写',
     get('人民币大写') === '壹佰贰拾叁万肆仟伍佰陆拾柒元捌角玖分', get('人民币大写'));

  /* ---------- 3. 十进制取整（核心回归） ---------- */
  section('3. 十进制取整');
  await setOpt('#nf-decimals', 'dec', '2');

  await setInput('1.005');
  ok('1.005 保留两位 = 1.01（toFixed 会给 1.00）', main() === '1.01', main());
  await setOpt('#nf-round', 'round', 'halfEven');
  ok('1.005 银行家舍入 = 1.00（取到偶数）', main() === '1.00', main());
  await setOpt('#nf-round', 'round', 'trunc');
  ok('1.005 截断 = 1.00', main() === '1.00', main());
  await setOpt('#nf-round', 'round', 'halfUp');

  await setInput('8.575');
  ok('8.575 保留两位 = 8.58（toFixed 会给 8.57）', main() === '8.58', main());
  await setInput('2.675');
  ok('2.675 保留两位 = 2.68（toFixed 会给 2.67）', main() === '2.68', main());

  await setInput('1.015');
  await setOpt('#nf-round', 'round', 'halfEven');
  ok('1.015 银行家舍入 = 1.02（末位 1 是奇数，进位到偶数）', main() === '1.02', main());
  await setOpt('#nf-round', 'round', 'halfUp');

  /* 整数位的进位要正确回写 */
  await setInput('9.999');
  ok('9.999 保留两位 = 10.00（进位跨过整数位）', main() === '10.00', main());
  await setInput('0.995');
  ok('0.995 保留两位 = 1.00', main() === '1.00', main());

  /* 正好一半才受模式影响；后面还有非零数字就一律进位 */
  await setInput('1.0051');
  await setOpt('#nf-round', 'round', 'trunc');
  ok('1.0051 截断也是 1.01（不是正好一半，一律进位）', main() === '1.01', main());
  await setOpt('#nf-round', 'round', 'halfUp');

  /* 取整到整数 */
  await setOpt('#nf-decimals', 'dec', '0');
  await setInput('2.5');
  ok('2.5 四舍五入 = 3', main() === '3', main());
  await setOpt('#nf-round', 'round', 'halfEven');
  ok('2.5 银行家舍入 = 2', main() === '2', main());
  await setInput('3.5');
  ok('3.5 银行家舍入 = 4', main() === '4', main());
  await setOpt('#nf-round', 'round', 'halfUp');
  await setInput('-2.5');
  ok('-2.5 四舍五入 = -3（远离零，不是 -0）', main() === '-3', main());
  await setInput('-0.5');
  ok('-0.5 四舍五入 = -1（Math.round 会给 -0）', main() === '-1', main());
  await setInput('-0');
  ok('-0 显示为 0（不带负号）', main() === '0', main());

  /* ---------- 4. 大整数不丢精度 ---------- */
  section('4. 大整数不丢精度');
  await reset();
  await setInput('12345678901234567890');
  ok('主结果保留全部 20 位',
     main() === '12,345,678,901,234,567,890', main());
  ok('无分组保留全部 20 位',
     get('无分组') === '12345678901234567890', get('无分组'));
  ok('代码字面量',
     get('代码字面量') === '12_345_678_901_234_567_890', get('代码字面量'));
  ok('科学计数法保留全部有效数字',
     get('科学计数法') === '1.2345678901234567890e+19', get('科学计数法'));
  ok('工程计数法', get('工程计数法') === '12.345678901234567890e+18',
     get('工程计数法'));
  ok('百分比',
     get('百分比（×100）') === '1,234,567,890,123,456,789,000%',
     get('百分比（×100）'));
  ok('统计里整数位 20 位', stats()['整数位'] === '20 位', stats()['整数位']);
  ok('统计判为超 2^53', stats()['精度'] === '超 2^53', stats()['精度']);
  ok('状态行给出精度警告',
     $('#nf-status .is-warn') !== null && status().includes('仍然精确'), status());

  await setInput('9007199254740991');
  ok('2^53−1 判为安全', stats()['精度'] === '安全', stats()['精度']);
  await setInput('9007199254740992');
  ok('2^53 判为超界', stats()['精度'] === '超 2^53', stats()['精度']);

  /* ---------- 5. 输入解析 ---------- */
  section('5. 输入解析');
  await reset();
  for (const raw of ['1_234_567.89', '1,234,567.89', '1 234 567.89', '1,234,567.89 ']) {
    await setInput(raw);
    ok(`接受「${raw}」`, main() === '1,234,567.89', main());
  }
  ok('状态行说明剥掉了分隔符',
     status().includes('已剥掉输入里的分隔符'), status());

  await setInput('1,5');
  ok('1,5 报逗号位置不合法（不猜成 15）',
     status().includes('逗号只能当千分位分隔符'), status());
  ok('1,5 的结果区进入空状态', $('#nf-rows .code-empty') !== null);

  await setInput('abc');
  ok('非数字报错', status().includes('不是一个合法的数字'), status());
  ok('错误行里带上原始输入',
     $('#nf-status .err-raw').textContent.includes('abc'),
     $('#nf-status .err-raw').textContent);
  ok('解析失败时主结果不可复制',
     $('#nf-main').getAttribute('data-copy-target') === null);

  await setInput('1e101');
  ok('指数超范围被拦下', status().includes('指数超出'), status());

  await setInput('1' + '0'.repeat(40));
  ok('超过 40 位有效数字被拦下', status().includes('有效数字超过'), status());

  await setInput('');
  ok('空输入显示占位', main() === '—', main());
  ok('空输入进入空状态', $('#nf-rows .code-empty') !== null);
  ok('空输入清空统计', count(d, '#nf-stats .stat') === 0);
  ok('空输入的状态提示', status() === '输入一个数字', status());

  /* 科学计数法输入 */
  await setInput('1e3');
  ok('1e3 = 1,000', main() === '1,000', main());
  await setInput('1.5e3');
  ok('1.5e3 = 1,500', main() === '1,500', main());
  await setInput('1.23e-4');
  ok('1.23e-4 = 0.000123', main() === '0.000123', main());
  ok('1.23e-4 的科学计数法还原', get('科学计数法') === '1.23e-4', get('科学计数法'));
  ok('1.23e-4 的工程计数法', get('工程计数法') === '123e-6', get('工程计数法'));
  ok('1.23e-4 的数量级是 10^-4', stats()['数量级'] === '10^-4', stats()['数量级']);
  await setInput('1.23e20');
  ok('1.23e20 补零展开', main() === '123,000,000,000,000,000,000', main());

  /* ---------- 6. 选项 ---------- */
  section('6. 选项');
  await reset();
  await setInput('12345678.9');
  ok('3 位分组', main() === '12,345,678.9', main());
  await setOpt('#nf-group', 'group', 'in');
  ok('印度式 3-2-2 分组', main() === '1,23,45,678.9', main());
  await setOpt('#nf-group', 'group', 'none');
  ok('不分组', main() === '12345678.9', main());

  await setOpt('#nf-group', 'group', 'west');
  await setOpt('#nf-sep', 'sep', 'comma');
  ok('小数分隔符换成逗号，千分位换成点',
     main() === '12.345.678,9', main());
  await setOpt('#nf-sep', 'sep', 'dot');

  await setInput('1.5');
  await setOpt('#nf-decimals', 'dec', '2');
  ok('固定两位时保留尾零（1.5 → 1.50）', main() === '1.50', main());
  await setOpt('#nf-decimals', 'dec', '4');
  ok('固定四位补零（1.5 → 1.5000）', main() === '1.5000', main());
  await setOpt('#nf-decimals', 'dec', 'auto');
  ok('回到自动后不再补零', main() === '1.5', main());

  await setInput('1234567.89');
  await setOpt('#nf-decimals', 'dec', '0');
  ok('保留零位时四舍五入到整数', main() === '1,234,568', main());
  await setOpt('#nf-decimals', 'dec', 'auto');

  await setCurrency('JPY');
  ok('日元默认 0 位小数',
     get('货币（JPY）') === 'JP¥1,234,568', get('货币（JPY）'));
  await setCurrency('USD');
  ok('美元符号与默认 2 位', get('货币（USD）') === '$1,234,567.89', get('货币（USD）'));
  await setCurrency('CNY');

  /* ---------- 7. 人民币大写金额 ---------- */
  section('7. 人民币大写金额');
  const CN = [
    ['0', '零元整'],
    ['0.7', '柒角整'],
    ['0.05', '伍分'],
    ['0.5', '伍角整'],
    ['1.05', '壹元零伍分'],
    ['1409.5', '壹仟肆佰零玖元伍角整'],
    ['6007.14', '陆仟零柒元壹角肆分'],
    ['107000.53', '壹拾万柒仟元零伍角叁分'],
    ['1000000', '壹佰万元整'],
    ['100000000', '壹亿元整'],
    ['100010000', '壹亿零壹万元整'],
    ['10', '壹拾元整'],
    ['1010', '壹仟零壹拾元整'],
    ['-1.5', '负壹元伍角整']
  ];
  for (const [input, expect] of CN) {
    await setInput(input);
    ok(`${input} → ${expect}`, get('人民币大写') === expect,
       `${input} → ${get('人民币大写')}`);
  }
  /* 大写金额先取整到分：三位小数按分位四舍五入 */
  await setInput('1.005');
  ok('1.005 转大写时先取整到分 → 壹元零壹分',
     get('人民币大写') === '壹元零壹分', get('人民币大写'));

  /* ---------- 8. 复制 ---------- */
  section('8. 复制');
  await reset();
  await setInput('1234567.89');
  copied = null;
  await click('#nf-rows .value-row:nth-child(1)');
  ok('点第 1 行复制无分组的值', copied === '1234567.89', JSON.stringify(copied));
  copied = null;
  await click('#nf-main');
  ok('点主结果复制', copied === '1,234,567.89', JSON.stringify(copied));

  copied = null;
  await click('#nf-copy-all');
  const lines = (copied || '').split('\n');
  ok('复制全部 8 行（1 行主结果 + 7 行）', lines.length === 8, String(lines.length));
  ok('首行是主结果', lines[0] === '普通数字\t1,234,567.89', JSON.stringify(lines[0]));
  ok('含科学计数法行', lines[3] === '科学计数法\t1.23456789e+6', JSON.stringify(lines[3]));

  /* ---------- 9. 页面结构 ---------- */
  section('9. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为转换类的青色',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#0d9488',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('说明区解释了 toFixed 的问题',
     d.querySelector('.tool-notes').textContent.includes('1.0049999999999998934'));
  ok('说明区写了印度式分组',
     d.querySelector('.tool-notes').textContent.includes('3-2-2'));
  ok('说明区写了三种取整方式',
     d.querySelector('.tool-notes').textContent.includes('银行家舍入'));
  ok('说明区写了人民币大写的规范依据',
     d.querySelector('.tool-notes').textContent.includes('正确填写票据和结算凭证的基本规定'));
  ok('工具页没有内联事件处理器',
     !/on(click|change|input)=/.test(ctx.html));
}
