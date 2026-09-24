/* ==========================================================================
   对比度检查
   移植自 Praticulus 的 contrast-checker。重点验证移植时修掉的
   「建议修复只朝一个方向调明度」这个会漏掉有解答案的缺陷，
   以及新增的目标级别、撤销与批量检查。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  const ctx = await loadPage('tools/contrast-checker/index.html');
  const { d, w } = ctx;
  const C = w.TOOLBOX.color;

  const badges = () =>
    [...d.querySelectorAll('#cc-badges .badge')].map((b) => b.textContent);
  const rows = () => [...d.querySelectorAll('#cc-batch-result .batch-row')];
  const rowText = (i) => rows()[i].textContent;
  const ratioText = () => d.getElementById('cc-ratio').textContent;
  const fgHex = () => d.getElementById('cc-fg-text').value;
  const previewStyle = () => ({
    color: d.getElementById('cc-preview').style.color.replace(/\s/g, ''),
    bg: d.getElementById('cc-preview').style.backgroundColor.replace(/\s/g, '')
  });

  const typeText = async (id, v, wait = 40) => {
    const el = d.getElementById(id);
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(wait);
  };
  const setColor = (side, v) => typeText(`cc-${side}-text`, v);
  const click = async (sel, wait = 50) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const setTarget = async (v) => {
    const el = d.getElementById('cc-target');
    el.value = String(v);
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(40);
  };
  const typeBatch = async (v) => {
    const el = d.getElementById('cc-batch-input');
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(170);   /* 批量检查有 90ms 防抖 */
  };
  const reset = async () => {
    await setColor('fg', '#e4e6ed');
    await setColor('bg', '#0f1117');
  };

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('颜色引擎可用', !!C);
  ok('WCAG 徽章 4 个', badges().length === 4, String(badges().length));
  ok('徽章覆盖四档标准',
     ['AA 正文', 'AA 大字', 'AAA 正文', 'AAA 大字'].every((t) =>
       badges().some((b) => b.includes(t))), JSON.stringify(badges()));
  ok('比值不是占位符', /^[\d.]+:1$/.test(ratioText()), ratioText());
  ok('预览区前景色已应用',
     previewStyle().color === 'rgb(228,230,237)', previewStyle().color);
  ok('预览区背景色已应用',
     previewStyle().bg === 'rgb(15,17,23)', previewStyle().bg);

  /* ---------- 2. 比值与引擎一致 ---------- */
  section('2. 比值');
  const expect = Math.round(C.contrastRatio(C.hexToRgb('#e4e6ed'), C.hexToRgb('#0f1117')) * 100) / 100;
  ok('显示值与公式一致', ratioText() === expect + ':1', `${ratioText()} vs ${expect}:1`);
  ok('浅字深底是高对比（13–17 之间）', expect > 13 && expect < 17, String(expect));
  ok('该配色四档全过', badges().every((b) => b.includes('✓')), JSON.stringify(badges()));
  ok('全过时提示已满足全部标准',
     d.getElementById('cc-gap').textContent.includes('全部满足'),
     d.getElementById('cc-gap').textContent);

  /* ---------- 3. 输入各种颜色格式 ---------- */
  section('3. 输入各种颜色格式');
  await setColor('fg', '#ffffff');
  ok('hex 输入生效', fgHex() === '#ffffff', fgHex());

  await setColor('bg', '#ffffff');
  await setColor('fg', 'rgb(0,0,0)');
  ok('rgb() 输入生效，黑字白底对比度 21:1',
     ratioText() === '21:1', ratioText());

  await setColor('bg', 'tomato');
  ok('颜色名输入生效（结果色变了）',
     d.getElementById('cc-bg-text').value === 'tomato', d.getElementById('cc-bg-text').value);
  ok('输入过程中不打断用户（文本框保留原文）',
     d.getElementById('cc-bg-text').value === 'tomato');

  await setColor('bg', 'hsl(0, 0%, 100%)');
  ok('hsl() 输入生效，背景变白后对比度回到 21:1',
     ratioText() === '21:1', ratioText());

  /* ---------- 4. 回归：非法输入 ---------- */
  section('4. 回归：非法输入');
  await reset();
  const beforeRatio = ratioText();

  await setColor('fg', '#gggggg');
  ok('非法输入时输入框标红',
     d.getElementById('cc-fg-text').classList.contains('input--invalid'));
  ok('非法输入不改变比值', ratioText() === beforeRatio, `${ratioText()} vs ${beforeRatio}`);
  ok('非法输入时保留用户输入的内容', fgHex() === '#gggggg', fgHex());

  await setColor('bg', '不是颜色');
  ok('另一端的非法输入同样标红',
     d.getElementById('cc-bg-text').classList.contains('input--invalid'));

  d.getElementById('cc-fg-text').dispatchEvent(new w.Event('blur', { bubbles: true }));
  d.getElementById('cc-bg-text').dispatchEvent(new w.Event('blur', { bubbles: true }));
  await sleep(30);
  ok('失焦后前景色回退', fgHex() === '#e4e6ed', fgHex());
  ok('失焦后背景色回退',
     d.getElementById('cc-bg-text').value === '#0f1117', d.getElementById('cc-bg-text').value);
  ok('失焦后清除标红',
     !d.getElementById('cc-fg-text').classList.contains('input--invalid') &&
     !d.getElementById('cc-bg-text').classList.contains('input--invalid'));

  /* ---------- 5. 交换两色 ---------- */
  section('5. 交换两色');
  await setColor('fg', '#ff0000');
  await setColor('bg', '#ffffff');
  const ratioBeforeSwap = ratioText();

  await click('#cc-swap');
  ok('交换后前景变成原来的背景',
     fgHex() === '#ffffff', fgHex());
  ok('交换后背景变成原来的前景',
     d.getElementById('cc-bg-text').value === '#ff0000', d.getElementById('cc-bg-text').value);
  ok('对比度是对称的，交换后比值不变',
     ratioText() === ratioBeforeSwap, `${ratioText()} vs ${ratioBeforeSwap}`);
  ok('预览区跟着换过来',
     previewStyle().color === 'rgb(255,255,255)' && previewStyle().bg === 'rgb(255,0,0)',
     JSON.stringify(previewStyle()));

  /* ---------- 6. 建议修复：核心回归 ---------- */
  section('6. 建议修复');

  /* 黄字配中灰底：比值约 3.68，不到 AA 正文的 4.5。
     上游只往亮调（背景亮度 0.216 ≤ 0.5），到白也只到 3.95，会报「无法修复」；
     正确解是往暗调 —— 这条断言就是冲着这个缺陷来的。 */
  await setColor('fg', '#ffff00');
  await setColor('bg', '#808080');
  const stuck = Math.round(C.contrastRatio(C.hexToRgb('#ffff00'), C.hexToRgb('#808080')) * 100) / 100;
  ok('黄字配中灰底确实不达标', stuck < 4.5, String(stuck));
  ok('不达标时提示距下一档还差多少',
     d.getElementById('cc-gap').textContent.includes('还差'),
     d.getElementById('cc-gap').textContent);

  await setTarget(4.5);
  await click('#cc-fix');
  const fixedHex = fgHex();
  const fixedRatio = C.contrastRatio(C.hexToRgb(fixedHex), C.hexToRgb('#808080'));
  ok('修复后前景色变了', fixedHex !== '#ffff00', fixedHex);
  ok('修复后达到 4.5:1', fixedRatio >= 4.5, fixedRatio.toFixed(2));
  ok('修复是往暗调（上游只会往亮调，因此永远找不到解）',
     C.luminance(...Object.values(C.hexToRgb(fixedHex))) < C.luminance(255, 255, 0),
     fixedHex);
  ok('修复后徽章显示 AA 正文通过',
     badges().some((b) => b.includes('AA 正文') && b.includes('✓')), JSON.stringify(badges()));
  ok('修复说明里给出了调整前后的色值',
     d.getElementById('cc-fix-note').textContent.includes('#ffff00') &&
     d.getElementById('cc-fix-note').textContent.includes(fixedHex),
     d.getElementById('cc-fix-note').textContent);
  ok('修复后出现撤销按钮', d.getElementById('cc-undo').hidden === false);

  await click('#cc-undo');
  ok('撤销后回到原来的颜色', fgHex() === '#ffff00', fgHex());
  ok('撤销后按钮重新隐藏', d.getElementById('cc-undo').hidden === true);

  /* 已达标时不再动手 */
  await setColor('fg', '#ffffff');
  await setColor('bg', '#000000');
  await click('#cc-fix');
  ok('已达标时提示无需调整',
     d.getElementById('cc-fix-note').textContent.includes('无需调整'),
     d.getElementById('cc-fix-note').textContent);
  ok('已达标时不会改动前景色', fgHex() === '#ffffff', fgHex());
  ok('已达标时不显示撤销按钮', d.getElementById('cc-undo').hidden === true);

  /* 无解时要说清原因：背景亮度决定了对比度上限 */
  await setColor('fg', '#808080');
  await setColor('bg', '#808080');
  await setTarget(7);
  await click('#cc-fix');
  const note = d.getElementById('cc-fix-note').textContent;
  ok('中灰底要 AAA 正文时报告无解', note.includes('上限'), note);
  ok('无解提示里给出具体上限（约 5.32:1）',
     note.includes('5.32'), note);
  ok('无解时不改动前景色', fgHex() === '#808080', fgHex());

  /* 目标级别可选：目标越低，明度改动越小。
     中灰配中灰，初始 1:1，两个目标都得真去调。 */
  const lightOf = () => C.rgbToHsl(...Object.values(C.hexToRgb(fgHex()))).l;

  await setColor('fg', '#808080');
  await setColor('bg', '#808080');
  await setTarget(3);
  await click('#cc-fix');
  const ratioLow = C.contrastRatio(C.hexToRgb(fgHex()), C.hexToRgb('#808080'));
  const deltaLow = Math.abs(lightOf() - 50);
  ok('目标 AA 大字 3:1 时能修到达标', ratioLow >= 3, ratioLow.toFixed(2));

  await setColor('fg', '#808080');
  await setTarget(4.5);
  await click('#cc-fix');
  const deltaHigh = Math.abs(lightOf() - 50);
  ok('目标越高，明度改动越大', deltaHigh > deltaLow,
     `3:1 → Δ${deltaLow}，4.5:1 → Δ${deltaHigh}`);

  /* ---------- 7. 批量检查 ---------- */
  section('7. 批量检查');
  await reset();
  await typeBatch('#ffffff\n#8b94a3\n#4b5563');

  ok('批量结果 3 行', rows().length === 3, String(rows().length));
  ok('第一行是白色，四档全过', rowText(0).includes('#ffffff') && rowText(0).includes('AAA 正文'),
     rowText(0));
  ok('第二行达到 AA 正文', rowText(1).includes('AA 正文'), rowText(1));
  ok('第三行不达标', rowText(2).includes('不达标'), rowText(2));
  ok('每行都给了比值', rows().every((r) => /[\d.]+:1/.test(r.textContent)));
  ok('每行都有色块', rows().every((r) => r.querySelector('.batch-swatch') !== null));
  ok('行序与输入顺序一致（每行只含自己的色值）',
     ['#ffffff', '#8b94a3', '#4b5563'].every((hex, i) =>
       rowText(i).includes(hex) &&
       ['#ffffff', '#8b94a3', '#4b5563'].filter((h) => h !== hex)
         .every((h) => !rowText(i).includes(h))),
     rows().map((r) => r.textContent).join(' | '));

  /* 行内比值与引擎一致 */
  const expectBatch = Math.round(
    C.contrastRatio(C.hexToRgb('#4b5563'), C.hexToRgb('#0f1117')) * 100) / 100;
  ok('批量比值与公式一致', rowText(2).includes(expectBatch + ':1'), rowText(2));

  /* 空行跳过、非法行标出 */
  await typeBatch('#ffffff\n\n不是颜色\n#8b94a3');
  ok('空行被跳过', rows().length === 3, String(rows().length));
  ok('非法行被标出且带行号',
     rows()[1].textContent.includes('不是颜色') && rows()[1].textContent.includes('第 3 行'),
     rowText(1));
  ok('非法行有专门的样式类',
     rows()[1].classList.contains('batch-row--bad'), rows()[1].className);

  /* 背景色一变，批量结果要跟着重算 */
  await setColor('bg', '#ffffff');
  const onWhite = Math.round(
    C.contrastRatio(C.hexToRgb('#ffffff'), C.hexToRgb('#ffffff')) * 100) / 100;
  ok('换背景后批量结果重算（白对白 = 1:1）',
     rowText(0).includes(onWhite + ':1') && rowText(0).includes('不达标'), rowText(0));

  await typeBatch('');
  ok('清空输入后显示空状态',
     d.querySelector('#cc-batch-result .table-empty') !== null);

  await click('#cc-batch-clear');
  ok('点清空会清掉输入框', d.getElementById('cc-batch-input').value === '');
  ok('清空后仍是空状态',
     d.querySelector('#cc-batch-result .table-empty') !== null);

  /* ---------- 8. 页面结构 ---------- */
  section('8. 页面结构');
  await reset();
  await typeBatch('#ffffff');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为颜色分类的品红',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#d6409f',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('页面注明了来源与许可',
     d.querySelector('.tool-notes').textContent.includes('jamalofski/praticulus') &&
     d.querySelector('.tool-notes').textContent.includes('MIT'));
  ok('页面说明了上游建议修复的方向缺陷',
     d.querySelector('.tool-notes').textContent.includes('#bcbcbc'));
  ok('预览区有三行不同字号',
     count(d, '#cc-preview .cc-line') === 3, String(count(d, '#cc-preview .cc-line')));
}
