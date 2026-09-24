/* ==========================================================================
   UUID 生成器
   移植自 Praticulus 的 uuid-generator。测试重点：
     - 功能：三个版本、格式选项、批量、校验器、复制下载；
     - 规范符合性：v4 的版本/变体位、v7 的毫秒时间戳与单调性、v1 的节点多播位；
     - 回归：逐条锁住移植时修掉的缺陷（v1 多播位、v7 同毫秒无顺序、
             校验器放行错位横线、批量数量不校验）。
   断言尽量用**从 UUID 字符串反推结构**的方式（版本位、变体位、时间戳），
   而不是硬编码某一串具体的值。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

/* 标准 UUID：xxxxxxxx-xxxx-Vxxx-Nxxx-xxxxxxxxxxxx
   第 15 个字符（下标 14）是版本，第 20 个字符（下标 19）是变体的高位 */
const versionOf = (u) => parseInt(u.charAt(14), 16);
const variantNibble = (u) => parseInt(u.charAt(19), 16);
const isRfcVariant = (u) => (variantNibble(u) & 0xC) === 0x8;
const nodeField = (u) => u.slice(24);              /* 最后 12 位十六进制 */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/* v7 的前 48 位是毫秒时间戳 */
const msOfV7 = (u) => parseInt(u.replace(/-/g, '').slice(0, 12), 16);

/* v1 的 60 位时间戳要 BigInt 才精确（1.4e17 超过 2^53） */
const msOfV1 = (u) => {
  const h = u.replace(/-/g, '');
  const ts = (BigInt(parseInt(h.slice(12, 16), 16) & 0x0FFF) << 48n) |
             (BigInt(parseInt(h.slice(8, 12), 16)) << 32n) |
             BigInt(parseInt(h.slice(0, 8), 16));
  return Number(ts / 10000n) - 12219292800000;
};

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/uuid-generator/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;

  const $ = (sel) => d.querySelector(sel);
  const single = () => $('#uu-value-text').textContent;
  const rows = () => [...d.querySelectorAll('#uu-list .value-row')];
  const items = () => rows().map((r) => r.querySelector('.value-text').textContent);
  const stats = () => {
    const o = {};
    for (const s of d.querySelectorAll('#uu-stats .stat')) {
      o[s.querySelector('.stat-label').textContent] = s.querySelector('.stat-value').textContent;
    }
    return o;
  };
  const validateOut = () => $('#uu-validate-result').textContent;

  const fire = async (el, type, wait = 170) => {
    el.dispatchEvent(new w.Event(type, { bubbles: true }));
    await sleep(wait);
  };
  const setVal = (el, v) => { el.value = v; return fire(el, 'input'); };
  const setCheck = async (el, on) => { el.checked = on; await fire(el, 'change'); };
  const click = async (sel, wait = 170) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const version = (id) => click('#uu-versions [data-version="' + id + '"]');
  const setCount = (n) => setVal($('#uu-count'), String(n));

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('三个版本都渲染了', count(d, '#uu-versions .choice-chip') === 3,
     String(count(d, '#uu-versions .choice-chip')));
  ok('默认是 v4', $('#uu-versions [data-version="4"]').getAttribute('aria-pressed') === 'true');
  ok('默认数量 10', $('#uu-count').value === '10', $('#uu-count').value);
  ok('单个 UUID 格式正确', RE_UUID.test(single()), single());
  ok('批量 10 条', rows().length === 10, String(rows().length));
  ok('四个统计格子',
     Object.keys(stats()).join(',') === '版本,长度,随机位,本次批量',
     Object.keys(stats()).join(','));
  ok('统计显示 36 个字符', stats()['长度'] === '36 个字符', stats()['长度']);
  ok('v4 随机位 122', stats()['随机位'] === '122 位', stats()['随机位']);
  ok('状态行说明版本与随机位', /已生成 10 条 v4 随机/.test($('#uu-status').textContent),
     $('#uu-status').textContent);

  /* ---------- 2. v4 ---------- */
  section('2. v4（随机）');
  ok('每条版本位都是 4', items().every((u) => versionOf(u) === 4), items()[0]);
  ok('每条变体都是 RFC 9562 标准值',
     items().every(isRfcVariant), items()[0]);
  ok('10 条互不相同', new Set(items()).size === 10, String(new Set(items()).size));

  await setCount(1000);
  const v4s = items();
  ok('1000 条全部唯一', new Set(v4s).size === 1000, String(new Set(v4s).size));
  ok('1000 条版本位都正确', v4s.every((u) => versionOf(u) === 4 && isRfcVariant(u)));
  await setCount(10);

  /* ---------- 3. v7 ---------- */
  section('3. v7（时间有序）');
  await version('7');
  ok('版本位是 7', items().every((u) => versionOf(u) === 7), items()[0]);
  ok('变体是 RFC 9562 标准值', items().every(isRfcVariant), items()[0]);
  ok('统计显示随机位 62', stats()['随机位'] === '62 位', stats()['随机位']);
  ok('状态行说明排序即插入顺序',
     $('#uu-status').textContent.includes('排序即插入顺序'), $('#uu-status').textContent);

  const nowMs = Date.now();
  ok('前 48 位解码出来就是当前时间（±10 秒）',
     Math.abs(msOfV7(single()) - nowMs) < 10000,
     msOfV7(single()) + ' vs ' + nowMs);

  /* 回归：上游只用毫秒时间戳，同一毫秒内的顺序是随机的 ——
     而「可按时间排序」正是 v7 相对于 v4 的全部价值。
     本工具用 RFC 9562 §6.2 的 Method 1（rand_a 的 12 位当计数器）。 */
  await setCount(1000);
  const v7s = items();
  ok('1000 条全部唯一', new Set(v7s).size === 1000, String(new Set(v7s).size));
  ok('回归：1000 条按生成顺序严格递增（排序即插入顺序）',
     v7s.every((u, i) => i === 0 || v7s[i - 1] < u),
     (() => {
       const bad = v7s.findIndex((u, i) => i > 0 && v7s[i - 1] >= u);
       return bad < 0 ? '' : '第 ' + (bad + 1) + ' 条起乱序';
     })());

  const sameMs = [];
  for (let i = 1; i < v7s.length; i++) {
    if (msOfV7(v7s[i]) === msOfV7(v7s[i - 1])) sameMs.push(i);
  }
  ok('确实有一批落在同一毫秒里（否则上面的单调性测不到点上）',
     sameMs.length > 0, sameMs.length + ' 组');
  ok('同一毫秒内的计数器是递增的',
     sameMs.every((i) => v7s[i].slice(14, 18) > v7s[i - 1].slice(14, 18)),
     sameMs.slice(0, 3).map((i) => v7s[i - 1].slice(14, 18) + '→' + v7s[i].slice(14, 18)).join(' '));
  await setCount(10);

  /* ---------- 4. v1 ---------- */
  section('4. v1（时间戳）');
  await version('1');
  ok('版本位是 1', items().every((u) => versionOf(u) === 1), items()[0]);
  ok('变体是 RFC 9562 标准值', items().every(isRfcVariant), items()[0]);
  ok('前 60 位解码出来就是当前时间（±10 秒）',
     Math.abs(msOfV1(single()) - Date.now()) < 10000,
     msOfV1(single()) + ' vs ' + Date.now());

  /* 回归：RFC 9562 §6.10 要求「用随机值当节点标识时必须把第一个字节的最低位设为 1」，
     上游漏了这一步 —— 首字节有一半概率是偶数，就可能和真实网卡 MAC 撞上。 */
  ok('回归：节点首字节的最低位是 1（RFC 9562 §6.10 的 MUST）',
     items().every((u) => (parseInt(nodeField(u).slice(0, 2), 16) & 1) === 1),
     items()[0].slice(24, 26));
  ok('节点标识在同一会话内保持一致（它是「这台机器」的状态）',
     new Set(items().map(nodeField)).size === 1, String(new Set(items().map(nodeField)).size));

  await setCount(1000);
  const v1s = items();
  ok('1000 条全部唯一（同一毫秒靠 sub 计数器补足 100 纳秒精度）',
     new Set(v1s).size === 1000, String(new Set(v1s).size));
  ok('1000 条版本位都正确', v1s.every((u) => versionOf(u) === 1 && isRfcVariant(u)));
  await setCount(10);

  /* ---------- 5. 格式选项 ---------- */
  section('5. 格式选项');
  await version('4');

  /* 注意：切换任何格式选项都会**重新生成**，所以不能拿切换前的值来比 ——
     只能断言格式本身（上一轮在占位文本工具上踩过同一个坑） */
  await setCheck($('#uu-uppercase'), true);
  ok('大写生效', /^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(single()), single());
  ok('大写后批量列表也是大写',
     items().every((u) => !/[a-f]/.test(u)), items()[0]);
  await setCheck($('#uu-uppercase'), false);
  ok('关掉后回到小写', /^[0-9a-f-]+$/.test(single()), single());

  await setCheck($('#uu-no-dashes'), true);
  ok('去横线后 32 个字符', single().length === 32, String(single().length));
  ok('去横线后不含 -', !single().includes('-'), single());
  ok('统计跟着变', stats()['长度'] === '32 个字符', stats()['长度']);

  await setCheck($('#uu-braces'), true);
  ok('去横线 + 花括号 = {32 位}',
     /^\{[0-9a-f]{32}\}$/.test(single()), single());
  ok('统计变成 34 个字符', stats()['长度'] === '34 个字符', stats()['长度']);

  await setCheck($('#uu-no-dashes'), false);
  ok('恢复横线 + 花括号 = {8-4-4-4-12}',
     /^\{[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\}$/.test(single()), single());

  await setCheck($('#uu-braces'), false);
  ok('全部关掉后回到标准形式', RE_UUID.test(single()), single());
  ok('批量列表也跟着变格式', items().every((u) => RE_UUID.test(u)), items()[0]);

  /* ---------- 6. 数量 ---------- */
  section('6. 数量');
  await setCount(1);
  ok('数量 1 -> 1 行', rows().length === 1, String(rows().length));
  await setCount(1000);
  ok('数量 1000 -> 1000 行', rows().length === 1000, String(rows().length));

  await setCount(0);
  ok('数量 0 标红', $('#uu-count').classList.contains('input--invalid'));
  ok('数量非法时按 1 渲染', rows().length === 1, String(rows().length));
  await fire($('#uu-count'), 'blur');
  ok('失焦后回退为 1', $('#uu-count').value === '1', $('#uu-count').value);
  ok('失焦后清掉标红', !$('#uu-count').classList.contains('input--invalid'));

  await setCount(5000);
  ok('数量 5000 标红', $('#uu-count').classList.contains('input--invalid'));
  ok('回归：上游会静默截断到 1000 且没有提示', rows().length === 1000, String(rows().length));
  await fire($('#uu-count'), 'blur');
  ok('失焦后回退为 1000', $('#uu-count').value === '1000', $('#uu-count').value);

  await setCount(5);

  /* ---------- 7. 校验器 ---------- */
  section('7. 校验器');
  const check = async (text) => { await setVal($('#uu-validate'), text); return validateOut(); };

  ok('标准形式判为合法',
     (await check('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).includes('合法的 UUID'));
  ok('报出 v1 与 RFC 变体',
     (await check('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).includes('v1 时间戳') &&
     (await check('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).includes('RFC 9562'));
  ok('32 位连写也认',
     (await check('6ba7b8109dad11d180b400c04fd430c8')).includes('合法的 UUID'));
  ok('花括号也认',
     (await check('{6ba7b810-9dad-11d1-80b4-00c04fd430c8}')).includes('合法的 UUID'));
  ok('urn:uuid: 前缀也认',
     (await check('urn:uuid:6ba7b810-9dad-11d1-80b4-00c04fd430c8')).includes('合法的 UUID'));
  ok('大写也认',
     (await check('6BA7B810-9DAD-11D1-80B4-00C04FD430C8')).includes('合法的 UUID'));
  ok('会回显归一化后的形式',
     (await check('{6BA7B8109DAD11D180B400C04FD430C8}')).includes('6ba7b810-9dad-11d1-80b4-00c04fd430c8'));

  /* 回归：上游把 -? 逐段可选，错位的横线也会被放行 */
  ok('回归：错位的横线判为非法',
     (await check('123456781234-1234-1234-123456789012')).includes('不是合法的 UUID'),
     await check('123456781234-1234-1234-123456789012'));
  ok('横线数量不对判为非法',
     (await check('6ba7b810-9dad-11d1-80b4-00c04fd430c')).includes('不是合法的 UUID'));
  ok('位数不对判为非法',
     (await check('6ba7b810-9dad-11d1-80b4-00c04fd430c88')).includes('不是合法的 UUID'));
  ok('非十六进制判为非法',
     (await check('6ba7b810-9dad-11d1-80b4-00c04fd430cg')).includes('不是合法的 UUID'));
  ok('中文判为非法',
     (await check('这不是一个 UUID')).includes('不是合法的 UUID'));

  ok('nil UUID 单独识别',
     (await check('00000000-0000-0000-0000-000000000000')).includes('nil（全零）'),
     await check('00000000-0000-0000-0000-000000000000'));
  ok('max UUID 单独识别',
     (await check('ffffffff-ffff-ffff-ffff-ffffffffffff')).includes('max（全一）'),
     await check('ffffffff-ffff-ffff-ffff-ffffffffffff'));
  ok('变体不是 RFC 标准值时给出警告',
     (await check('6ba7b810-9dad-11d1-0000-00c04fd430c8')).includes('变体不是 RFC 9562 标准值'),
     await check('6ba7b810-9dad-11d1-0000-00c04fd430c8'));
  ok('清空后不残留结果',
     (await check('')) === '');

  /* ---------- 8. 复制与下载 ---------- */
  section('8. 复制与下载');
  await setCount(5);
  const value = single();
  copied = null;
  await click('#uu-value');
  ok('点单条 UUID 即复制', copied === value, JSON.stringify(copied));
  ok('回归：复制反馈没有把 UUID 替换成「已复制」',
     $('#uu-value-text').textContent === value, $('#uu-value-text').textContent);
  ok('复制反馈走 data-copied', $('#uu-value').getAttribute('data-copied') === 'true');

  copied = null;
  await click('#uu-list .value-row:nth-child(3)');
  ok('点第 3 行复制的是第 3 条', copied === items()[2], JSON.stringify(copied));

  copied = null;
  await click('#uu-copy-all');
  ok('复制全部 = 各行按换行拼接', copied === items().join('\n'),
     JSON.stringify(copied).slice(0, 50));
  ok('复制全部共 5 行', (copied || '').split('\n').length === 5);
  ok('下载按钮存在', $('#uu-download') !== null);

  /* ---------- 9. 页面结构 ---------- */
  section('9. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为生成器的琥珀色',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#d97706',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('说明区引用了 RFC 9562',
     d.querySelector('.tool-notes').textContent.includes('RFC 9562'));
  ok('说明区解释了 Method 1 计数器',
     d.querySelector('.tool-notes').textContent.includes('Method 1'));
}
