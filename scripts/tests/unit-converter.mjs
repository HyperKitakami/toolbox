/* ==========================================================================
   单位换算
   自研工具。测试重点：
     - 温度必须走函数换算（系数表会把 1 °C 算成 1.8 °F）—— 这是本工具最核心的回归点
     - 数据存储的 SI 十进制前缀与 IEC 二进制前缀必须同时正确
     - 精确定义值可以直接对答案（1 in = 25.4 mm、1 nmi = 1852 m）
     - 结构性关系：正反互换的乘积为 1、列表与结果区一致、自转换不漂移
     - 有效数字档位与指数写法（大数 / 小数两侧各测一次）
     - 非法输入标红 + 失焦回退；空输入进入空状态
   期望值全部手算可复核，不使用「跑一遍看结果」的写法。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/unit-converter/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;

  const $ = (sel) => d.querySelector(sel);
  const result = () => $('#uc-result-text').textContent;
  const status = () => $('#uc-status').textContent;
  const rows = () => [...d.querySelectorAll('#uc-list .value-row')];
  const labels = () => rows().map((r) => r.querySelector('.value-label').textContent);
  const values = () => rows().map((r) => r.querySelector('.value-text').textContent);
  const rowOf = (name) => {
    const i = labels().indexOf(name);
    return i < 0 ? null : values()[i];
  };

  const fire = async (el, type, wait = 30) => {
    el.dispatchEvent(new w.Event(type, { bubbles: true }));
    await sleep(wait);
  };
  const setValue = async (v) => {
    const el = $('#uc-value');
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(170);                       /* 输入走 90ms 防抖，留余量 */
  };
  const pick = async (id, val) => {
    const el = $(id);
    el.value = val;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(30);
  };
  const setSig = (n) => pick('#uc-sig', String(n));
  const setCat = async (id) => {
    d.querySelector('#uc-cats [data-cat="' + id + '"]')
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(30);
  };
  const click = async (sel) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(30);
  };
  /** 一次把分类 / 单位 / 数值 / 精度都摆好（精度不传就复位成默认的 6） */
  const setup = async (catId, from, to, value, sig) => {
    if ($('#uc-cats [data-cat="' + catId + '"]').getAttribute('aria-pressed') !== 'true') {
      await setCat(catId);
    }
    await pick('#uc-from', from);
    await pick('#uc-to', to);
    await setSig(sig || 6);
    await setValue(String(value));
  };

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('九个分类胶囊', count(d, '#uc-cats .choice-chip') === 9,
     String(count(d, '#uc-cats .choice-chip')));
  ok('分类顺序正确',
     [...d.querySelectorAll('#uc-cats .choice-chip')].map((b) => b.textContent).join(',') ===
     '长度,面积,体积,质量,温度,速度,数据存储,时间,角度',
     [...d.querySelectorAll('#uc-cats .choice-chip')].map((b) => b.textContent).join(','));
  ok('默认选中「长度」',
     $('#uc-cats [data-cat="length"]').getAttribute('aria-pressed') === 'true');
  ok('有效数字五档，默认 6', count(d, '#uc-sig option') === 5 && $('#uc-sig').value === '6',
     $('#uc-sig').value);
  ok('长度有 11 个单位', count(d, '#uc-from option') === 11,
     String(count(d, '#uc-from option')));
  ok('默认原单位是米、目标单位是英尺',
     $('#uc-from').value === 'm' && $('#uc-to').value === 'ft',
     $('#uc-from').value + ' -> ' + $('#uc-to').value);
  ok('首屏结果 1 米 = 3.28084 英尺', result() === '3.28084 ft', result());
  ok('全部单位列表 11 行', rows().length === 11, String(rows().length));
  ok('状态行给出正反两个方向',
     status() === '1 米 = 3.28084 英尺 · 1 英尺 = 0.3048 米', status());
  ok('原单位下方标了精确定义（米）',
     $('#uc-from-info').textContent.includes('精确定义') &&
     $('#uc-from-info').querySelector('.uc-exact') !== null);
  ok('基准单位不显示「1 米 = 1 米」这种废话',
     !$('#uc-from-info').textContent.includes('1 米 = 1 米'), $('#uc-from-info').textContent);
  ok('目标单位下方给出定义关系（1 英尺 = 0.3048 米）',
     $('#uc-to-info').textContent.includes('1 英尺 = 0.3048 米') &&
     $('#uc-to-info').querySelector('.uc-exact') !== null,
     $('#uc-to-info').textContent);

  /* ---------- 2. 长度：精确定义直接对答案 ---------- */
  section('2. 长度：精确定义');
  await setup('length', 'in', 'mm', 1, 12);
  ok('1 英寸 = 25.4 毫米（精确定义）', result() === '25.4 mm', result());
  await setup('length', 'nmi', 'm', 1);
  ok('1 海里 = 1852 米（精确定义）', result() === '1852 m', result());
  await setup('length', 'ft', 'm', 1);
  ok('1 英尺 = 0.3048 米（精确定义）', result() === '0.3048 m', result());
  await setup('length', 'mi', 'km', 1, 12);
  ok('1 英里 = 1.609344 千米（6 位精度下是 1.60934）', result() === '1.609344 km', result());
  await setup('length', 'yd', 'ft', 1);
  ok('1 码 = 3 英尺', result() === '3 ft', result());
  await setup('length', 'mi', 'ft', 1);
  ok('1 英里 = 5280 英尺', result() === '5280 ft', result());

  /* ---------- 3. 结构性关系 ---------- */
  section('3. 结构性关系');
  await setup('length', 'm', 'ft', 1, 6);
  ok('列表里源单位那一行就是输入值本身（自转换不漂移）',
     rowOf('米') === '1 m', String(rowOf('米')));
  ok('列表里目标单位那一行与结果区一致',
     rowOf('英尺') === result(), rowOf('英尺') + ' vs ' + result());

  await setValue('2.5');
  ok('换一个输入值，源单位行跟着变', rowOf('米') === '2.5 m', String(rowOf('米')));
  ok('毫米行 = 2500 mm', rowOf('毫米') === '2500 mm', String(rowOf('毫米')));

  /* 正反互换：X 米 = R1 英尺，1 英尺 = R2 米，R1 × R2 ≈ 1 */
  await setValue('1');
  const r1 = parseFloat(result());
  await click('#uc-swap');
  ok('交换按钮换掉了单位', $('#uc-from').value === 'ft' && $('#uc-to').value === 'm',
     $('#uc-from').value + ' -> ' + $('#uc-to').value);
  const r2 = parseFloat(result());
  ok('1 英尺 = 0.3048 米', r2 === 0.3048, String(r2));
  ok('正反互换的乘积为 1（3.28084 × 0.3048）',
     Math.abs(r1 * r2 - 1) < 1e-5, `${r1} × ${r2} = ${r1 * r2}`);

  /* 英制↔公制的换算系数必须严格等于定义值，逐个抽查 */
  await setup('length', 'm', 'in', 1, 12);
  ok('1 米 = 39.3700787402 英寸',
     result() === '39.3700787402 in', result());
  await setup('length', 'km', 'mi', 1, 12);
  ok('1 千米 = 0.621371192237 英里',
     result() === '0.621371192237 mi', result());

  /* ---------- 4. 温度（核心回归：不能走系数表） ---------- */
  section('4. 温度');
  await setup('temperature', 'c', 'f', 1);
  ok('1 摄氏度 = 33.8 华氏度（不是 1.8）', result() === '33.8 °F', result());
  await setValue('0');
  ok('0 摄氏度 = 32 华氏度', result() === '32 °F', result());
  await setValue('100');
  ok('100 摄氏度 = 212 华氏度', result() === '212 °F', result());
  await setValue('-40');
  ok('-40 摄氏度 = -40 华氏度（唯一相等的点）', result() === '-40 °F', result());

  await setup('temperature', 'c', 'k', 0);
  ok('0 摄氏度 = 273.15 开尔文', result() === '273.15 K', result());
  await setup('temperature', 'k', 'c', 0);
  ok('0 开尔文 = -273.15 摄氏度（绝对零度）', result() === '-273.15 °C', result());
  await setup('temperature', 'f', 'c', 32);
  ok('32 华氏度 = 0 摄氏度', result() === '0 °C', result());
  await setup('temperature', 'k', 'r', 0);
  ok('0 开尔文 = 0 兰氏度', result() === '0 °R', result());
  await setup('temperature', 'c', 'r', 0);
  ok('0 摄氏度 = 491.67 兰氏度', result() === '491.67 °R', result());

  /* 往返一致：25 °C = 77 °F，77 °F 换回来还是 25 °C */
  await setup('temperature', 'c', 'f', 25);
  const f25 = result();
  ok('25 摄氏度 = 77 华氏度', f25 === '77 °F', f25);
  await setup('temperature', 'f', 'c', 77);
  ok('77 华氏度换回 25 摄氏度', result() === '25 °C', result());

  /* 低于绝对零度：警告但不拦截 */
  await setup('temperature', 'c', 'f', -300);
  ok('低于绝对零度时仍给出结果（-300 °C = -508 °F）',
     result() === '-508 °F', result());
  ok('低于绝对零度时状态行给警告',
     $('#uc-status .is-warn') !== null && status().includes('绝对零度'), status());
  ok('警告里写明该单位刻度上的下限',
     status().includes('-273.15 °C'), status());

  await setValue('-200');
  ok('回到合法区间后警告消失', $('#uc-status .is-warn') === null, status());

  await setup('temperature', 'k', 'c', -1);
  ok('开尔文低于 0 也警告', $('#uc-status .is-warn') !== null, status());

  /* ---------- 5. 数据存储：两套前缀 ---------- */
  section('5. 数据存储');
  await setup('data', 'kb', 'b', 1, 12);
  ok('1 千字节 = 1000 字节（SI 10³）', result() === '1000 B', result());
  await setup('data', 'kib', 'b', 1, 12);
  ok('1 千比字节 = 1024 字节（IEC 2¹⁰）', result() === '1024 B', result());
  await setup('data', 'mib', 'b', 1, 12);
  ok('1 兆比字节 = 1048576 字节', result() === '1048576 B', result());
  await setup('data', 'bit', 'b', 1);
  ok('1 比特 = 0.125 字节', result() === '0.125 B', result());
  await setup('data', 'b', 'bit', 1);
  ok('1 字节 = 8 比特', result() === '8 bit', result());

  /* 这一对是本工具要回答的核心问题：1 MB 到底等于多少 MiB */
  await setup('data', 'mb', 'mib', 1);
  ok('1 兆字节 = 0.953674 兆比字节（1000000 ÷ 1048576）',
     result() === '0.953674 MiB', result());
  await setup('data', 'mib', 'mb', 1);
  ok('1 兆比字节 = 1.04858 兆字节', result() === '1.04858 MB', result());

  /* 硬盘标称：1 TB 按 SI 标，操作系统按二进制算 */
  await setup('data', 'tb', 'gib', 1);
  ok('1 太字节 = 931.323 吉比字节（「1 TB 硬盘显示 931 GiB」的由来）',
     result() === '931.323 GiB', result());
  await setup('data', 'tb', 'tib', 1);
  ok('1 太字节 = 0.909495 太比字节', result() === '0.909495 TiB', result());
  await setup('data', 'tb', 'tib', 1000);
  ok('1000 太字节 = 909.495 太比字节', result() === '909.495 TiB', result());

  /* 结构性：同一数量级下 kB 与 KiB 的比恒为 1.024 */
  await setup('data', 'mb', 'kib', 1, 12);
  const kbIn = result();
  await setup('data', 'mb', 'kb', 1, 12);
  const kbDec = result();
  ok('1 MB = 1000 kB = 976.5625 KiB（两套前缀的比值 = 1.024）',
     kbDec === '1000 kB' && kbIn === '976.5625 KiB', `${kbDec} / ${kbIn}`);
  ok('1000 ÷ 1024 的关系成立',
     Math.abs(parseFloat(kbDec) / parseFloat(kbIn) - 1.024) < 1e-9,
     String(parseFloat(kbDec) / parseFloat(kbIn)));

  /* ---------- 6. 其余分类抽查 ---------- */
  section('6. 面积 / 体积 / 质量 / 速度 / 时间 / 角度');
  await setup('area', 'ha', 'm2', 1, 12);
  ok('1 公顷 = 10000 平方米', result() === '10000 m²', result());
  await setup('area', 'mu', 'm2', 1, 12);
  ok('1 市亩 = 666.666666667 平方米（2000/3）', result() === '666.666666667 m²', result());
  await setup('area', 'ha', 'mu', 1, 12);
  ok('1 公顷 = 15 市亩', result() === '15 亩', result());
  await setup('area', 'ac', 'm2', 1);
  ok('1 英亩 = 4046.86 平方米', result() === '4046.86 m²', result());

  await setup('volume', 'l', 'ml', 1, 12);
  ok('1 升 = 1000 毫升', result() === '1000 mL', result());
  await setup('volume', 'galus', 'l', 1, 12);
  ok('1 美制加仑 = 3.785411784 升', result() === '3.785411784 L', result());
  await setup('volume', 'galuk', 'l', 1, 12);
  ok('1 英制加仑 = 4.54609 升（与美制不是同一个单位）',
     result() === '4.54609 L', result());

  await setup('mass', 'lb', 'kg', 1, 12);
  ok('1 磅 = 0.45359237 千克（精确定义）', result() === '0.45359237 kg', result());
  await setup('mass', 'oz', 'g', 1, 12);
  ok('1 盎司 = 28.349523125 克', result() === '28.349523125 g', result());
  await setup('mass', 'jin', 'g', 1, 12);
  ok('1 市斤 = 500 克', result() === '500 g', result());
  await setup('mass', 'st', 'lb', 1, 12);
  ok('1 英石 = 14 磅', result() === '14 lb', result());

  await setup('speed', 'kmh', 'mps', 1, 12);
  ok('1 千米/小时 = 0.277777777778 米/秒', result() === '0.277777777778 m/s', result());
  await setup('speed', 'kmh', 'mph', 1);
  ok('1 千米/小时 = 0.621371 英里/小时', result() === '0.621371 mph', result());
  await setup('speed', 'kn', 'kmh', 1, 12);
  ok('1 节 = 1.852 千米/小时', result() === '1.852 km/h', result());

  await setup('time', 'h', 'min', 1, 12);
  ok('1 小时 = 60 分钟', result() === '60 min', result());
  await setup('time', 'd', 'h', 1, 12);
  ok('1 天 = 24 小时', result() === '24 h', result());
  await setup('time', 'yr', 'd', 1, 12);
  ok('1 儒略年 = 365.25 天', result() === '365.25 d', result());

  await setup('angle', 'deg', 'rad', 180);
  ok('180 度 = 3.14159 弧度', result() === '3.14159 rad', result());
  await setup('angle', 'turn', 'deg', 1, 12);
  ok('1 转 = 360 度', result() === '360 °', result());
  await setup('angle', 'deg', 'arcmin', 1, 12);
  ok('1 度 = 60 角分', result() === '60 ′', result());
  await setup('angle', 'rad', 'deg', 1, 12);
  ok('1 弧度 = 57.2957795131 度', result() === '57.2957795131 °', result());

  /* ---------- 7. 精度档位与指数写法 ---------- */
  section('7. 精度档位与指数写法');
  await setup('length', 'm', 'ft', 1, 4);
  ok('4 位有效数字：1 米 = 3.281 英尺', result() === '3.281 ft', result());
  await setSig(6);
  ok('6 位：1 米 = 3.28084 英尺', result() === '3.28084 ft', result());
  await setSig(8);
  ok('8 位：1 米 = 3.2808399 英尺', result() === '3.2808399 ft', result());
  await setSig(12);
  ok('12 位：1 米 = 3.28083989501 英尺', result() === '3.28083989501 ft', result());
  await setSig(6);

  /* 小数侧走指数写法：1 bit 换成 PB */
  await setup('data', 'bit', 'pb', 1, 6);
  ok('极小值用指数写法：1 比特 = 1.25e-16 拍字节', result() === '1.25e-16 PB', result());
  /* 大数侧走指数写法：1 PB 换成 bit */
  await setup('data', 'pb', 'bit', 1, 6);
  ok('极大值用指数写法：1 拍字节 = 8e+15 比特', result() === '8e+15 bit', result());

  /* 浮点噪声必须被收敛掉：0.1 + 0.2 那一类 */
  await setup('length', 'mm', 'cm', 30, 12);
  ok('30 毫米 = 3 厘米（不出现 2.9999999999999996）', result() === '3 cm', result());
  await setup('volume', 'ml', 'l', 300, 12);
  ok('300 毫升 = 0.3 升（不出现 0.30000000000000004）', result() === '0.3 L', result());

  /* ---------- 8. 非法输入与空输入 ---------- */
  section('8. 非法输入与空输入');
  await setup('length', 'm', 'ft', 1, 6);
  await setValue('abc');
  ok('非数字标红', $('#uc-value').classList.contains('input--invalid'));
  ok('非数字时状态行报错',
     $('#uc-status .is-error') !== null && status().includes('不是合法的数字'), status());
  ok('非数字时结果沿用上一次的合法值', result() === '3.28084 ft', result());
  await fire($('#uc-value'), 'blur');
  ok('失焦后回退成上一次的合法值', $('#uc-value').value === '1', $('#uc-value').value);
  ok('失焦后清掉标红', !$('#uc-value').classList.contains('input--invalid'));
  ok('失焦后状态行恢复正常',
     $('#uc-status .is-error') === null && status().includes('1 米 = 3.28084 英尺'), status());

  await setValue('1,000');
  ok('千分位逗号不接受', $('#uc-value').classList.contains('input--invalid'));
  await fire($('#uc-value'), 'blur');
  await setValue('1e3');
  ok('科学计数法接受', !$('#uc-value').classList.contains('input--invalid'));
  ok('1e3 米 = 3280.84 英尺', result() === '3280.84 ft', result());

  await setValue('0x10');
  ok('十六进制写法不接受', $('#uc-value').classList.contains('input--invalid'));
  await fire($('#uc-value'), 'blur');

  await setValue('');
  ok('空输入时结果区显示占位', result() === '—', result());
  ok('空输入时列表进入空状态', $('#uc-list .code-empty') !== null);
  ok('空输入时不残留结果行', rows().length === 0, String(rows().length));
  ok('空输入时状态行给提示', status() === '输入一个数值开始换算', status());
  ok('空输入时两个复制入口都不再可复制',
     $('#uc-result').getAttribute('data-copy-target') === null &&
     $('#uc-copy').getAttribute('data-copy-target') === null);

  copied = null;
  await click('#uc-copy-all');
  ok('空输入时「复制全部」不复制', copied === null, JSON.stringify(copied));

  await setValue('2');
  ok('重新输入后恢复结果', result() === '6.56168 ft', result());
  ok('重新输入后两个复制入口都恢复',
     $('#uc-result').getAttribute('data-copy-target') === '#uc-result-text' &&
     $('#uc-copy').getAttribute('data-copy-target') === '#uc-result-text');
  ok('重新输入后列表恢复', rows().length === 11, String(rows().length));

  /* ---------- 9. 交互 ---------- */
  section('9. 交互');
  await setup('length', 'm', 'ft', 1, 6);
  copied = null;
  await click('#uc-list .value-row:nth-child(8)');
  ok('点第 8 行（英尺）复制的是该行的值', copied === '3.28084 ft', JSON.stringify(copied));
  ok('该行标记为已复制',
     rows()[7].getAttribute('data-copied') === 'true');

  copied = null;
  await click('#uc-copy-all');
  const lines = (copied || '').split('\n');
  ok('复制全部共 12 行（1 行表头 + 11 个单位）', lines.length === 12, String(lines.length));
  ok('表头写明输入口径', lines[0] === '1 米（m）=', lines[0]);
  ok('源单位行是「1 m + 制表符 + 米」', lines[5] === '1 m\t米', JSON.stringify(lines[5]));
  ok('目标单位行与结果一致', lines[8] === '3.28084 ft\t英尺', JSON.stringify(lines[8]));

  /* 切分类要重置成该类的默认单位对 */
  await setCat('data');
  ok('切到数据存储后重置为 MB -> MiB',
     $('#uc-from').value === 'mb' && $('#uc-to').value === 'mib',
     $('#uc-from').value + ' -> ' + $('#uc-to').value);
  ok('切分类后胶囊选中状态跟着变',
     $('#uc-cats [data-cat="data"]').getAttribute('aria-pressed') === 'true' &&
     $('#uc-cats [data-cat="length"]').getAttribute('aria-pressed') === 'false');
  ok('切分类后列表行数跟着变', rows().length === 11, String(rows().length));
  ok('切分类后原单位说明跟着换',
     $('#uc-from-info').textContent.includes('SI 前缀'), $('#uc-from-info').textContent);
  ok('切分类后输入值保留', $('#uc-value').value === '1', $('#uc-value').value);

  await setCat('temperature');
  ok('切到温度后重置为 摄氏度 -> 华氏度',
     $('#uc-from').value === 'c' && $('#uc-to').value === 'f',
     $('#uc-from').value + ' -> ' + $('#uc-to').value);
  ok('温度只有 4 个单位', count(d, '#uc-from option') === 4,
     String(count(d, '#uc-from option')));

  await setCat('length');
  ok('切回长度后单位对也复位', $('#uc-from').value === 'm' && $('#uc-to').value === 'ft');

  /* ---------- 10. 页面结构 ---------- */
  section('10. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为转换类的青色',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#0d9488',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('说明区讲清了 kB 与 KiB 的区别',
     d.querySelector('.tool-notes').textContent.includes('KiB') &&
     d.querySelector('.tool-notes').textContent.includes('1024'));
  ok('说明区解释了为什么不给马赫数',
     d.querySelector('.tool-notes').textContent.includes('马赫'));
  ok('说明区标注了精确定义',
     d.querySelector('.tool-notes').textContent.includes('精确定义'));
  ok('工具页没有内联事件处理器',
     !/on(click|change|input)=/.test(ctx.html));
}
