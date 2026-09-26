/* ==========================================================================
   时间戳转换
   移植自 jamalofski/praticulus 的 timestamp-converter。测试重点：
     - 四档单位（秒 / 毫秒 / 微秒 / 纳秒）的自动识别 —— 19 位纳秒是上游的缺陷点
     - 手动指定单位能覆盖自动判定
     - 带小数的秒级时间戳、带 + 号的数字（上游都解析不了）
     - 裸日期的 UTC / 本地两种口径
     - 时区对照表的偏移计算（用「墙钟时间 − 偏移 = 同一时刻」这条不变量覆盖全部时区）
     - 非法输入、批量上限、复制
   期望值全部手工核对过，不依赖运行结果反推。
   本地时区随机器不同，所以凡涉及本地时间的地方都用「不变量」断言而不是硬编码值。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

/* 与实现无关地重述一遍常用时区表，用来校验对照表的行数 */
const CURATED = [
  'UTC',
  'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Kolkata', 'Asia/Dubai',
  'Europe/London', 'Europe/Paris', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Australia/Sydney'
];
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const EXPECTED_ZONES = [LOCAL_TZ].concat(CURATED.filter((z) => z !== LOCAL_TZ)).length;

/* 已核对过的常量 */
const T = 1717200000;                        /* 2024-06-01T00:00:00Z 的秒级时间戳 */
const ISO_T = '2024-06-01T00:00:00.000Z';
const DATE_T = Date.UTC(2026, 5, 1) / 1000;  /* 2026-06-01T00:00:00Z 的秒级时间戳 */

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/timestamp-converter/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;

  const $ = (sel) => d.querySelector(sel);
  const iso = () => $('#ts-iso-text').textContent;
  const status = () => $('#ts-status').textContent;
  const rowEls = () => [...d.querySelectorAll('#ts-rows .value-row')];
  const rowMap = () => {
    const out = {};
    for (const r of rowEls()) {
      out[r.querySelector('.value-label').textContent] = r.querySelector('.value-text').textContent;
    }
    return out;
  };
  const get = (label) => rowMap()[label];
  const zoneEls = () => [...d.querySelectorAll('#ts-zones .value-row')];
  const zoneMap = () => {
    const out = [];
    for (const r of zoneEls()) {
      out.push({
        label: r.querySelector('.value-label').textContent,
        value: r.querySelector('.value-text').textContent
      });
    }
    return out;
  };
  const batchRows = () => [...d.querySelectorAll('#ts-batch-body tr')];

  const click = async (sel, wait = 40) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const setInput = async (v) => {
    const el = $('#ts-input');
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    /* 输入走 90ms 防抖。这里留到 300ms：全量测试跑到这个套件时进程里已经
       加载过几十个 jsdom 页面，CPU 一忙 170ms 就可能不够 —— 踩过一次
       「刚刚」偶发失败（读到的是上一次渲染的结果），单独跑这个套件却始终通过。 */
    await sleep(300);
  };
  const setUnit = async (id) => click('#ts-units [data-unit="' + id + '"]');
  const setBatch = async (v) => {
    const el = $('#ts-batch');
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(200);
  };
  const setBareLocal = async (on) => {
    const el = $('#ts-bare-local');
    el.checked = on;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(60);
  };
  const setCustomTz = async (v) => {
    const el = $('#ts-custom-tz');
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(60);
  };

  /* 「2026-06-01 08:00:00 +08:00」→ 该墙钟时间对应的时刻 */
  const parseWall = (text) => {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2}):(\d{2})$/.exec(text);
    if (!m) return null;
    const wallAsUTC = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const off = (m[7] === '-' ? -1 : 1) * (+m[8] * 60 + +m[9]);
    return { instant: wallAsUTC - off * 60000, offset: off };
  };

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('五个单位胶囊',
     [...d.querySelectorAll('#ts-units .choice-chip')].map((b) => b.textContent).join(',') ===
     '自动,秒,毫秒,微秒,纳秒',
     [...d.querySelectorAll('#ts-units .choice-chip')].map((b) => b.textContent).join(','));
  ok('默认选中「自动」',
     $('#ts-units [data-unit="auto"]').getAttribute('aria-pressed') === 'true');
  ok('首屏填的是当前的秒级时间戳（10 位数字）',
     /^\d{10}$/.test($('#ts-input').value), $('#ts-input').value);
  ok('首屏结果等于该时间戳的 ISO 8601',
     iso() === new Date(Number($('#ts-input').value) * 1000).toISOString(), iso());
  ok('结果区 9 行', rowEls().length === 9, String(rowEls().length));
  ok('结果行的标签正确',
     Object.keys(rowMap()).join(',') ===
     'Unix 秒,Unix 毫秒,ISO 8601 (UTC),ISO 8601 (本地),RFC 1123 (UTC),本地时间,本地时区,星期,相对现在',
     Object.keys(rowMap()).join(','));
  ok('首屏自动判定为「秒」', status().includes('按 10 位数字判定为「秒」'), status());
  ok('时区对照表行数与「本地 + 常用时区去重」一致',
     zoneEls().length === EXPECTED_ZONES,
     zoneEls().length + ' vs ' + EXPECTED_ZONES);
  ok('本地时区排在第一行并带「（本地）」',
     zoneMap()[0].label === LOCAL_TZ + '（本地）', zoneMap()[0].label);
  ok('本地时区那一行有高亮类', zoneEls()[0].classList.contains('ts-local'));
  ok('对照表里有 UTC', zoneMap().some((z) => z.label === 'UTC'));
  ok('对照表没有重复时区',
     new Set(zoneMap().map((z) => z.label)).size === zoneEls().length);
  ok('批量区首屏给提示',
     $('#ts-batch-status').textContent === '一行填一个时间戳或日期',
     $('#ts-batch-status').textContent);
  ok('批量表格首屏隐藏', $('#ts-batch-wrap').hidden);

  /* ---------- 2. 四档单位的自动识别（核心回归） ---------- */
  section('2. 四档单位的自动识别');
  await setInput(String(T));
  ok('10 位 → 秒', iso() === ISO_T, iso());
  ok('状态行说明按 10 位判定为秒', status().includes('按 10 位数字判定为「秒」'), status());

  await setInput(String(T * 1000));
  ok('13 位 → 毫秒，同一时刻', iso() === ISO_T, iso());
  ok('状态行说明按 13 位判定为毫秒', status().includes('按 13 位数字判定为「毫秒」'), status());

  await setInput(String(T * 1e6));
  ok('16 位 → 微秒，同一时刻', iso() === ISO_T, iso());
  ok('状态行说明按 16 位判定为微秒', status().includes('按 16 位数字判定为「微秒」'), status());

  /* 上游在这里把 19 位当成微秒，算出公元 56385 年 */
  await setInput(String(T) + '000000000');
  ok('19 位 → 纳秒，同一时刻（上游会算成公元 56385 年）', iso() === ISO_T, iso());
  ok('状态行说明按 19 位判定为纳秒', status().includes('按 19 位数字判定为「纳秒」'), status());

  /* ---------- 3. 手动指定单位 ---------- */
  section('3. 手动指定单位');
  await setUnit('ms');
  await setInput('1717200000');
  ok('指定毫秒后，10 位数字按毫秒解释',
     iso() === '1970-01-20T21:00:00.000Z', iso());
  ok('状态行说明是手动指定', status().includes('已按「毫秒」解释'), status());

  await setUnit('ns');
  await setInput('1717200000000');
  ok('指定纳秒后，13 位数字按纳秒解释',
     iso() === '1970-01-01T00:28:37.200Z', iso());

  await setUnit('s');
  await setInput('1717200000');
  ok('指定秒后结果正确', iso() === ISO_T, iso());

  await setUnit('auto');
  ok('切回自动后恢复按位数判定',
     status().includes('按 10 位数字判定为「秒」'), status());

  /* ---------- 4. 边界与非法输入 ---------- */
  section('4. 边界与非法输入');
  await setInput('0');
  ok('0 → 1970-01-01T00:00:00.000Z', iso() === '1970-01-01T00:00:00.000Z', iso());
  ok('0 的 Unix 秒是 0', get('Unix 秒') === '0', get('Unix 秒'));

  await setInput('-1');
  ok('-1 → 1969-12-31T23:59:59.000Z', iso() === '1969-12-31T23:59:59.000Z', iso());
  ok('-1 的 Unix 秒是 -1（向下取整）', get('Unix 秒') === '-1', get('Unix 秒'));

  /* 上游：`1717200000.5` 解析不了，而 `1.5` 会被 V8 当日期解析成垃圾 */
  await setInput('1717200000.5');
  ok('带小数的秒级时间戳能解析',
     iso() === '2024-06-01T00:00:00.500Z', iso());
  ok('带小数的毫秒位进了 Unix 毫秒', get('Unix 毫秒') === '1717200000500', get('Unix 毫秒'));

  await setInput('1.5');
  ok('短小数按秒解释，不再落到日期解析',
     iso() === '1970-01-01T00:00:01.500Z', iso());

  await setInput('+1717200000');
  ok('带 + 号的数字能解析（上游不行）', iso() === ISO_T, iso());

  await setInput('-1717200000');
  ok('负时间戳正确', iso() === '1915-08-03T00:00:00.000Z', iso());

  await setInput('1234567890123456789012');
  ok('22 位数字报「太长」',
     status().includes('数字太长'), status());
  ok('太长时结果区进入空状态', $('#ts-rows .code-empty') !== null);

  await setInput('abc');
  ok('非数字非日期报解析失败', status().includes('不是合法的时间戳或日期'), status());
  ok('错误行里带上原始输入',
     $('#ts-status .err-raw').textContent.includes('abc'),
     $('#ts-status .err-raw').textContent);
  ok('解析失败时结果区不可复制',
     $('#ts-iso').getAttribute('data-copy-target') === null);

  await setInput('   ');
  ok('纯空白按空输入处理', status() === '输入一个时间戳或日期', status());
  ok('空输入时结果区显示占位', iso() === '—', iso());
  ok('空输入时对照表也清空', zoneEls().length === 0, String(zoneEls().length));

  /* ---------- 5. 日期字符串与裸日期 ---------- */
  section('5. 日期字符串与裸日期');
  await setInput('2026-06-01T00:00:00Z');
  ok('带 Z 的 ISO 串解析正确', get('Unix 秒') === String(DATE_T), get('Unix 秒'));
  ok('带 Z 的串不触发裸日期提示', !status().includes('裸日期'), status());

  await setInput('2026-06-01');
  ok('裸日期默认按 UTC 零点', get('Unix 秒') === String(DATE_T), get('Unix 秒'));
  ok('状态行说明是 UTC 零点口径',
     status().includes('裸日期按 UTC 零点解释'), status());
  ok('状态行同时给出对应的本地时间',
     status().includes('本地为 ' + get('本地时间')), status());

  await setBareLocal(true);
  ok('打开开关后裸日期按本地零点',
     get('Unix 秒') === String(new Date(2026, 5, 1, 0, 0, 0, 0).getTime() / 1000),
     get('Unix 秒'));
  ok('状态行改成本地口径', status().includes('裸日期按本地零点解释'), status());

  await setBareLocal(false);
  ok('关掉开关后回到 UTC 口径', get('Unix 秒') === String(DATE_T), get('Unix 秒'));

  await setInput('2026-06-01T08:00:00');
  ok('带时间不带时区按本地零点解释',
     get('Unix 秒') === String(new Date(2026, 5, 1, 8, 0, 0, 0).getTime() / 1000),
     get('Unix 秒'));

  /* ---------- 6. 结果行内容 ---------- */
  section('6. 结果行内容');
  await setInput(String(T));
  ok('Unix 毫秒 = 秒 × 1000',
     get('Unix 毫秒') === String(T * 1000), get('Unix 毫秒'));
  ok('ISO 8601 (UTC) 与主结果一致', get('ISO 8601 (UTC)') === iso());
  ok('RFC 1123 是 UTC 写法',
     get('RFC 1123 (UTC)') === 'Sat, 01 Jun 2024 00:00:00 GMT', get('RFC 1123 (UTC)'));
  ok('星期是星期六', get('星期') === '星期六', get('星期'));
  ok('本地时区行带偏移',
     /^[A-Za-z_/+-]+ [+-]\d{2}:\d{2}$/.test(get('本地时区')), get('本地时区'));
  ok('ISO 8601 (本地) 带偏移后缀',
     /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(get('ISO 8601 (本地)')),
     get('ISO 8601 (本地)'));

  /* 本地时间与 UTC 表示同一时刻（不变量，与机器时区无关） */
  const localBack = new Date(get('本地时间').replace(' ', 'T')).getTime();
  ok('本地时间行与 UTC 行表示同一时刻', localBack === T * 1000,
     get('本地时间') + ' → ' + localBack);
  ok('ISO 8601 (本地) 解析回来也是同一时刻',
     new Date(get('ISO 8601 (本地)')).getTime() === T * 1000,
     get('ISO 8601 (本地)'));

  /* 相对现在 */
  /* 输入是秒级的，而页面里的「现在」是毫秒级的 —— 用 floor/ceil 把截断误差
     放到安全的一侧，否则 +7200 秒算出来的 diff 会落在 7199.x 秒，被算成「1 小时后」 */
  await setInput(String(Math.floor(Date.now() / 1000) - 7200));
  ok('2 小时前', get('相对现在') === '2 小时前', get('相对现在'));
  await setInput(String(Math.ceil(Date.now() / 1000) + 7200));
  ok('2 小时后', get('相对现在') === '2 小时后', get('相对现在'));
  await setInput(String(Math.floor(Date.now() / 1000)));
  /* 秒级输入 vs 毫秒级的「现在」：capture 之后只要跨过一个整秒，diff 就从
     「不足 1 秒」变成「1 秒出头」，标签跟着从「刚刚」变成「1 秒前」。
     全量跑时这个套件前前后后要等好几秒，命中概率不低（单独跑几乎不会）——
     踩过一次全量红、单跑绿。两档都是「最近一秒内」的正确输出，断言放宽到这两种；
     别的档位（2 小时前 / 3 天前 / 2 年后）照旧严格比较。 */
  ok('刚刚（跨过一个整秒就是「1 秒前」）',
     ['刚刚', '1 秒前'].includes(get('相对现在')),
     'rel=' + JSON.stringify(get('相对现在')) + ' 行数=' + rowEls().length +
     ' 状态=' + JSON.stringify(status()) + ' 输入=' + JSON.stringify($('#ts-input').value));
  await setInput(String(Math.floor(Date.now() / 1000) - 86400 * 3));
  ok('3 天前', get('相对现在') === '3 天前', get('相对现在'));
  await setInput(String(Math.floor(Date.now() / 1000) - 31536000 * 2));
  ok('2 年前（按 365 天/年）', get('相对现在') === '2 年前', get('相对现在'));

  /* ---------- 7. 时区对照表 ---------- */
  section('7. 时区对照表');
  await setInput(String(T));
  const zones = zoneMap();
  let allSame = true;
  let offsetsOk = true;
  let badZone = '';
  for (const z of zones) {
    const p = parseWall(z.value);
    if (!p) { badZone = z.label + ' = ' + z.value; break; }
    /* 「墙钟时间 − 偏移」必须等于同一个时刻 */
    if (p.instant !== T * 1000) { allSame = false; badZone = z.label + ' = ' + z.value; }
    /* 偏移必须落在 ±14 小时之内 */
    if (Math.abs(p.offset) > 840) offsetsOk = false;
  }
  ok('每一行都能解析成「墙钟时间 + 偏移」', badZone === '', badZone);
  ok('全部时区行指向同一个时刻（不变量）', allSame, badZone);
  ok('全部偏移都在 ±14 小时之内', offsetsOk);

  const utcRow = zones.find((z) => z.label === 'UTC');
  ok('UTC 行就是 UTC 墙钟时间',
     utcRow.value === '2024-06-01 00:00:00 +00:00', utcRow.value);

  /* 自定义时区 */
  await setCustomTz('Europe/Berlin');
  ok('自定义时区加入对照表', zoneEls().length === EXPECTED_ZONES + 1,
     String(zoneEls().length));
  ok('自定义时区排在本地之后',
     zoneMap()[1].label === 'Europe/Berlin', zoneMap()[1].label);
  ok('自定义时区的时间正确（夏令时 UTC+2）',
     zoneMap()[1].value === '2024-06-01 02:00:00 +02:00', zoneMap()[1].value);
  ok('提示文字说已加入', $('#ts-custom-hint').textContent.includes('已加入'),
     $('#ts-custom-hint').textContent);

  await setCustomTz('Not/AZone');
  ok('非法时区标红', $('#ts-custom-tz').classList.contains('input--invalid'));
  ok('非法时区给提示', $('#ts-custom-hint').textContent.includes('不认识'),
     $('#ts-custom-hint').textContent);
  ok('编辑过程中对照表不闪（保留上一个合法时区）',
     zoneEls().length === EXPECTED_ZONES + 1 && zoneMap()[1].label === 'Europe/Berlin',
     String(zoneEls().length));

  $('#ts-custom-tz').dispatchEvent(new w.Event('blur', { bubbles: true }));
  await sleep(40);
  ok('失焦后回退成上一个合法时区',
     $('#ts-custom-tz').value === 'Europe/Berlin', $('#ts-custom-tz').value);
  ok('失焦后清掉标红', !$('#ts-custom-tz').classList.contains('input--invalid'));

  await setCustomTz('');
  ok('清空自定义时区后恢复', zoneEls().length === EXPECTED_ZONES, String(zoneEls().length));

  /* 冬天与夏天的偏移不同（夏令时） */
  await setCustomTz('Europe/Berlin');
  await setInput(String(Date.UTC(2024, 0, 15) / 1000));
  ok('冬季 Berlin 是 UTC+1',
     zoneMap()[1].value === '2024-01-15 01:00:00 +01:00', zoneMap()[1].value);
  await setCustomTz('');

  /* ---------- 8. 批量转换 ---------- */
  section('8. 批量转换');
  await setInput(String(T));
  await setBatch([T, T * 1000, '2026-06-01'].join('\n'));
  ok('三行输入渲染三行', batchRows().length === 3, String(batchRows().length));
  ok('批量表格显示出来', $('#ts-batch-wrap').hidden === false);
  ok('三行的 Unix 秒分别是 T / T / DATE_T',
     batchRows().map((r) => r.children[1].textContent).join(',') ===
     [T, T, DATE_T].join(','),
     batchRows().map((r) => r.children[1].textContent).join(','));
  ok('批量状态行说明已转换 3 行',
     $('#ts-batch-status').textContent === '已转换 3 行', $('#ts-batch-status').textContent);

  await setBatch([T, 'abc', T * 1e6].join('\n'));
  ok('非法行标为 cell-error',
     batchRows()[1].querySelector('.cell-error') !== null);
  ok('非法行内容原样保留', batchRows()[1].children[0].textContent === 'abc');
  ok('状态行说明有 1 行解析不了',
     $('#ts-batch-status').textContent === '已转换 3 行，其中 1 行解析不了',
     $('#ts-batch-status').textContent);

  await setBatch('');
  ok('清空批量后表格隐藏', $('#ts-batch-wrap').hidden === true);

  /* 行数上限 */
  await setBatch(Array.from({ length: 502 }, (_, i) => String(T + i)).join('\n'));
  ok('超过 500 行时只渲染 500 行', batchRows().length === 500, String(batchRows().length));
  ok('状态行说明截断了',
     $('#ts-batch-status').textContent.includes('输入 502 行，只处理前 500 行'),
     $('#ts-batch-status').textContent);

  await setBatch('');

  /* ---------- 9. 复制与按钮 ---------- */
  section('9. 复制与按钮');
  await setInput(String(T));
  copied = null;
  await click('#ts-rows .value-row:nth-child(1)');
  ok('点第 1 行复制的是 Unix 秒', copied === String(T), JSON.stringify(copied));

  copied = null;
  await click('#ts-rows .value-row:nth-child(4)');
  ok('点第 4 行复制的是 ISO 8601 (本地)', copied === get('ISO 8601 (本地)'), JSON.stringify(copied));

  copied = null;
  await click('#ts-iso');
  ok('点主结果复制 ISO 8601 (UTC)', copied === ISO_T, JSON.stringify(copied));

  copied = null;
  await click('#ts-copy-zones');
  const zoneLines = (copied || '').split('\n');
  ok('时区 TSV 行数 = 表头 + 时区数',
     zoneLines.length === EXPECTED_ZONES + 1, String(zoneLines.length));
  ok('时区 TSV 表头正确',
     zoneLines[0] === '时区\t当地时间\t与 UTC 的偏移', JSON.stringify(zoneLines[0]));
  ok('时区 TSV 第一行是本地时区',
     zoneLines[1].startsWith(LOCAL_TZ + '\t'), JSON.stringify(zoneLines[1]));

  await setBatch([T, 'abc'].join('\n'));
  copied = null;
  await click('#ts-copy-batch');
  const batchLines = (copied || '').split('\n');
  ok('批量 TSV 共 3 行（表头 + 2 行）', batchLines.length === 3, String(batchLines.length));
  ok('批量 TSV 表头正确',
     batchLines[0] === '输入\tUnix 秒\tISO 8601 (UTC)\t本地时间', JSON.stringify(batchLines[0]));
  ok('批量 TSV 里非法行留空',
     batchLines[2] === 'abc\t\t\t', JSON.stringify(batchLines[2]));
  await setBatch('');

  await click('#ts-now');
  ok('点「现在」填入当前秒级时间戳',
     /^\d{10}$/.test($('#ts-input').value) &&
     Math.abs(Number($('#ts-input').value) - Math.floor(Date.now() / 1000)) < 5,
     $('#ts-input').value);

  copied = null;
  await click('#ts-share');
  ok('分享链接写进 hash', /^#t=\d+$/.test(w.location.hash), w.location.hash);
  ok('分享链接复制的是完整 URL',
     (copied || '').endsWith(w.location.hash), JSON.stringify(copied));

  await click('#ts-clear');
  ok('清空后输入框为空', $('#ts-input').value === '', $('#ts-input').value);
  ok('清空后 hash 被去掉', w.location.hash === '', w.location.hash);
  ok('清空后进入空状态', $('#ts-rows .code-empty') !== null);

  /* ---------- 10. 页面结构 ---------- */
  section('10. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为转换类的青色',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#0d9488',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('说明区写明了四种单位的位数',
     d.querySelector('.tool-notes').textContent.includes('19 位'));
  ok('说明区解释了裸日期的两种口径',
     d.querySelector('.tool-notes').textContent.includes('UTC 零点'));
  ok('说明区写了相对时间的口径',
     d.querySelector('.tool-notes').textContent.includes('365 天'));
  ok('说明区有来源与致谢',
     d.querySelector('.tool-notes').textContent.includes('jamalofski/praticulus'));
  ok('工具页没有内联事件处理器',
     !/on(click|change|input)=/.test(ctx.html));
}
