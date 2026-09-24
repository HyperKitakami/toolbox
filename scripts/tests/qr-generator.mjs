/* ==========================================================================
   二维码生成
   移植自 Praticulus 的 qr-generator。重点验证九种内容类型拼出来的字符串
   是否与规范一致（把 SVG 反推成模块矩阵，再和内置库直接算的结果逐格比对），
   以及移植时修掉的 iCalendar / vCard 转义缺失。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  const WAIT = 250;   /* 工具里的防抖是 150ms，留余量 */
  const ctx = await loadPage('tools/qr-generator/index.html', { wait: WAIT });
  const { d, w } = ctx;
  const C = w.TOOLBOX.color;

  const svg = () => d.querySelector('#qr-preview svg');
  const status = () => d.getElementById('qr-status').textContent;
  const chips = () => [...d.querySelectorAll('#qr-modes .choice-chip')];
  const activeMode = () => {
    const b = chips().find((x) => x.getAttribute('aria-pressed') === 'true');
    return b ? b.getAttribute('data-mode') : null;
  };

  /**
   * 从页面上的 SVG 反推出模块矩阵。
   * 只适用于方块样式 —— 那时每个暗模块就是一个 1×1 的 rect。
   */
  function matrixFromSvg(node) {
    const total = Number(node.getAttribute('viewBox').split(/\s+/)[2]);
    const grid = Array.from({ length: total }, () => new Array(total).fill(0));

    [...node.querySelectorAll('rect')].forEach((r) => {
      if (r.getAttribute('width') === '100%') return;   /* 背景那一块 */
      grid[Number(r.getAttribute('y'))][Number(r.getAttribute('x'))] = 1;
    });

    return { total, grid };
  }

  /** 用内置库直接算一遍期望的矩阵，留白也按 4 个模块补上 */
  function matrixFromLib(text, level) {
    const q = w.qrcode(0, level);
    q.addData(text);
    q.make();

    const n = q.getModuleCount();
    const quiet = 4;
    const total = n + quiet * 2;
    const grid = Array.from({ length: total }, () => new Array(total).fill(0));

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (q.isDark(r, c)) grid[r + quiet][c + quiet] = 1;
      }
    }

    return { total, grid };
  }

  const sameMatrix = (a, b) =>
    a.total === b.total && a.grid.every((row, r) => row.every((v, c) => v === b.grid[r][c]));

  const diffCount = (a, b) => {
    if (a.total !== b.total) return '尺寸不同 ' + a.total + ' vs ' + b.total;
    let n = 0;
    a.grid.forEach((row, r) => row.forEach((v, c) => { if (v !== b.grid[r][c]) n++; }));
    return n + ' 格不同';
  };

  /** 断言页面上的二维码内容与期望字符串一致 */
  const okPayload = (name, expected, level) =>
    ok(name, sameMatrix(matrixFromSvg(svg()), matrixFromLib(expected, level || 'M')),
       diffCount(matrixFromSvg(svg()), matrixFromLib(expected, level || 'M')));

  const setField = async (id, value) => {
    const el = d.getElementById(id);
    el.value = value;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(WAIT);
  };
  const setSelect = async (id, value) => {
    const el = d.getElementById(id);
    el.value = value;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(WAIT);
  };
  const setCheck = async (id, on) => {
    const el = d.getElementById(id);
    el.checked = on;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(WAIT);
  };
  const pickMode = async (id) => {
    d.querySelector(`#qr-modes [data-mode="${id}"]`)
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(WAIT);
  };
  const click = async (el, wait = 40) => {
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('颜色引擎可用', !!C);
  ok('内置二维码库可用', typeof w.qrcode === 'function');
  ok('内容类型按钮 9 个', chips().length === 9, String(chips().length));
  ok('默认是文本类型', activeMode() === 'text', String(activeMode()));
  ok('只有一个是选中态',
     chips().filter((b) => b.getAttribute('aria-pressed') === 'true').length === 1);
  ok('预览已生成 SVG', svg() !== null);
  ok('SVG 带 role 与可读名称',
     svg().getAttribute('role') === 'img' && svg().getAttribute('aria-label') === '二维码');
  ok('状态栏给出模块数与字节数',
     /^\d+×\d+ 模块 · M（约 15%） · \d+ 字节 · 320px$/.test(status()), status());
  ok('默认内容是示例网址', d.getElementById('qr-text').value === 'https://example.com/');
  ok('无 canvas 时隐藏「复制图片」按钮',
     d.getElementById('qr-copy').hidden === true);
  okPayload('文本类型的编码内容正确', 'https://example.com/');

  /* ---------- 2. 中文与 UTF-8 ---------- */
  section('2. 中文与 UTF-8');
  await setField('qr-text', '你好，世界');
  ok('中文能正常生成', svg() !== null);
  /* 「你好，世界」在 UTF-8 下是 5 个字符 × 3 字节 = 15 字节 */
  ok('状态栏按 UTF-8 计算字节数', status().includes('15 字节'), status());
  okPayload('中文内容编码正确（库已切到 UTF-8 编码器）', '你好，世界');

  await setField('qr-text', '日本語テスト');
  ok('日文也能生成', svg() !== null);
  ok('日文按 UTF-8 算字节数（6 × 3 = 18）', status().includes('18 字节'), status());

  /* ---------- 3. WiFi ---------- */
  section('3. WiFi');
  await pickMode('wifi');
  ok('WiFi 面板已显示', d.getElementById('qr-panel-wifi').hidden === false);
  ok('文本面板已隐藏', d.getElementById('qr-panel-text').hidden === true);
  ok('没填 SSID 时不生成', svg() === null);

  await setField('qr-wifi-ssid', 'MyWiFi');
  await setField('qr-wifi-pass', '12345678');
  okPayload('WiFi 编码为 WIFI: 格式', 'WIFI:T:WPA;S:MyWiFi;P:12345678;;');

  await setCheck('qr-wifi-hidden', true);
  okPayload('勾选隐藏网络后加 H:true;', 'WIFI:T:WPA;S:MyWiFi;P:12345678;H:true;;');
  await setCheck('qr-wifi-hidden', false);

  await setSelect('qr-wifi-enc', 'nopass');
  okPayload('无密码时不输出 P: 字段', 'WIFI:T:nopass;S:MyWiFi;;');
  await setSelect('qr-wifi-enc', 'WPA');

  /* 回归：网络名里的分号、冒号、反斜杠必须转义，否则格式会串位 */
  await setField('qr-wifi-ssid', 'My;WiFi:5G');
  okPayload('SSID 里的分号与冒号被转义',
            'WIFI:T:WPA;S:My\\;WiFi\\:5G;P:12345678;;');
  await setField('qr-wifi-ssid', 'MyWiFi');

  /* ---------- 4. 名片 ---------- */
  section('4. 名片');
  await pickMode('vcard');
  ok('三个关键字段全空时不生成', svg() === null);

  await setField('qr-vc-name', '张三');
  await setField('qr-vc-phone', '13800138000');
  await setField('qr-vc-email', 'zhangsan@example.com');
  okPayload('vCard 结构正确',
            'BEGIN:VCARD\nVERSION:3.0\nN:张三\nFN:张三\n' +
            'TEL:13800138000\nEMAIL:zhangsan@example.com\nEND:VCARD');

  await setField('qr-vc-org', '示例公司');
  okPayload('填了组织就带上 ORG:',
            'BEGIN:VCARD\nVERSION:3.0\nN:张三\nFN:张三\n' +
            'TEL:13800138000\nEMAIL:zhangsan@example.com\nORG:示例公司\nEND:VCARD');

  /* 回归：上游不做转义，名字里带个分号 vCard 结构就坏了 */
  await setField('qr-vc-name', '张;三');
  okPayload('vCard 里的分号被转义',
            'BEGIN:VCARD\nVERSION:3.0\nN:张\\;三\nFN:张\\;三\n' +
            'TEL:13800138000\nEMAIL:zhangsan@example.com\nORG:示例公司\nEND:VCARD');
  await setField('qr-vc-name', '张三');

  /* ---------- 5. 邮件 / 短信 / 电话 ---------- */
  section('5. 邮件 / 短信 / 电话');
  await pickMode('email');
  await setField('qr-email-to', 'hi@example.com');
  okPayload('只有收件人时是纯 mailto:', 'mailto:hi@example.com');

  await setField('qr-email-subject', '你好');
  okPayload('主题做 URL 编码',
            'mailto:hi@example.com?subject=' + encodeURIComponent('你好'));

  await pickMode('sms');
  await setField('qr-sms-to', '13800138000');
  okPayload('只有号码时是 SMSTO:号码', 'SMSTO:13800138000');
  await setField('qr-sms-body', '你好');
  okPayload('带内容时用冒号分隔', 'SMSTO:13800138000:你好');

  await pickMode('phone');
  await setField('qr-phone-to', '13800138000');
  okPayload('电话是 tel: 协议', 'tel:13800138000');

  /* ---------- 6. WhatsApp / 位置 ---------- */
  section('6. WhatsApp / 位置');
  await pickMode('whatsapp');
  await setField('qr-wa-to', '+86 138 0013 8000');
  okPayload('号码里的加号与空格被剥掉', 'https://wa.me/8613800138000');

  await setField('qr-wa-body', '你好');
  okPayload('预填消息做 URL 编码',
            'https://wa.me/8613800138000?text=' + encodeURIComponent('你好'));

  await pickMode('geo');
  ok('只填一个坐标时不生成', svg() === null);
  await setField('qr-geo-lat', '39.9087');
  await setField('qr-geo-lng', '116.3975');
  okPayload('位置是 geo:纬度,经度', 'geo:39.9087,116.3975');

  /* ---------- 7. 日程 ---------- */
  section('7. 日程');
  await pickMode('event');
  await setField('qr-ev-title', '产品评审');
  okPayload('只有标题时是最简 iCalendar',
            'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:产品评审\n' +
            'END:VEVENT\nEND:VCALENDAR');

  await setField('qr-ev-start', '2026-09-24T12:00');
  okPayload('时间转成 iCalendar 的本地时间写法',
            'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:产品评审\n' +
            'DTSTART:20260924T120000\nEND:VEVENT\nEND:VCALENDAR');

  /* 回归：上游不做转义，标题里带逗号生成的 ICS 结构就坏了 */
  await setField('qr-ev-title', '产品评审, 第二轮');
  okPayload('标题里的逗号被转义',
            'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\n' +
            'SUMMARY:产品评审\\, 第二轮\nDTSTART:20260924T120000\n' +
            'END:VEVENT\nEND:VCALENDAR');
  await setField('qr-ev-title', '产品评审');

  /* ---------- 8. 纠错等级与样式 ---------- */
  section('8. 纠错等级与样式');
  await pickMode('text');
  await setField('qr-text', 'https://example.com/');   /* 前面几节把文本改掉了，先还原 */

  await setSelect('qr-ec', 'H');
  ok('纠错等级 H 生效', status().includes('H（约 30%）'), status());
  okPayload('等级 H 的编码结果与库一致', 'https://example.com/', 'H');

  await setSelect('qr-ec', 'L');
  okPayload('等级 L 的编码结果与库一致', 'https://example.com/', 'L');

  /* 等级越高，同样的内容需要的模块越多 */
  const countOf = () => Number(status().match(/^(\d+)×/)[1]);
  const lModules = countOf();
  await setSelect('qr-ec', 'H');
  ok('等级 H 的模块数不少于 L', countOf() >= lModules, `${countOf()} vs ${lModules}`);
  await setSelect('qr-ec', 'M');

  ok('方块样式的 shape-rendering 是 crispEdges',
     svg().getAttribute('shape-rendering') === 'crispEdges',
     svg().getAttribute('shape-rendering'));

  await setSelect('qr-style', 'dots');
  ok('圆点样式用 circle 画模块', svg().querySelectorAll('circle').length > 0);
  ok('圆点样式改用 geometricPrecision',
     svg().getAttribute('shape-rendering') === 'geometricPrecision',
     svg().getAttribute('shape-rendering'));
  /* 三个 7×7 的定位角各有 33 个暗模块，圆点样式下必须保持为方块 */
  ok('圆点样式下三个定位角仍是方块（99 个 rect + 背景）',
     svg().querySelectorAll('rect').length >= 100,
     String(svg().querySelectorAll('rect').length));

  await setSelect('qr-style', 'rounded');
  ok('圆角样式用带 rx 的 rect',
     [...svg().querySelectorAll('rect')].some((r) => r.getAttribute('rx') === '0.3'));
  ok('圆角样式下定位角仍是直角方块',
     [...svg().querySelectorAll('rect')].filter((r) => !r.getAttribute('rx')).length >= 100,
     String([...svg().querySelectorAll('rect')].filter((r) => !r.getAttribute('rx')).length));

  await setSelect('qr-style', 'square');
  okPayload('切回方块样式后编码不变', 'https://example.com/');

  /* ---------- 9. 尺寸 ---------- */
  section('9. 尺寸');
  await setField('qr-size', 480);
  ok('尺寸影响 SVG 的 width', svg().getAttribute('width') === '480', svg().getAttribute('width'));
  ok('尺寸读数同步', d.getElementById('qr-size-value').textContent === '480',
     d.getElementById('qr-size-value').textContent);
  ok('状态栏里的尺寸跟着变', status().includes('480px'), status());
  await setField('qr-size', 320);

  /* ---------- 10. 配色与警告 ---------- */
  section('10. 配色与警告');
  const setColor = async (id, v) => {
    const el = d.getElementById(id);
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(WAIT);
  };

  await setColor('qr-fg', '#1f2937');
  ok('自定义前景色进入 SVG',
     svg().querySelector('g').getAttribute('fill') === '#1f2937',
     svg().querySelector('g').getAttribute('fill'));
  ok('深色前景配白底不报警告', !status().includes('扫不出来'), status());

  /* 回归：上游自己写了一份相对亮度，阈值还是 WCAG 2.0 的旧值 */
  await setColor('qr-fg', '#ffffff');
  await setColor('qr-bg', '#dddddd');
  ok('前景比背景亮时提示反色', status().includes('反色'), status());

  await setColor('qr-fg', '#f0f0f0');
  await setColor('qr-bg', '#ffffff');
  ok('对比度不足时给出提示', status().includes('对比度只有'), status());
  ok('对比度用的是 color-utils 的算法', (() => {
    const m = status().match(/对比度只有 ([\d.]+):1/);
    if (!m) return false;
    const expected = Math.round(C.contrastRatio(C.hexToRgb('#f0f0f0'), C.hexToRgb('#ffffff')) * 100) / 100;
    return Number(m[1]) === expected;
  })(), status());

  await setColor('qr-fg', '#000000');
  await setColor('qr-bg', '#ffffff');
  ok('恢复正常配色后警告消失', !status().includes('扫不出来') && !status().includes('对比度'), status());

  /* 对调按钮 */
  await setColor('qr-fg', '#123456');
  await setColor('qr-bg', '#fedcba');
  await click(d.getElementById('qr-invert'));
  await sleep(WAIT);
  ok('对调后前景是原来的背景',
     d.getElementById('qr-fg').value === '#fedcba', d.getElementById('qr-fg').value);
  ok('对调后背景是原来的前景',
     d.getElementById('qr-bg').value === '#123456', d.getElementById('qr-bg').value);
  ok('对调后立刻提示反色', status().includes('反色'), status());

  await setColor('qr-fg', '#000000');
  await setColor('qr-bg', '#ffffff');

  /* ---------- 11. 空内容与超长内容 ---------- */
  section('11. 边界情况');
  await setField('qr-text', '');
  ok('空内容时不生成二维码', svg() === null);
  ok('空内容时显示空状态', d.querySelector('#qr-preview .qr-empty') !== null);
  ok('空内容时状态栏清空', status() === '', status());
  ok('空内容时导出按钮禁用',
     d.getElementById('qr-png').disabled === true && d.getElementById('qr-svg').disabled === true);

  await setField('qr-text', 'x'.repeat(3000));
  ok('超长内容不生成二维码', svg() === null);
  ok('超长内容时给出中文提示',
     d.querySelector('#qr-preview .qr-empty').textContent.includes('内容太长'),
     d.querySelector('#qr-preview .qr-empty').textContent);
  ok('超长内容时状态栏报错', status().includes('超出'), status());

  await setField('qr-text', 'https://example.com/');
  ok('恢复正常内容后重新生成', svg() !== null);
  ok('导出按钮重新启用',
     d.getElementById('qr-png').disabled === false && d.getElementById('qr-svg').disabled === false);

  /* ---------- 12. 导出 ---------- */
  section('12. 导出');
  /* jsdom 拿不到 2d 上下文 —— 正好用来验证降级提示 */
  await click(d.getElementById('qr-png'));
  await sleep(60);
  const toast = d.querySelector('.toast');
  ok('拿不到 canvas 时给出提示而不是崩溃',
     toast !== null && toast.textContent.includes('canvas'), toast ? toast.textContent : '无提示');

  ok('SVG 里有背景色块与模块组',
     svg().querySelector('rect[width="100%"]') !== null &&
     svg().querySelector('g[fill]') !== null);
  ok('SVG 没有多余命名空间（无 Logo 时）',
     !svg().hasAttribute('xmlns:xlink'), svg().getAttribute('xmlns:xlink'));

  /* ---------- 13. 页面结构 ---------- */
  section('13. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为生成器分类的琥珀',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#d97706',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('页面注明了上游来源与许可',
     d.querySelector('.tool-notes').textContent.includes('jamalofski/praticulus') &&
     d.querySelector('.tool-notes').textContent.includes('MIT'));
  ok('页面注明了内置库与它的许可',
     d.querySelector('.tool-notes').textContent.includes('qrcode-generator') &&
     d.querySelector('.tool-notes').textContent.includes('Kazuhiko Arase'));
  ok('页面说明了反色扫不出来的原因',
     d.querySelector('.tool-notes').textContent.includes('反色'));
  ok('页面说明了留白的作用',
     d.querySelector('.tool-notes').textContent.includes('留白'));
}
