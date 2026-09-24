/* ==========================================================================
   调色板生成
   移植自 Praticulus 的 palette-generator。重点验证移植时修掉的
   「主色在配色结果里偏色」与「空格键劫持页面滚动」，
   以及新增的明暗色阶与 JSON 导出。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/palette-generator/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;
  const C = w.TOOLBOX.color;

  const chips = () => [...d.querySelectorAll('#pg-palette .palette-chip')];
  const chipHex = (i) => chips()[i].getAttribute('data-hex');
  const chipHsl = (i) => C.rgbToHsl(...Object.values(C.hexToRgb(chipHex(i))));
  const shades = () => [...d.querySelectorAll('#pg-shades .color-cell')];
  const shadeHex = (i) => shades()[i].getAttribute('data-hex');
  const shadeHsl = (i) => C.rgbToHsl(...Object.values(C.hexToRgb(shadeHex(i))));
  const harmonies = () => [...d.querySelectorAll('#pg-harmonies .choice-chip')];
  const activeHarmony = () => {
    const b = harmonies().find((x) => x.getAttribute('aria-pressed') === 'true');
    return b ? b.getAttribute('data-harmony') : null;
  };
  const baseHex = () => d.getElementById('pg-text').value;
  const hslOf = (hex) => C.rgbToHsl(...Object.values(C.hexToRgb(hex)));

  const typeText = async (v, wait = 40) => {
    const el = d.getElementById('pg-text');
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(wait);
  };
  const pick = async (id) => {
    harmonies().find((b) => b.getAttribute('data-harmony') === id)
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(40);
  };
  const click = async (el, wait = 40) => {
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const reset = () => typeText('#6c5ce7');
  const exportBtn = (f) => d.querySelector(`[data-export="${f}"]`);

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('颜色引擎可用', !!C);
  ok('配色方案按钮 6 个', harmonies().length === 6, String(harmonies().length));
  ok('默认方案是三角', activeHarmony() === 'triadic', String(activeHarmony()));
  ok('三角方案出 3 个色', chips().length === 3, String(chips().length));
  ok('方案说明非空', d.getElementById('pg-harmony-note').textContent.length > 0);
  ok('色阶 11 块', shades().length === 11, String(shades().length));

  /* ---------- 2. 主色在配色里 ---------- */
  section('2. 主色');
  /* 回归：上游把「偏移 0」那一项也交给 hslToRgb 重算，h/s/l 是取整后的整数，
     往返有 ±1 误差，于是主色在结果里偏了一档（#6c5ce7 → #6b5be6）。 */
  ok('主色原样出现在配色结果里', chipHex(0) === '#6c5ce7', chipHex(0));

  /* ---------- 3. 色相关系 ---------- */
  section('3. 色相关系');
  const tri = chips().map((c) => hslOf(c.getAttribute('data-hex')).h);
  ok('三角方案的三个色相各差 120°',
     Math.abs(tri[0] - 247) <= 2 &&
     Math.abs(((tri[1] - tri[0]) + 360) % 360 - 120) <= 2 &&
     Math.abs(((tri[2] - tri[0]) + 360) % 360 - 240) <= 2,
     JSON.stringify(tri));

  ok('除单色外，各色的明度与主色一致（只改色相）',
     chips().every((c) => Math.abs(hslOf(c.getAttribute('data-hex')).l - 63) <= 1),
     JSON.stringify(chips().map((c) => hslOf(c.getAttribute('data-hex')).l)));

  /* ---------- 4. 切换方案 ---------- */
  section('4. 切换方案');
  for (const [id, n] of Object.entries({
    complementary: 2, analogous: 3, triadic: 3, split: 3, tetradic: 4, monochromatic: 5
  })) {
    await pick(id);
    ok(`「${id}」方案出 ${n} 个色`, chips().length === n, String(chips().length));
  }
  ok('只有一个是选中态',
     harmonies().filter((b) => b.getAttribute('aria-pressed') === 'true').length === 1);
  ok('切换方案后说明跟着换',
     d.getElementById('pg-harmony-note').textContent.includes('色相'),
     d.getElementById('pg-harmony-note').textContent);

  /* ---------- 5. 单色方案 ---------- */
  section('5. 单色方案');
  await pick('monochromatic');
  const monoL = chips().map((c) => hslOf(c.getAttribute('data-hex')).l);
  ok('明度固定取 20/35/50/65/80',
     JSON.stringify(monoL) === JSON.stringify([20, 35, 50, 65, 80]), JSON.stringify(monoL));
  ok('保持主色的色相',
     chips().every((c) => Math.abs(hslOf(c.getAttribute('data-hex')).h - 247) <= 2),
     JSON.stringify(chips().map((c) => hslOf(c.getAttribute('data-hex')).h)));
  ok('方案说明里写明了主色明度不参与',
     d.getElementById('pg-harmony-note').textContent.includes('未必有它'),
     d.getElementById('pg-harmony-note').textContent);

  await pick('triadic');
  ok('切回三角方案恢复原状', chips().length === 3 && chipHex(0) === '#6c5ce7', chipHex(0));

  /* ---------- 6. 输入各种颜色格式 ---------- */
  section('6. 输入各种颜色格式');
  await typeText('#ff0000');
  ok('hex 输入生效', chipHex(0) === '#ff0000', chipHex(0));
  ok('配色跟着换色相',
     Math.abs(hslOf(chipHex(1)).h - 120) <= 2, String(hslOf(chipHex(1)).h));

  await typeText('rgb(0,0,255)');
  ok('rgb() 输入生效', chipHex(0) === '#0000ff', chipHex(0));

  await typeText('hsl(120, 100%, 50%)');
  ok('hsl() 输入生效', chipHex(0) === '#00ff00', chipHex(0));

  await typeText('tomato');
  ok('颜色名输入生效（结果色变了）', chipHex(0) === '#ff6347', chipHex(0));
  ok('输入过程中文本框保留用户写的原文', baseHex() === 'tomato', baseHex());

  /* ---------- 7. 回归：非法输入 ---------- */
  section('7. 回归：非法输入');
  await reset();
  const beforeChips = chips().map((c) => c.getAttribute('data-hex')).join(',');

  await typeText('#gggggg');
  ok('非法输入时输入框标红',
     d.getElementById('pg-text').classList.contains('input--invalid'),
     d.getElementById('pg-text').className);
  ok('非法输入不改变配色',
     chips().map((c) => c.getAttribute('data-hex')).join(',') === beforeChips);
  ok('非法输入时保留用户输入的内容', baseHex() === '#gggggg', baseHex());

  await typeText('不是颜色');
  ok('中文非法输入也标红', d.getElementById('pg-text').classList.contains('input--invalid'));

  d.getElementById('pg-text').dispatchEvent(new w.Event('blur', { bubbles: true }));
  await sleep(30);
  ok('失焦后回退为当前主色', baseHex() === '#6c5ce7', baseHex());
  ok('失焦后清除标红', !d.getElementById('pg-text').classList.contains('input--invalid'));

  /* ---------- 8. 明暗色阶 ---------- */
  section('8. 明暗色阶');
  const shadeL = shades().map((c) => hslOf(c.getAttribute('data-hex')).l);
  ok('色阶从浅到深单调递减',
     shadeL.every((l, i) => i === 0 || l < shadeL[i - 1]), JSON.stringify(shadeL));
  ok('第一块明度接近 95', Math.abs(shadeL[0] - 95) <= 2, String(shadeL[0]));
  ok('最后一块明度接近 12', Math.abs(shadeL[10] - 12) <= 2, String(shadeL[10]));
  ok('色阶保持主色的色相',
     shades().every((c) => Math.abs(hslOf(c.getAttribute('data-hex')).h - 247) <= 3),
     JSON.stringify(shades().map((c) => hslOf(c.getAttribute('data-hex')).h)));
  ok('两端的饱和度收窄（浅色不发荧光、深色不发焦）',
     shadeHsl(0).s < shadeHsl(5).s && shadeHsl(10).s < shadeHsl(5).s,
     `l95:${shadeHsl(0).s} l52:${shadeHsl(5).s} l12:${shadeHsl(10).s}`);

  /* 换主色后色阶跟着换 */
  await typeText('#00cec9');
  const newHue = hslOf('#00cec9').h;
  ok('换主色后色阶跟着换',
     Math.abs(hslOf(shadeHex(5)).h - newHue) <= 3,
     `色阶 ${hslOf(shadeHex(5)).h} vs 主色 ${newHue}`);
  await reset();

  /* ---------- 9. 复制与导出 ---------- */
  section('9. 复制与导出');
  copied = null;
  await click(chips()[1]);
  ok('点色块复制该色', copied === chipHex(1), JSON.stringify(copied));

  copied = null;
  await click(d.getElementById('pg-copy-palette'));
  ok('复制全部得到逗号分隔的 HEX',
     copied === chips().map((c) => c.getAttribute('data-hex')).join(', '), JSON.stringify(copied));

  copied = null;
  await click(shades()[3]);
  ok('点色阶块复制该色', copied === shadeHex(3), JSON.stringify(copied));

  copied = null;
  await click(d.getElementById('pg-copy-shades'));
  ok('复制全部色阶得到 11 个色值', copied.split(', ').length === 11, String(copied.split(', ').length));

  copied = null;
  await click(exportBtn('css'));
  ok('CSS 导出含 :root 与全部变量',
     copied.includes(':root {') &&
     chips().every((c, i) => copied.includes('--color-' + (i + 1) + ': ' + c.getAttribute('data-hex') + ';')),
     JSON.stringify(copied));

  copied = null;
  await click(exportBtn('scss'));
  ok('SCSS 导出是变量声明',
     copied.split('\n').length === chips().length &&
     copied.startsWith('$color-1: '), JSON.stringify(copied));

  copied = null;
  await click(exportBtn('tailwind'));
  ok('Tailwind 导出是 colors 片段',
     copied.includes('colors: {') && copied.includes("'color-1': '"), JSON.stringify(copied));

  copied = null;
  await click(exportBtn('json'));
  ok('JSON 导出可解析且与配色一致',
     JSON.stringify(JSON.parse(copied)) ===
     JSON.stringify(chips().map((c) => c.getAttribute('data-hex'))),
     JSON.stringify(copied));

  ok('导出按钮点了有反馈（上游复制后毫无提示）',
     exportBtn('json').textContent === '已复制', exportBtn('json').textContent);

  /* ---------- 10. 随机 ---------- */
  section('10. 随机');
  await reset();
  const beforeRandom = baseHex();

  await click(d.getElementById('pg-random'));
  ok('点随机后主色变了', baseHex() !== beforeRandom, `${beforeRandom} → ${baseHex()}`);

  const rh = hslOf(baseHex());
  ok('随机色是有彩色的（饱和度 ≥ 33）', rh.s >= 33, String(rh.s));
  ok('随机色的明度落在 29–71', rh.l >= 29 && rh.l <= 71, String(rh.l));

  let outOfRange = null;
  for (let i = 0; i < 40; i++) {
    await click(d.getElementById('pg-random'), 0);
    const h = hslOf(baseHex());
    if (h.s < 33 || h.s > 96 || h.l < 29 || h.l > 71) { outOfRange = baseHex() + ' ' + JSON.stringify(h); break; }
  }
  ok('连续 40 次随机都落在设定区间内', outOfRange === null, outOfRange);

  /* ---------- 11. 快捷键 ---------- */
  section('11. 快捷键');
  await reset();
  const beforeR = baseHex();
  d.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'r', bubbles: true }));
  await sleep(40);
  ok('按 R 随机', baseHex() !== beforeR, `${beforeR} → ${baseHex()}`);

  await reset();
  const beforeTyping = baseHex();
  const textEl = d.getElementById('pg-text');
  textEl.focus();
  textEl.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'r', bubbles: true }));
  await sleep(40);
  ok('焦点在输入框里时 R 不触发', baseHex() === beforeTyping, `${beforeTyping} → ${baseHex()}`);

  /* 回归：上游把空格绑成随机并 preventDefault，键盘用户按空格滚动页面时
     页面不动、颜色却被换掉。 */
  await reset();
  const beforeSpace = baseHex();
  const spaceEv = new w.KeyboardEvent('keydown', {
    key: ' ', code: 'Space', bubbles: true, cancelable: true
  });
  d.body.dispatchEvent(spaceEv);
  await sleep(40);
  ok('空格键不再换色（上游会）', baseHex() === beforeSpace, `${beforeSpace} → ${baseHex()}`);
  ok('空格键不再被 preventDefault（页面能正常滚动）',
     spaceEv.defaultPrevented === false, String(spaceEv.defaultPrevented));

  /* ---------- 12. 页面结构 ---------- */
  section('12. 页面结构');
  await reset();
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为颜色分类的品红',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#d6409f',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('页面注明了来源与许可',
     d.querySelector('.tool-notes').textContent.includes('jamalofski/praticulus') &&
     d.querySelector('.tool-notes').textContent.includes('MIT'));
  ok('页面说明了空格键被换掉的原因',
     d.querySelector('.tool-notes').textContent.includes('劫持页面滚动'));
  ok('页面区分了单色方案与明暗色阶',
     d.querySelector('.tool-notes').textContent.includes('设计令牌') &&
     d.querySelector('.tool-notes').textContent.includes('单色方案'));
}
