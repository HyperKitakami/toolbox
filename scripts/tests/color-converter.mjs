/* ==========================================================================
   颜色格式转换
   移植自 Praticulus 的 color-converter。重点验证五种格式的输出、
   透明度处理，以及命名颜色表与浏览器的一致性。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/color-converter/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;
  const C = w.TOOLBOX.color;

  const $ = (sel) => d.querySelector(sel);
  const inputEl = () => d.getElementById('cc-input');
  const rows = () => [...d.querySelectorAll('#cc-values .value-row')];
  const rowText = (i) => (rows()[i] || {}).textContent || '';
  const rowValue = (i) => (rows()[i] || {}).getAttribute ? rows()[i].getAttribute('data-value') : '';
  const labelOf = (i) => rows()[i].querySelector('.value-label').textContent;

  const typeColor = async (v, wait = 40) => {
    const el = inputEl();
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(wait);
  };
  const click = async (sel, wait = 50) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const setAlpha = async (pct) => {
    const el = d.getElementById('cc-alpha-slider');
    el.value = String(pct);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(40);
  };

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('颜色引擎可用', !!C);
  ok('色值列表 5 行', rows().length === 5, String(rows().length));
  ok('五行分别是 HEX/RGB/HSL/CMYK/HWB',
     [0, 1, 2, 3, 4].map(labelOf).join(',') === 'HEX,RGB,HSL,CMYK,HWB',
     [0, 1, 2, 3, 4].map(labelOf).join(','));
  ok('HEX 正确', rowText(0).includes('#6c5ce7'), rowText(0));
  ok('RGB 正确', rowText(1).includes('rgb(108, 92, 231)'), rowText(1));
  ok('HSL 正确', rowText(2).includes('hsl(247, 74%, 63%)'), rowText(2));
  ok('CMYK 正确', rowText(3).includes('cmyk(53%, 60%, 0%, 9%)'), rowText(3));
  ok('HWB 正确', rowText(4).includes('hwb(247 36% 9%)'), rowText(4));
  ok('色块已着色',
     d.getElementById('cc-swatch').style.background.replace(/\s/g, '') === 'rgb(108,92,231)',
     d.getElementById('cc-swatch').style.background);
  ok('命名颜色块已渲染', $('#cc-css-name .css-name-swatch') !== null);

  /* ---------- 2. 输入各种格式 ---------- */
  section('2. 输入各种格式');
  await typeColor('#ff0000');
  ok('hex 输入', rowText(0).includes('#ff0000'), rowText(0));

  await typeColor('rgb(0,128,255)');
  ok('rgb() 输入', rowText(0).includes('#0080ff'), rowText(0));

  await typeColor('hsl(120, 100%, 50%)');
  ok('hsl() 输入', rowText(0).includes('#00ff00'), rowText(0));

  await typeColor('tomato');
  ok('颜色名输入', rowText(0).includes('#ff6347'), rowText(0));
  ok('颜色名输入后精确匹配到自己',
     $('#cc-css-name').textContent.includes('精确匹配'), $('#cc-css-name').textContent);

  await typeColor('hwb(247 36% 9%)');
  ok('hwb() 输入（浏览器兜底解析）', rowText(0).textContent !== '', rowText(0));
  const hwbBack = rowText(0).match(/#[0-9a-f]{6}/);
  ok('hwb() 解析结果接近原色',
     hwbBack && Math.abs(parseInt(hwbBack[0].slice(1, 3), 16) - 108) <= 2,
     rowText(0));

  await typeColor('#6c5ce780');
  ok('8 位 HEX 输入', rowText(0).includes('#6c5ce7'), rowText(0));

  /* ---------- 3. 回归：非法输入 ---------- */
  section('3. 回归：非法输入');
  await typeColor('#6c5ce7');
  const beforeBg = d.getElementById('cc-swatch').style.background;

  await typeColor('#zzzzzz');
  ok('非法输入时输入框标红', inputEl().classList.contains('input--invalid'), inputEl().className);
  ok('非法输入不改变当前颜色',
     d.getElementById('cc-swatch').style.background === beforeBg, '颜色被改动了');

  inputEl().dispatchEvent(new w.Event('blur', { bubbles: true }));
  await sleep(30);
  ok('失焦后回退为当前颜色', inputEl().value === '#6c5ce7', inputEl().value);
  ok('失焦后清除标红', !inputEl().classList.contains('input--invalid'));

  /* ---------- 4. 透明度 ---------- */
  section('4. 透明度');
  const toggle = d.getElementById('cc-alpha-toggle');
  const slider = d.getElementById('cc-alpha-slider');
  ok('默认未勾选', toggle.checked === false);
  ok('未勾选时滑杆禁用', slider.disabled === true);
  ok('未勾选时输出 6 位 HEX', rowText(0).includes('#6c5ce7') && !/#[0-9a-f]{8}/.test(rowText(0)),
     rowText(0));

  toggle.checked = true;
  toggle.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(40);
  ok('勾选后滑杆可用', slider.disabled === false);

  await setAlpha(50);
  ok('滑杆数值显示同步', d.getElementById('cc-alpha-value').textContent === '50%',
     d.getElementById('cc-alpha-value').textContent);
  ok('输出 8 位 HEX', rowValue(0) === '#6c5ce780', rowValue(0));
  ok('输出 rgba()', rowValue(1) === 'rgba(108, 92, 231, 0.5)', rowValue(1));
  ok('输出 hsla()', rowValue(2) === 'hsla(247, 74%, 63%, 0.5)', rowValue(2));
  ok('色块使用 rgba',
     d.getElementById('cc-swatch').style.background.replace(/\s/g, '') === 'rgba(108,92,231,0.5)',
     d.getElementById('cc-swatch').style.background);
  ok('CMYK 与 HWB 不受透明度影响',
     rowText(3).includes('cmyk(53%, 60%, 0%, 9%)') && rowText(4).includes('hwb(247 36% 9%)'),
     rowText(3) + ' / ' + rowText(4));
  /* jsdom 会把内联样式里的 #hex 规范化成 rgb()，所以按 rgb 断言 */
  ok('滑杆轨道随颜色变化',
     slider.style.background.includes('linear-gradient') &&
     slider.style.background.includes('rgb(108, 92, 231)'),
     slider.style.background);

  await setAlpha(0);
  ok('0% 时输出全透明', rowValue(0) === '#6c5ce700', rowValue(0));

  await setAlpha(100);
  ok('100% 时退回 6 位 HEX', rowValue(0) === '#6c5ce7', rowValue(0));

  await setAlpha(25);
  await typeColor('#ff0000');
  ok('换色后透明度保持', rowValue(0) === '#ff000040', rowValue(0));

  toggle.checked = false;
  toggle.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(40);
  ok('取消勾选后滑杆禁用', slider.disabled === true);
  ok('取消勾选后回到 6 位 HEX', rowValue(0) === '#ff0000', rowValue(0));

  await typeColor('#6c5ce7');

  /* ---------- 5. 命名颜色 ---------- */
  section('5. 命名颜色');
  await typeColor('#ff6347');
  ok('精确匹配显示「精确匹配」',
     $('#cc-css-name').textContent.includes('精确匹配') &&
     $('#cc-css-name').textContent.includes('tomato'),
     $('#cc-css-name').textContent);
  ok('精确匹配时距离为 0 不显示',
     !$('#cc-css-name').textContent.includes('距离'), $('#cc-css-name').textContent);

  await typeColor('#6c5ce7');
  ok('非精确匹配显示距离',
     $('#cc-css-name').textContent.includes('距离'), $('#cc-css-name').textContent);
  ok('命名色块有背景色',
     $('#cc-css-name .css-name-swatch').style.background.length > 0,
     $('#cc-css-name .css-name-swatch').style.background);

  /* ---------- 6. 复制 ---------- */
  section('6. 点击复制');
  for (const [i, expect] of [[0, '#6c5ce7'], [1, 'rgb(108, 92, 231)'], [2, 'hsl(247, 74%, 63%)'],
                             [3, 'cmyk(53%, 60%, 0%, 9%)'], [4, 'hwb(247 36% 9%)']]) {
    copied = null;
    rows()[i].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(40);
    ok(`第 ${i + 1} 行复制正确`, copied === expect, JSON.stringify(copied));
  }
  ok('复制不破坏行内结构', rows()[0].querySelector('.value-label') !== null);

  /* ---------- 7. 与公共模块一致 ---------- */
  section('7. 与 color-utils 一致');
  const rgb = C.hexToRgb('#6c5ce7');
  ok('HWB 与公共模块一致',
     rowValue(4) === 'hwb(' + C.rgbToHwb(rgb.r, rgb.g, rgb.b).h + ' ' +
       C.rgbToHwb(rgb.r, rgb.g, rgb.b).w + '% ' + C.rgbToHwb(rgb.r, rgb.g, rgb.b).b + '%)',
     rowValue(4));
  ok('命名颜色与公共模块一致',
     $('#cc-css-name').textContent.includes(C.closestName(rgb).name),
     $('#cc-css-name').textContent);

  /* ---------- 8. 页面结构 ---------- */
  section('8. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为颜色分类的品红',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#d6409f',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('页面注明了来源与许可',
     d.querySelector('.tool-notes').textContent.includes('jamalofski/praticulus') &&
     d.querySelector('.tool-notes').textContent.includes('MIT'));
}
