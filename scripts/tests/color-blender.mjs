/* ==========================================================================
   颜色混合
   移植自 Praticulus 的 color-blender。重点验证移植时修掉的四处缺陷
   （非法输入无反馈、结果挂全局变量、HSL 无彩色绕路、插值提前取整），
   以及按 W3C 规范新增的 16 种混合模式。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/color-blender/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;
  const C = w.TOOLBOX.color;

  const cells = () => [...d.querySelectorAll('#cb-strip .color-cell')];
  const cellHex = (i) => cells()[i].getAttribute('data-hex');
  const modes = () => [...d.querySelectorAll('#cb-modes .choice-chip')];
  const rows = () => [...d.querySelectorAll('#cb-result-values .value-row')];
  const resultBg = () => d.getElementById('cb-result').style.background.replace(/\s/g, '');
  const activeMode = () => {
    const b = modes().find((x) => x.getAttribute('aria-pressed') === 'true');
    return b ? b.getAttribute('data-mode') : null;
  };

  const typeText = async (id, v, wait = 40) => {
    const el = d.getElementById(id);
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(wait);
  };
  const setRange = async (id, v) => {
    const el = d.getElementById(id);
    el.value = String(v);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(40);
  };
  const pickMode = async (id) => {
    const btn = modes().find((b) => b.getAttribute('data-mode') === id);
    btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(40);
  };
  const click = async (el) => {
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(40);
  };
  const setSpace = async (v) => {
    const el = d.getElementById('cb-space');
    el.value = v;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(40);
  };
  const reset = async () => {
    await typeText('cb-a-text', '#6c5ce7');
    await typeText('cb-b-text', '#00cec9');
  };

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('颜色引擎可用', !!C);
  ok('混合模式按钮 16 个', modes().length === 16, String(modes().length));
  ok('默认模式是正片叠底', activeMode() === 'multiply', String(activeMode()));
  ok('模式名徽章与选中模式一致',
     d.getElementById('cb-mode-name').textContent === '正片叠底',
     d.getElementById('cb-mode-name').textContent);
  ok('模式说明非空', d.getElementById('cb-mode-note').textContent.length > 0);
  ok('色阶默认 7 块', cells().length === 7, String(cells().length));
  ok('色阶计数文案与块数一致', d.getElementById('cb-strip-count').textContent === '7',
     d.getElementById('cb-strip-count').textContent);

  /* ---------- 2. 默认结果 ---------- */
  section('2. 默认结果');
  /* 正片叠底 #6c5ce7 × #00cec9 = #004ab6（逐通道相乘后取整） */
  ok('混合结果色块已着色', resultBg() === 'rgb(0,74,182)', resultBg());
  ok('色值列表 3 行', rows().length === 3, String(rows().length));
  ok('HEX 行正确', rows()[0].textContent.includes('#004ab6'), rows()[0].textContent);
  ok('RGB 行正确', rows()[1].textContent.includes('rgb(0, 74, 182)'), rows()[1].textContent);
  ok('HSL 行是 hsl() 写法', /hsl\(\d+, \d+%, \d+%\)/.test(rows()[2].textContent),
     rows()[2].textContent);
  ok('两色预览已着色',
     d.getElementById('cb-preview-a').style.background.replace(/\s/g, '') === 'rgb(108,92,231)' &&
     d.getElementById('cb-preview-b').style.background.replace(/\s/g, '') === 'rgb(0,206,201)');

  /* ---------- 3. 切换混合模式 ---------- */
  section('3. 切换混合模式');
  await pickMode('screen');
  ok('切到滤色后选中态跟着变', activeMode() === 'screen', String(activeMode()));
  ok('只有一个是选中态',
     modes().filter((b) => b.getAttribute('aria-pressed') === 'true').length === 1);
  ok('徽章文案跟着变', d.getElementById('cb-mode-name').textContent === '滤色',
     d.getElementById('cb-mode-name').textContent);

  const screenExpect = C.blendMode(C.hexToRgb('#6c5ce7'), C.hexToRgb('#00cec9'), 'screen');
  ok('滤色结果与引擎一致',
     resultBg() === `rgb(${screenExpect.r},${screenExpect.g},${screenExpect.b})`,
     `${resultBg()} vs rgb(${screenExpect.r},${screenExpect.g},${screenExpect.b})`);
  ok('滤色比正片叠底亮',
     screenExpect.g > 74 && screenExpect.b > 182,
     JSON.stringify(screenExpect));

  await pickMode('difference');
  ok('切到差值，同色相减的结果存在',
     d.getElementById('cb-result').style.background.length > 0);

  await pickMode('multiply');
  ok('切回正片叠底恢复原值', resultBg() === 'rgb(0,74,182)', resultBg());

  /* ---------- 4. 输入各种颜色格式 ---------- */
  section('4. 输入各种颜色格式');
  await typeText('cb-a-text', 'rgb(0,0,0)');
  ok('rgb() 输入生效，底色变黑后正片叠底得到黑',
     resultBg() === 'rgb(0,0,0)', resultBg());

  await typeText('cb-a-text', '#ffffff');
  ok('底色变白后正片叠底得到叠色本身',
     resultBg() === 'rgb(0,206,201)', resultBg());

  /* 输入过程中不覆盖用户写的原文，只在失焦时规范化 —— 这里断言结果色变了 */
  await typeText('cb-b-text', 'tomato');
  ok('颜色名输入生效（底色是白，正片叠底得到叠色本身）',
     resultBg() === 'rgb(255,99,71)', resultBg());
  ok('输入过程中文本框保留用户写的原文',
     d.getElementById('cb-b-text').value === 'tomato', d.getElementById('cb-b-text').value);

  await typeText('cb-b-text', 'hsl(0, 100%, 50%)');
  ok('hsl() 输入生效', resultBg() === 'rgb(255,0,0)', resultBg());

  await reset();

  /* ---------- 5. 回归：非法输入不静默失败 ---------- */
  section('5. 回归：非法输入');
  const beforeBg = resultBg();

  await typeText('cb-a-text', '#gggggg');
  ok('非法输入时输入框标红',
     d.getElementById('cb-a-text').classList.contains('input--invalid'),
     d.getElementById('cb-a-text').className);
  ok('非法输入不改变混合结果', resultBg() === beforeBg, `${resultBg()} vs ${beforeBg}`);
  ok('非法输入时保留用户输入的内容',
     d.getElementById('cb-a-text').value === '#gggggg', d.getElementById('cb-a-text').value);

  await typeText('cb-b-text', '不是颜色');
  ok('另一端的非法输入同样标红',
     d.getElementById('cb-b-text').classList.contains('input--invalid'));

  /* 失焦时回退到当前值 */
  d.getElementById('cb-a-text').dispatchEvent(new w.Event('blur', { bubbles: true }));
  d.getElementById('cb-b-text').dispatchEvent(new w.Event('blur', { bubbles: true }));
  await sleep(30);
  ok('失焦后底色回退为当前值',
     d.getElementById('cb-a-text').value === '#6c5ce7', d.getElementById('cb-a-text').value);
  ok('失焦后叠色回退为当前值',
     d.getElementById('cb-b-text').value === '#00cec9', d.getElementById('cb-b-text').value);
  ok('失焦后清除标红',
     !d.getElementById('cb-a-text').classList.contains('input--invalid') &&
     !d.getElementById('cb-b-text').classList.contains('input--invalid'));

  /* ---------- 6. 回归：结果不挂到 window 上 ---------- */
  section('6. 回归：不污染全局');
  ok('没有 window._blendColors 之类的全局变量',
     w._blendColors === undefined, String(w._blendColors));

  /* ---------- 7. 交换两色 ---------- */
  section('7. 交换两色');
  await pickMode('overlay');
  const overlayBefore = resultBg();

  await click(d.getElementById('cb-swap'));
  ok('交换后底色变成原来的叠色',
     d.getElementById('cb-a-text').value === '#00cec9', d.getElementById('cb-a-text').value);
  ok('交换后叠色变成原来的底色',
     d.getElementById('cb-b-text').value === '#6c5ce7', d.getElementById('cb-b-text').value);
  ok('交换后预览块也跟着换',
     d.getElementById('cb-preview-a').style.background.replace(/\s/g, '') === 'rgb(0,206,201)');

  /* 叠加不可交换，结果必须变 —— 这正是「底色 / 叠色分方向」的意义 */
  ok('叠加模式下交换两色结果不同', resultBg() !== overlayBefore,
     `${resultBg()} vs ${overlayBefore}`);

  await click(d.getElementById('cb-swap'));
  ok('可以再换回来', resultBg() === overlayBefore, `${resultBg()} vs ${overlayBefore}`);

  await pickMode('multiply');

  /* ---------- 8. 过渡色阶 ---------- */
  section('8. 过渡色阶');
  ok('第一块是底色', cellHex(0) === '#6c5ce7', cellHex(0));
  ok('最后一块是叠色', cellHex(6) === '#00cec9', cellHex(6));
  ok('中间那块是两色的正中间', cellHex(3) === '#3695d8', cellHex(3));
  ok('每块都有背景色', cells().every((c) => c.querySelector('.color-cell-color').style.background.length > 0));
  ok('每块都显示了 HEX 文本',
     cells().every((c) => /^#[0-9a-f]{6}$/.test(c.querySelector('.color-cell-code').textContent)));

  await setRange('cb-steps', 1);
  ok('中间点 1 时共 3 块', cells().length === 3, String(cells().length));
  ok('计数文案跟着变', d.getElementById('cb-strip-count').textContent === '3',
     d.getElementById('cb-strip-count').textContent);
  ok('滑块读数跟着变', d.getElementById('cb-steps-value').textContent === '1',
     d.getElementById('cb-steps-value').textContent);

  await setRange('cb-steps', 20);
  ok('中间点 20 时共 22 块', cells().length === 22, String(cells().length));

  await setRange('cb-steps', 5);
  ok('调回 5 时共 7 块', cells().length === 7, String(cells().length));

  /* 色阶首尾与两端一致，中间单调过渡 */
  const mid = C.hexToRgb(cellHex(3));
  const a = C.hexToRgb('#6c5ce7');
  const b = C.hexToRgb('#00cec9');
  ok('中间色的每个通道都落在两端之间',
     [['r'], ['g'], ['b']].every(([k]) =>
       mid[k] >= Math.min(a[k], b[k]) && mid[k] <= Math.max(a[k], b[k])),
     JSON.stringify(mid));

  /* ---------- 9. HSL 插值空间 ---------- */
  section('9. HSL 插值空间');
  await setSpace('hsl');
  ok('切到 HSL 后色阶重新计算，首尾不变',
     cellHex(0) === '#6c5ce7' && cellHex(6) === '#00cec9',
     `${cellHex(0)} / ${cellHex(6)}`);
  ok('HSL 与 RGB 的中间色不同（紫→青走色相）',
     cellHex(3) !== '#3695d8', cellHex(3));

  /* 回归：上游把无彩色（s = 0）的色相当 0 参与插值，
     灰 → 蓝的过渡会绕经品红。正确做法是让灰借用另一端的色相。 */
  await typeText('cb-a-text', '#808080');
  await typeText('cb-b-text', '#0000ff');
  await setRange('cb-steps', 5);

  const midHsl = C.rgbToHsl(...Object.values(C.hexToRgb(cellHex(3))));
  ok('灰 → 蓝的中间色仍是蓝色相（240°），没有绕经品红',
     Math.abs(midHsl.h - 240) <= 3, `h = ${midHsl.h}（上游会得到 300）`);
  ok('灰 → 蓝的中间色是蓝调（红绿分量接近、蓝分量最高），不是品红', (() => {
    const c = C.hexToRgb(cellHex(3));
    return Math.abs(c.r - c.g) <= 3 && c.b > c.r && c.b > c.g;
  })(), cellHex(3));

  await setSpace('rgb');
  await reset();
  await setRange('cb-steps', 5);

  /* ---------- 10. 复制 ---------- */
  section('10. 复制');
  copied = null;
  await click(rows()[0]);
  ok('点击 HEX 行复制 HEX', copied === '#004ab6', JSON.stringify(copied));
  ok('复制后该行有状态标记', rows()[0].getAttribute('data-copied') === 'true');

  copied = null;
  await click(rows()[1]);
  ok('点击 RGB 行复制 RGB', copied === 'rgb(0, 74, 182)', JSON.stringify(copied));

  copied = null;
  await click(cells()[3]);
  ok('点击色阶块复制该块的 HEX', copied === cellHex(3), JSON.stringify(copied));
  ok('复制不会破坏色块结构',
     cells()[3].querySelector('.color-cell-color') !== null &&
     cells()[3].querySelector('.color-cell-code') !== null);

  copied = null;
  await click(d.getElementById('cb-copy-all'));
  ok('复制全部得到逗号分隔的 7 个 HEX',
     copied === cells().map((c) => c.getAttribute('data-hex')).join(', '),
     JSON.stringify(copied));
  ok('复制全部后按钮显示已复制',
     d.getElementById('cb-copy-all').textContent === '已复制',
     d.getElementById('cb-copy-all').textContent);

  /* 显示与复制用的是同一套分隔规则（上游两处不一致） */
  ok('复制全部的文本与色阶块一一对应',
     copied.split(', ').length === cells().length, String(copied.split(', ').length));

  /* ---------- 11. 页面结构 ---------- */
  section('11. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为颜色分类的品红',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#d6409f',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('页面注明了来源与许可',
     d.querySelector('.tool-notes').textContent.includes('jamalofski/praticulus') &&
     d.querySelector('.tool-notes').textContent.includes('MIT'));
  ok('页面说明了混合模式取自 W3C 规范',
     d.querySelector('.tool-notes').textContent.includes('Compositing and Blending'));
  ok('页面说明了底色与叠色分方向',
     d.querySelector('.tool-notes').textContent.includes('叠加'));
}
