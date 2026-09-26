/* ==========================================================================
   二维码几何与渲染共用模块（js/qr-utils.js）
   --------------------------------------------------------------------------
   这个模块的价值在于「SVG 预览 / canvas 导出 / TOTP 的 otpauth 二维码
   三处用同一份几何」。所以套件的重点不是「画出来长什么样」，
   而是**两种渲染路径给出的模块位置必须逐格一致** ——
   留白宽度或定位图案判定只要有一处分叉，就会有一个渲染结果扫不出来。

   做法：手造一个可控的矩阵（不依赖 qrcode-generator），
   再从 SVG 的 <rect> 与 canvas 替身记录下来的 fillRect 里**各自反推**出
   暗模块坐标，两边比对。canvas 在 jsdom 里拿不到 2d 上下文，
   所以用一个记录调用的替身 —— 它反而比真 canvas 更好断言。
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ok, section, ROOT } from './_harness.mjs';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

function loadQr() {
  const w = {};
  new Function('window', fs.readFileSync(path.join(ROOT, 'js/qr-utils.js'), 'utf8'))(w);
  if (!w.TOOLBOX || !w.TOOLBOX.qr) throw new Error('qr-utils.js 没有导出 TOOLBOX.qr');
  return w.TOOLBOX.qr;
}

/** 用字符串矩阵造一个可控的二维码对象（'1' = 暗模块） */
function fakeQr(rows) {
  const n = rows.length;
  return {
    getModuleCount: () => n,
    isDark: (r, c) => rows[r][c] === '1'
  };
}

/** 记录调用的 2d 上下文替身 */
function stubCtx() {
  const calls = [];
  const ctx = {
    canvas: { width: 0, height: 0 },
    fillStyle: '',
    fillRect(x, y, w, h) { calls.push({ op: 'rect', x, y, w, h, fill: this.fillStyle }); },
    beginPath() { calls.push({ op: 'begin' }); },
    arc(x, y, r) { calls.push({ op: 'arc', x, y, r, fill: this.fillStyle }); },
    fill() { calls.push({ op: 'fill', fill: this.fillStyle }); },
    moveTo() {}, arcTo() {}, closePath() {},
    drawImage(img, x, y, w, h) { calls.push({ op: 'img', x, y, w, h }); }
  };
  return { ctx, calls };
}

const parseSvg = (svg) => {
  const dom = new JSDOM('<body>' + svg + '</body>');
  return dom.window.document.querySelector('svg');
};

/** 从 SVG 反推暗模块坐标（相对矩阵左上角，已扣掉留白） */
function svgModules(svg, quiet) {
  const node = parseSvg(svg);
  const out = [];
  [...node.querySelectorAll('rect')].forEach((r) => {
    if (r.getAttribute('width') === '100%') return;      /* 背景那一片 */
    if (r.getAttribute('width') !== '1') return;         /* Logo 的遮罩 */
    out.push([Number(r.getAttribute('y')) - quiet, Number(r.getAttribute('x')) - quiet]);
  });
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** 从 canvas 调用记录反推暗模块坐标 */
function canvasModules(calls, quiet, cell) {
  const out = [];
  calls.filter((c) => c.op === 'rect' && c.w === cell && c.h === cell).forEach((c) => {
    out.push([c.y / cell - quiet, c.x / cell - quiet]);
  });
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

const sameMatrix = (a, b) =>
  a.length === b.length && a.every((v, i) => v[0] === b[i][0] && v[1] === b[i][1]);

/** 造一个 n×n、指定位置为暗模块的矩阵 */
function matrix(n, dark) {
  const rows = [];
  for (let r = 0; r < n; r++) {
    let line = '';
    for (let c = 0; c < n; c++) line += dark.some(([dr, dc]) => dr === r && dc === c) ? '1' : '0';
    rows.push(line);
  }
  return rows;
}

export default async function run() {
  const Q = loadQr();

  ok('模块导出 TOOLBOX.qr', !!Q);
  ok('留白是 4（规范要求至少 4）', Q.QUIET === 4, String(Q.QUIET));

  /* ---------- 1. 定位图案判定 ---------- */
  section('1. isFinder（三个角，不是四个）');
  ok('左上角 (0,0) 是定位图案', Q.isFinder(0, 0, 21) === true);
  ok('左上角右下端 (6,6) 是', Q.isFinder(6, 6, 21) === true);
  ok('(0,6) 与 (6,0) 也在里面', Q.isFinder(0, 6, 21) && Q.isFinder(6, 0, 21));
  ok('(0,7) 已经出了格', Q.isFinder(0, 7, 21) === false);
  ok('右上角 (0,14)~ (0,20) 是', Q.isFinder(0, 14, 21) && Q.isFinder(0, 20, 21));
  ok('左下角 (14,0) 是', Q.isFinder(14, 0, 21) === true);
  ok('右下角 (14,14) **不是** —— 二维码只有三个定位图案',
    Q.isFinder(14, 14, 21) === false);
  ok('(13,0) 在左侧那块之外', Q.isFinder(13, 0, 21) === false);
  ok('尺寸不同时跟着走（n=25 的右上角从 18 开始，n=21 从 14 开始）',
    Q.isFinder(0, 16, 21) === true && Q.isFinder(0, 16, 25) === false);

  /* ---------- 2. 模块形状 ---------- */
  section('2. shapeOf（定位图案恒定方块）');
  ok('方块样式一律方块', Q.shapeOf('square', 10, 10, 21) === 'square');
  ok('圆点样式下数据区是 dot', Q.shapeOf('dots', 10, 10, 21) === 'dot');
  ok('圆角样式下数据区是 rounded', Q.shapeOf('rounded', 10, 10, 21) === 'rounded');
  ok('圆点样式下定位图案仍然是方块（否则有扫描器读不出来）',
    Q.shapeOf('dots', 0, 0, 21) === 'square' &&
    Q.shapeOf('dots', 0, 20, 21) === 'square' &&
    Q.shapeOf('dots', 20, 0, 21) === 'square');
  ok('圆角样式下定位图案也是方块', Q.shapeOf('rounded', 5, 5, 21) === 'square');
  ok('右下角在圆点样式下**不是**方块（它本来就不是定位图案）',
    Q.shapeOf('dots', 14, 14, 21) === 'dot');

  /* ---------- 3. toSvg 的字面输出 ---------- */
  section('3. toSvg 的字面输出');
  const small = fakeQr(['100', '001', '010']);
  const svg = Q.toSvg(small, {});
  ok('viewBox 加上两侧留白：3 + 4×2 = 11',
    parseSvg(svg).getAttribute('viewBox') === '0 0 11 11',
    parseSvg(svg).getAttribute('viewBox'));
  ok('默认尺寸 240', svg.includes('width="240" height="240"'));
  ok('方块样式用 crispEdges', svg.includes('shape-rendering="crispEdges"'));
  ok('带 role 与可读名称',
    parseSvg(svg).getAttribute('role') === 'img' &&
    parseSvg(svg).getAttribute('aria-label') === '二维码',
    parseSvg(svg).getAttribute('aria-label'));
  ok('背景是第一个元素，且铺满（width="100%"）',
    svg.indexOf('<rect width="100%"') > 0 &&
    svg.indexOf('<rect width="100%"') < svg.indexOf('<g fill='));
  /* 注意 svgModules() 减掉了留白，所以它给的是**矩阵坐标**（左上角是 [0,0]），
     不是 SVG 的绝对坐标 —— 这样它才能和 canvas 那条路径直接比。 */
  const firstRect = [...parseSvg(svg).querySelectorAll('rect')]
    .find((r) => r.getAttribute('width') === '1');
  ok('留白把第一个模块整推到 (4,4)（不是 (0,0)）',
    firstRect.getAttribute('x') === '4' && firstRect.getAttribute('y') === '4',
    firstRect.getAttribute('x') + ',' + firstRect.getAttribute('y'));
  ok('反推出来的模块坐标等于原矩阵（3 个暗模块）',
    JSON.stringify(svgModules(svg, 4)) === JSON.stringify([[0, 0], [1, 2], [2, 1]]),
    JSON.stringify(svgModules(svg, 4)));
  ok('dim 可以是字符串（配 viewBox 就是响应式的）',
    Q.toSvg(small, { dim: '100%' }).includes('width="100%"'));
  ok('dim 可以由小变大', Q.toSvg(small, { dim: 512 }).includes('width="512"'));

  /* ---------- 4. 样式与 Logo 分支 ---------- */
  section('4. toSvg 的样式与 Logo');
  const one = fakeQr(matrix(21, [[10, 10]]));
  const dots = Q.toSvg(one, { style: 'dots' });
  ok('圆点样式用 circle 画数据模块', parseSvg(dots).querySelectorAll('circle').length === 1,
    String(parseSvg(dots).querySelectorAll('circle').length));
  ok('圆点样式用 geometricPrecision', dots.includes('shape-rendering="geometricPrecision"'));
  ok('圆点的圆心在格子中心 (14.5,14.5)',
    parseSvg(dots).querySelector('circle').getAttribute('cx') === '14.5' &&
    parseSvg(dots).querySelector('circle').getAttribute('cy') === '14.5');
  const rounded = Q.toSvg(one, { style: 'rounded' });
  ok('圆角样式用带 rx/ry 的 rect',
    parseSvg(rounded).querySelector('rect[rx]') !== null &&
    parseSvg(rounded).querySelector('rect[rx]').getAttribute('rx') === '0.3');

  const LOGO = 'data:image/png;base64,AAAA';
  const withLogo = Q.toSvg(one, { logoDataUrl: LOGO });
  ok('带 Logo 时补上 xlink 命名空间', withLogo.includes('xmlns:xlink='));
  ok('Logo 用 image 元素，href 与 xlink:href 都写',
    withLogo.includes('<image href="' + LOGO + '"') &&
    withLogo.includes('xlink:href="' + LOGO + '"'));
  ok('Logo 后面垫了一块背景色遮罩（否则模块会从 Logo 后面透出来）',
    parseSvg(withLogo).querySelectorAll('rect[fill]').length >= 2);
  ok('不带 Logo 时不引入 xlink', !svg.includes('xmlns:xlink'));

  /* ---------- 5. toCanvas 的尺寸与格子 ---------- */
  section('5. toCanvas 的尺寸收敛');
  const qr21 = fakeQr(matrix(21, [[0, 0], [10, 10], [20, 20]]));
  let s = stubCtx();
  const dim1 = Q.toCanvas(qr21, s.ctx, { dim: 300 });
  ok('300 ÷ 29 向下取整成 10 一格，实际边长 290', dim1 === 290, String(dim1));
  ok('canvas 尺寸被写成 290×290',
    s.ctx.canvas.width === 290 && s.ctx.canvas.height === 290);
  ok('先把背景铺满', s.calls[0].op === 'rect' && s.calls[0].w === 290);

  s = stubCtx();
  ok('dim 正好是整数倍时不丢像素（29 × 10 = 290）',
    Q.toCanvas(qr21, s.ctx, { dim: 290 }) === 290);
  s = stubCtx();
  ok('dim 比模块数还小时至少留 1 像素一格（29 格 → 29 像素）',
    Q.toCanvas(qr21, s.ctx, { dim: 10 }) === 29);
  s = stubCtx();
  ok('没给 dim 时用 240：240 ÷ 29 → 8 一格，边长 232',
    Q.toCanvas(qr21, s.ctx, {}) === 232, String(Q.toCanvas(qr21, stubCtx().ctx, {})));

  /* ---------- 6. 两条渲染路径必须逐格一致 ---------- */
  section('6. SVG 与 canvas 的模块位置逐格一致（这个模块存在的理由）');
  const PAIRS = [
    ['21×21 稀疏', matrix(21, [[0, 0], [10, 10], [20, 20], [7, 8]])],
    ['21×21 全暗', matrix(21, (() => { const a = []; for (let r = 0; r < 21; r++) for (let c = 0; c < 21; c++) a.push([r, c]); return a; })())],
    ['25×25 含定位图案', matrix(25, [[0, 0], [6, 6], [0, 24], [24, 0], [12, 12], [24, 24]])],
    ['单个角落', matrix(21, [[20, 0]])]
  ];
  PAIRS.forEach(([name, rows]) => {
    const q = fakeQr(rows);
    const fromSvg = svgModules(Q.toSvg(q, {}), 4);
    const st = stubCtx();
    const cell = Math.floor(290 / (rows.length + 8));
    Q.toCanvas(q, st.ctx, { dim: 290 });
    const fromCanvas = canvasModules(st.calls, 4, cell);
    ok(name + '：两条路径给出同一组坐标（' + fromSvg.length + ' 个暗模块）',
      sameMatrix(fromSvg, fromCanvas),
      JSON.stringify(fromSvg.slice(0, 4)) + ' vs ' + JSON.stringify(fromCanvas.slice(0, 4)));
  });

  /* ---------- 7. canvas 的形状与 Logo ---------- */
  section('7. toCanvas 的形状与 Logo');
  s = stubCtx();
  Q.toCanvas(fakeQr(matrix(21, [[10, 10]])), s.ctx, { dim: 290, style: 'dots' });
  const arc = s.calls.find((c) => c.op === 'arc');
  ok('圆点样式用 arc，半径是半个格子', arc && arc.r === 5, arc && String(arc.r));
  ok('圆心在格子中心', arc && arc.x === 145 && arc.y === 145, arc && arc.x + ',' + arc.y);
  s = stubCtx();
  Q.toCanvas(fakeQr(matrix(21, [[10, 10]])), s.ctx, { dim: 290, style: 'rounded' });
  ok('圆角样式走 beginPath / fill，不直接 fillRect 数据模块',
    s.calls.some((c) => c.op === 'begin') && s.calls.some((c) => c.op === 'fill') &&
    !s.calls.some((c) => c.op === 'rect' && c.w === 10));

  s = stubCtx();
  Q.toCanvas(qr21, s.ctx, { dim: 290, logoImg: { tag: 'img' } });
  const img = s.calls.find((c) => c.op === 'img');
  ok('Logo 被画在正中，边长是 290 × 0.22 ≈ 64',
    img && img.w === 64 && img.h === 64 && img.x === 113 && img.y === 113,
    img && JSON.stringify([img.x, img.y, img.w, img.h]));
  ok('Logo 底下垫了一小块背景色', s.calls.some((c) => c.op === 'rect' && c.w === 80));

  /* ---------- 8. 与使用者的一致性 ---------- */
  section('8. 两个使用者都真的用上了这个模块');
  const qrGen = fs.readFileSync(path.join(ROOT, 'js/tools/qr-generator.js'), 'utf8');
  const totp = fs.readFileSync(path.join(ROOT, 'js/tools/totp-generator.js'), 'utf8');
  ok('qr-generator 调 T.qr.toSvg', /Q\.toSvg\(/.test(qrGen));
  ok('qr-generator 调 T.qr.toCanvas', /Q\.toCanvas\(/.test(qrGen));
  ok('qr-generator 里不再留一份自己的 isFinder / roundRectPath',
    !/function isFinder/.test(qrGen) && !/function roundRectPath/.test(qrGen));
  ok('TOTP 工具调 T.qr.toSvg', /Q\.toSvg\(/.test(totp));
  ok('qr-generator 页面引入了 qr-utils.js',
    fs.readFileSync(path.join(ROOT, 'tools/qr-generator/index.html'), 'utf8')
      .includes('js/qr-utils.js'));
  ok('TOTP 页面引入了 qr-utils.js',
    fs.readFileSync(path.join(ROOT, 'tools/totp-generator/index.html'), 'utf8')
      .includes('js/qr-utils.js'));
}
