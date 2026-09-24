/* ==========================================================================
   CSV 查看器
   移植自 Praticulus 的 csv-viewer。重点验证移植时修掉的两个缺陷
   （BOM 未剥离、分隔符探测计入引号内字符），以及新增的编码探测与分页。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/csv-viewer/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;

  const $ = (sel) => d.querySelector(sel);
  const status = () => d.getElementById('csv-status').textContent.trim();
  const badge = () => d.getElementById('csv-badge').textContent;
  const range = () => d.getElementById('csv-range').textContent.trim();
  const stats = () => {
    const out = {};
    for (const s of d.querySelectorAll('#csv-stats .stat')) {
      out[s.querySelector('.stat-label').textContent] = s.querySelector('.stat-value').textContent;
    }
    return out;
  };
  const ths = () => [...d.querySelectorAll('#csv-thead th')].map((t) => t.textContent.replace(/[↑↓]/g, '').trim());
  const dataThs = () => [...d.querySelectorAll('#csv-thead th[data-col]')];
  const bodyRows = () => [...d.querySelectorAll('#csv-tbody tr')];
  /* 单元格索引：0 是行号列，1 起才是数据 */
  const rowCells = (i) => [...(bodyRows()[i] ? bodyRows()[i].querySelectorAll('td') : [])].map((t) => t.textContent);
  const col = (i, c) => bodyRows().map((r) => r.children[c].textContent).join(',');

  const setCsv = async (text) => {
    const el = d.getElementById('csv-input');
    el.value = text;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    d.getElementById('csv-parse').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(60);
  };
  const setHeader = async (on) => {
    const el = d.getElementById('csv-header');
    el.checked = on;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(60);
  };
  const setSel = async (id, value) => {
    const el = d.getElementById(id);
    el.value = value;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(60);
  };
  const click = async (sel, wait = 60) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const clickTh = async (i) => {
    dataThs()[i].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(60);
  };

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('预置示例已解析', bodyRows().length === 5, String(bodyRows().length));
  ok('表头 4 列', dataThs().length === 4, String(dataThs().length));
  ok('表头内容正确',
     ths().slice(1).join(',') === '姓名,城市,备注,入职年份', JSON.stringify(ths()));
  ok('引号内的逗号未被拆列', rowCells(0)[3] === '前端工程师, 负责中台', JSON.stringify(rowCells(0)));
  ok('统计面板 5 项', count(d, '#csv-stats .stat') === 5);
  ok('统计：数据行 5', stats()['数据行'] === '5', stats()['数据行']);
  ok('统计：列数 4', stats()['列数'] === '4', stats()['列数']);
  ok('统计：分隔符为逗号', stats()['分隔符'] === '逗号 ,', stats()['分隔符']);
  ok('徽章显示行×列', badge() === '5 × 4', badge());
  ok('状态栏提示解析结果', status().includes('5 行') && status().includes('4 列'), status());
  ok('表格可见、空状态隐藏',
     d.getElementById('csv-table').hidden === false && d.getElementById('csv-empty').hidden === true);
  ok('有行号列', rowCells(0)[0] === '1', JSON.stringify(rowCells(0)));

  /* ---------- 2. 解析（关掉表头，直接看原始行） ---------- */
  section('2. CSV 解析');
  await setHeader(false);

  await setCsv('a,b\n1,2');
  ok('基本两行两列',
     bodyRows().length === 2 && dataThs().length === 2 &&
     rowCells(0)[1] === 'a' && rowCells(1)[2] === '2',
     JSON.stringify([rowCells(0), rowCells(1)]));

  await setCsv('a,"b,c"\n1,2');
  ok('引号内的分隔符不当分隔',
     dataThs().length === 2 && rowCells(0)[2] === 'b,c', JSON.stringify(rowCells(0)));

  await setCsv('a,"say ""hi"""\n1,2');
  ok('双引号转义', rowCells(0)[2] === 'say "hi"', JSON.stringify(rowCells(0)[2]));

  await setCsv('a,"line1\nline2"\n1,2');
  ok('引号内的换行不当换行',
     bodyRows().length === 2 && rowCells(0)[2] === 'line1\nline2',
     JSON.stringify(rowCells(0)[2]));

  await setCsv('a,b\r\n1,2\r\n');
  ok('CRLF 与结尾换行', bodyRows().length === 2, String(bodyRows().length));

  await setCsv('a,,c\n1,2,3');
  ok('空字段保留', rowCells(0)[2] === '' && dataThs().length === 3, JSON.stringify(rowCells(0)));

  await setHeader(true);
  await setCsv('a,,c\n1,2,3');
  ok('空表头补成「列 N」', ths()[2] === '列 2', JSON.stringify(ths()));

  /* ---------- 3. 回归：BOM 剥离 ---------- */
  section('3. 回归：UTF-8 BOM');
  await setCsv('\uFEFFname,age\nAda,36');
  ok('首列列名不含 BOM 字符',
     ths()[1] === 'name' && ths()[1].charCodeAt(0) !== 0xFEFF,
     JSON.stringify(ths()[1]) + '，首字符码位 ' + ths()[1].charCodeAt(0).toString(16));
  ok('首行数据也不含 BOM', rowCells(0)[1] === 'Ada', JSON.stringify(rowCells(0)));

  copied = null;
  await click('#csv-copy-json');
  let parsed = JSON.parse(copied || '[]');
  ok('导出的 JSON 键名不含 BOM',
     parsed.length === 1 && Object.keys(parsed[0])[0] === 'name',
     JSON.stringify(Object.keys(parsed[0] || {})));

  /* ---------- 4. 回归：分隔符探测 ---------- */
  section('4. 回归：分隔符探测');
  await setCsv('"a;b;c"\n1');
  ok('引号内含分号的单列不会被误判成多列',
     dataThs().length === 1 && ths()[1] === 'a;b;c',
     `${dataThs().length} 列 / ${JSON.stringify(ths())}`);
  ok('状态栏说明探测结果', status().includes('逗号'), status());

  await setCsv('a;b;c\n1;2;3');
  ok('分号分隔可探测', dataThs().length === 3 && stats()['分隔符'] === '分号 ;',
     `${dataThs().length} 列 / ${stats()['分隔符']}`);

  await setCsv('a\tb\tc\n1\t2\t3');
  ok('制表符分隔可探测', dataThs().length === 3 && stats()['分隔符'] === '制表符',
     `${dataThs().length} 列 / ${stats()['分隔符']}`);

  await setCsv('a|b|c\n1|2|3');
  ok('竖线分隔可探测', dataThs().length === 3 && stats()['分隔符'] === '竖线 |',
     `${dataThs().length} 列 / ${stats()['分隔符']}`);

  await setCsv('a;b;c\n1;2;3');
  await setSel('csv-delim', ',');
  ok('手动指定逗号后变成单列', dataThs().length === 1, String(dataThs().length));
  await setSel('csv-delim', ';');
  ok('手动指定分号后恢复三列', dataThs().length === 3, String(dataThs().length));
  await setSel('csv-delim', 'auto');

  /* ---------- 5. 表头开关 ---------- */
  section('5. 表头开关');
  await setCsv('a,b\n1,2\n3,4');
  ok('默认首行是表头', dataThs().length === 2 && bodyRows().length === 2,
     `${dataThs().length} 列 / ${bodyRows().length} 行`);

  await setHeader(false);
  ok('关闭后首行变成数据', bodyRows().length === 3, String(bodyRows().length));
  ok('关闭后列名为「列 N」', ths().slice(1).join(',') === '列 1,列 2', JSON.stringify(ths()));
  ok('关闭后状态提示 3 行', status().includes('3 行'), status());

  await setHeader(true);
  ok('重新打开后恢复', bodyRows().length === 2 && ths()[1] === 'a', JSON.stringify(ths()));

  /* ---------- 6. 排序 ---------- */
  section('6. 排序');
  await setCsv('name,score\nb,10\na,2\nc,30');

  await clickTh(1);
  ok('数字列升序', col(0, 2) === '2,10,30', col(0, 2));
  ok('升序箭头标记', dataThs()[1].className.includes('sort-asc'), dataThs()[1].className);
  ok('aria-sort 为 ascending', dataThs()[1].getAttribute('aria-sort') === 'ascending');

  await clickTh(1);
  ok('再次点击变降序', col(0, 2) === '30,10,2', col(0, 2));
  ok('降序箭头标记', dataThs()[1].className.includes('sort-desc'), dataThs()[1].className);

  await clickTh(0);
  ok('文本列升序', col(0, 1) === 'a,b,c', col(0, 1));

  dataThs()[0].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(60);
  ok('键盘 Enter 也能排序', col(0, 1) === 'c,b,a', col(0, 1));

  ok('行号列是展示序号（排序后重新编号）', rowCells(0)[0] === '1', rowCells(0)[0]);

  await setCsv('v\n9\n10\n100\n2');
  await clickTh(0);
  ok('数值排序而非字典序', col(0, 1) === '2,9,10,100', col(0, 1));

  /* ---------- 7. 分页 ---------- */
  section('7. 分页');
  const bigCsv = 'id,val\n' + Array.from({ length: 1200 }, (_, i) => (i + 1) + ',x' + (i + 1)).join('\n');
  await setCsv(bigCsv);

  ok('默认每页 500 行', bodyRows().length === 500, String(bodyRows().length));
  ok('总行数 1200', stats()['数据行'] === '1,200', stats()['数据行']);
  ok('范围提示第 1–500 行', range().includes('第 1–500 行') && range().includes('1,200'), range());
  ok('首页时上一页禁用', d.getElementById('csv-prev').disabled === true);
  ok('首页时下一页可用', d.getElementById('csv-next').disabled === false);
  ok('行号从 1 开始', rowCells(0)[0] === '1', rowCells(0)[0]);

  await click('#csv-next');
  ok('第二页 500 行', bodyRows().length === 500, String(bodyRows().length));
  ok('第二页行号从 501 开始', rowCells(0)[0] === '501', rowCells(0)[0]);
  ok('范围提示第 501–1000 行', range().includes('第 501–1,000 行'), range());

  await click('#csv-next');
  ok('第三页 200 行', bodyRows().length === 200, String(bodyRows().length));
  ok('末页时下一页禁用', d.getElementById('csv-next').disabled === true);
  ok('末页行号从 1001 开始', rowCells(0)[0] === '1001', rowCells(0)[0]);

  await click('#csv-prev');
  ok('可返回上一页', rowCells(0)[0] === '501', rowCells(0)[0]);

  await setSel('csv-page-size', '100');
  ok('切换每页 100 行', bodyRows().length === 100, String(bodyRows().length));
  ok('切换每页后回到第一页', rowCells(0)[0] === '1', rowCells(0)[0]);

  await click('#csv-next');
  await clickTh(0);
  ok('排序后跳回第一页', rowCells(0)[0] === '1', rowCells(0)[0]);
  ok('排序作用于全部数据（第一页是 1–100）',
     col(0, 1) === Array.from({ length: 100 }, (_, i) => String(i + 1)).join(','),
     col(0, 1).slice(0, 40));

  await setSel('csv-page-size', '500');

  /* ---------- 8. 导出 ---------- */
  section('8. 导出');
  await setCsv('a,a,b\n1,2,3');
  copied = null;
  await click('#csv-copy-json');
  parsed = JSON.parse(copied || '[]');
  ok('JSON 是对象数组', Array.isArray(parsed) && parsed.length === 1, JSON.stringify(parsed));
  ok('重名表头自动加后缀',
     Object.keys(parsed[0]).join(',') === 'a,a_2,b', JSON.stringify(Object.keys(parsed[0])));
  ok('JSON 值正确', parsed[0].a === '1' && parsed[0].a_2 === '2' && parsed[0].b === '3',
     JSON.stringify(parsed[0]));

  await setCsv('a,b\n"x\ty",z');
  copied = null;
  await click('#csv-copy-tsv');
  const tsvLines = (copied || '').split('\n');
  ok('TSV 首行是表头', tsvLines[0] === 'a\tb', JSON.stringify(tsvLines[0]));
  ok('含制表符的单元格被引号包裹', tsvLines[1] === '"x\ty"\tz', JSON.stringify(tsvLines[1]));

  await setCsv('a,b\n"say ""hi""",z');
  copied = null;
  await click('#csv-copy-tsv');
  ok('含双引号的单元格被转义',
     (copied || '').split('\n')[1] === '"say ""hi"""\tz',
     JSON.stringify((copied || '').split('\n')[1]));

  /* ---------- 9. 空状态与按钮 ---------- */
  section('9. 空状态与按钮');
  await setCsv('');
  ok('空输入显示空状态', d.getElementById('csv-empty').hidden === false);
  ok('空输入时表格隐藏', d.getElementById('csv-table').hidden === true);
  ok('空输入时状态提示', status().includes('还没有输入'), status());
  ok('空输入时统计归零', stats()['数据行'] === '0' && stats()['列数'] === '0', JSON.stringify(stats()));
  ok('空输入时徽章重置', badge() === '—', badge());

  await setCsv('   ');
  ok('只有空白也视为空', d.getElementById('csv-empty').hidden === false);

  await click('[data-clear]');
  ok('清空后输入框为空', d.getElementById('csv-input').value === '');
  ok('清空后状态行清空', status() === '', JSON.stringify(status()));

  await click('[data-demo]');
  ok('载入示例恢复 5 行', bodyRows().length === 5, String(bodyRows().length));
  ok('载入示例恢复 4 列', dataThs().length === 4, String(dataThs().length));

  /* ---------- 10. 文件读取与编码 ---------- */
  section('10. 文件读取与编码探测');
  const fileEl = d.getElementById('csv-file');

  const loadBytes = async (bytes, name) => {
    const file = new w.File([new Uint8Array(bytes)], name, { type: 'text/csv' });
    Object.defineProperty(fileEl, 'files', { value: [file], configurable: true });
    fileEl.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(150);
  };

  /* 「姓名,城市\n张三,北京」的 GBK 字节 */
  const GBK_BYTES = [0xD0, 0xD5, 0xC3, 0xFB, 0x2C, 0xB3, 0xC7, 0xCA, 0xD0, 0x0A,
                     0xD5, 0xC5, 0xC8, 0xFD, 0x2C, 0xB1, 0xB1, 0xBE, 0xA9];
  await loadBytes(GBK_BYTES, 'gbk.csv');
  ok('GBK 文件被自动解码', ths()[1] === '姓名' && ths()[2] === '城市', JSON.stringify(ths()));
  ok('GBK 数据行正确', rowCells(0)[1] === '张三' && rowCells(0)[2] === '北京', JSON.stringify(rowCells(0)));

  const utf8Bom = [0xEF, 0xBB, 0xBF, ...Array.from(Buffer.from('name,age\nAda,36', 'utf8'))];
  await loadBytes(utf8Bom, 'bom.csv');
  ok('带 BOM 的 UTF-8 文件正确解码',
     ths()[1] === 'name' && rowCells(0)[1] === 'Ada', JSON.stringify(ths()));

  await setSel('csv-encoding', 'gbk');
  await loadBytes(utf8Bom, 'bom.csv');
  ok('强制 GBK 解码 UTF-8 文件会乱码（说明该选项确实生效）',
     ths()[1] !== 'name', JSON.stringify(ths()[1]));
  await setSel('csv-encoding', 'auto');

  await loadBytes(Array.from(Buffer.from('x,y\n1,2', 'utf8')), 'plain.csv');
  ok('纯 UTF-8 文件正确解码', ths()[1] === 'x' && rowCells(0)[1] === '1', JSON.stringify(ths()));

  /* ---------- 11. 页面结构 ---------- */
  section('11. 页面结构');
  ok('拖放区存在且可聚焦', $('#csv-drop') !== null && $('#csv-drop').getAttribute('tabindex') === '0');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('页面注明了来源与许可',
     d.querySelector('.tool-notes').textContent.includes('jamalofski/praticulus') &&
     d.querySelector('.tool-notes').textContent.includes('MIT'));
}
