/* ==========================================================================
   文本大小写转换（text-case）测试
   --------------------------------------------------------------------------
   用真实 DOM 交互驱动：设 textarea.value + dispatch input + 等防抖。
   期望值一律手算，尤其是那几条针对上游缺陷的回归断言 ——
   它们对应的错误结果写在注释里，方便对照「修的是哪个分支」。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const { d, w, errors } = await loadPage('tools/text-case/index.html', {
    clipboard: (t) => { copied = t; }
  });

  const $ = (sel) => d.querySelector(sel);
  const input = d.getElementById('tc-input');

  const rowsOf = (sel) => [...d.querySelectorAll(sel + ' .value-row')];
  const naming = () => rowsOf('#tc-naming')
    .map((r) => r.querySelector('.value-text').textContent);
  const block = () => rowsOf('#tc-block')
    .map((r) => r.querySelector('.value-text').textContent);
  /** 按标签取某一行的值（标签是 camelCase / 全部大写 这类） */
  const get = (sel, label) => {
    const row = rowsOf(sel).find((r) => r.querySelector('.value-label').textContent === label);
    return row ? row.querySelector('.value-text').textContent : null;
  };
  const namingOf = (label) => get('#tc-naming', label);
  const blockOf = (label) => get('#tc-block', label);

  const setText = async (text) => {
    input.value = text;
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(170);
  };
  const click = async (sel) => {
    $(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(30);
  };

  /* ---------- 1. 基本渲染 ---------- */
  section('1. 基本渲染');

  ok('无脚本错误', errors.length === 0, errors.join(' | '));
  ok('空输入时命名风格区显示空态', $('#tc-naming .match-empty') !== null);
  ok('空输入时整段大小写区显示空态', $('#tc-block .match-empty') !== null);

  await setText('hello world');
  ok('命名风格有 5 行', naming().length === 5, String(naming().length));
  ok('整段大小写有 5 行', block().length === 5, String(block().length));
  ok('命名风格的标签顺序正确',
     naming().length === 5 &&
     rowsOf('#tc-naming').map((r) => r.querySelector('.value-label').textContent).join(',') ===
       'camelCase,PascalCase,snake_case,kebab-case,CONSTANT_CASE',
     rowsOf('#tc-naming').map((r) => r.querySelector('.value-label').textContent).join(','));
  ok('整段大小写的标签顺序正确',
     rowsOf('#tc-block').map((r) => r.querySelector('.value-label').textContent).join(',') ===
       '全部大写,全部小写,词首大写,句首大写,交替大小写');
  ok('结果行可整行点击复制',
     rowsOf('#tc-naming').every((r) => r.tagName === 'BUTTON' && r.hasAttribute('data-copy-target')));

  /* ---------- 2. 基础风格转换 ---------- */
  section('2. 基础风格转换');

  await setText('hello world example');
  ok('camelCase', namingOf('camelCase') === 'helloWorldExample', namingOf('camelCase'));
  ok('PascalCase', namingOf('PascalCase') === 'HelloWorldExample', namingOf('PascalCase'));
  ok('snake_case', namingOf('snake_case') === 'hello_world_example', namingOf('snake_case'));
  ok('kebab-case', namingOf('kebab-case') === 'hello-world-example', namingOf('kebab-case'));
  ok('CONSTANT_CASE', namingOf('CONSTANT_CASE') === 'HELLO_WORLD_EXAMPLE', namingOf('CONSTANT_CASE'));

  await setText('my-variable_name');
  ok('短横线与下划线混排也能切词', namingOf('camelCase') === 'myVariableName', namingOf('camelCase'));
  ok('连续分隔符只算一个', namingOf('snake_case') === 'my_variable_name');

  await setText('HelloWorld');
  ok('已是驼峰也能还原', namingOf('snake_case') === 'hello_world', namingOf('snake_case'));

  await setText('  spaced  out  ');
  ok('首尾与连续空白被吃掉', namingOf('snake_case') === 'spaced_out', namingOf('snake_case'));

  await setText('v2Api');
  ok('数字后接大写会切', namingOf('snake_case') === 'v2_api', namingOf('snake_case'));

  await setText('foo2bar');
  ok('词内数字不切', namingOf('snake_case') === 'foo2bar', namingOf('snake_case'));

  await setText('ALLCAPS');
  ok('全大写单词整体小写化', namingOf('snake_case') === 'allcaps', namingOf('snake_case'));

  /* ---------- 3. 缩写词的驼峰边界（上游缺陷 1） ---------- */
  section('3. 缩写词的驼峰边界');

  /* 上游只切 ([a-z0-9])([A-Z])，下面四条的期望值都会变成
     get_httpresponse / xmlhttp_request / httpserver / parse_htmlstring */
  await setText('getHTTPResponse');
  ok('getHTTPResponse → get_http_response',
     namingOf('snake_case') === 'get_http_response', namingOf('snake_case'));
  ok('getHTTPResponse → getHttpResponse（camelCase 可往返）',
     namingOf('camelCase') === 'getHttpResponse', namingOf('camelCase'));
  ok('getHTTPResponse → GetHttpResponse', namingOf('PascalCase') === 'GetHttpResponse');
  ok('getHTTPResponse → GET_HTTP_RESPONSE',
     namingOf('CONSTANT_CASE') === 'GET_HTTP_RESPONSE', namingOf('CONSTANT_CASE'));

  await setText('XMLHttpRequest');
  ok('XMLHttpRequest → xml_http_request',
     namingOf('snake_case') === 'xml_http_request', namingOf('snake_case'));

  await setText('HTTPServer');
  ok('HTTPServer → http_server', namingOf('snake_case') === 'http_server', namingOf('snake_case'));

  await setText('parseHTMLString');
  ok('parseHTMLString → parse_html_string',
     namingOf('snake_case') === 'parse_html_string', namingOf('snake_case'));

  await setText('userID');
  ok('userID → user_id', namingOf('snake_case') === 'user_id', namingOf('snake_case'));

  await setText('a1B2');
  ok('a1B2 → a1_b2', namingOf('snake_case') === 'a1_b2', namingOf('snake_case'));

  /* ---------- 4. 非拉丁字母（上游缺陷 2） ---------- */
  section('4. 非拉丁字母');

  /* 上游只认 [A-Za-z0-9]：café → caf、用户姓名 → 空串、привет мир → 空串 */
  await setText('café');
  ok('café 的重音字母不被丢掉', namingOf('camelCase') === 'café', namingOf('camelCase'));
  ok('café 大写时重音字母跟着大写',
     namingOf('CONSTANT_CASE') === 'CAFÉ', namingOf('CONSTANT_CASE'));

  await setText('用户姓名');
  ok('中文被保留为词元而不是清空',
     namingOf('snake_case') === '用户姓名', namingOf('snake_case'));
  ok('中文输入不再触发「切不出词元」', $('#tc-naming .match-empty') === null);

  await setText('中文 test 混合');
  ok('中英混排按分隔符切词', namingOf('snake_case') === '中文_test_混合', namingOf('snake_case'));

  await setText('привет мир');
  ok('西里尔字母保留', namingOf('snake_case') === 'привет_мир', namingOf('snake_case'));
  ok('西里尔字母首字母能大写',
     namingOf('PascalCase') === 'ПриветМир', namingOf('PascalCase'));

  /* ---------- 5. Title Case 的撇号（上游缺陷 3） ---------- */
  section('5. 词首大写');

  /* 上游用 /\b\w/g，撇号被当成词边界：don't stop → Don'T Stop */
  await setText("don't stop");
  ok("don't stop → Don't Stop", blockOf('词首大写') === "Don't Stop", blockOf('词首大写'));

  await setText('don\u2019t stop');
  ok('弯引号撇号同样处理', blockOf('词首大写') === 'Don\u2019t Stop', blockOf('词首大写'));

  await setText('hello-world');
  ok('短横线是词边界', blockOf('词首大写') === 'Hello-World', blockOf('词首大写'));

  /* 上游把下划线当词内字符（\w 包含 _），给出 Snake_case Here */
  await setText('snake_case here');
  ok('下划线按分隔符处理，与短横线一致',
     blockOf('词首大写') === 'Snake_Case Here', blockOf('词首大写'));

  await setText('hello world. second sentence');
  ok('句号后的词也大写',
     blockOf('词首大写') === 'Hello World. Second Sentence', blockOf('词首大写'));

  /* ---------- 6. 句首大写 ---------- */
  section('6. 句首大写');

  await setText('hello world. second sentence here');
  ok('句首大写', blockOf('句首大写') === 'Hello world. Second sentence here', blockOf('句首大写'));

  await setText('hello!world');
  ok('标点后没有空白不算换句', blockOf('句首大写') === 'Hello!world', blockOf('句首大写'));

  await setText('中文。test 句子');
  ok('中文句末标点后不加空格也换句',
     blockOf('句首大写') === '中文。Test 句子', blockOf('句首大写'));

  await setText('中文！test');
  ok('全角感叹号同样生效', blockOf('句首大写') === '中文！Test', blockOf('句首大写'));

  await setText('"hello world"');
  ok('开头的引号不阻止首字母大写',
     blockOf('句首大写') === '"Hello world"', blockOf('句首大写'));

  await setText('hello.\nworld');
  ok('换行也算空白', blockOf('句首大写') === 'Hello.\nWorld', blockOf('句首大写'));

  /* ---------- 7. 交替大小写 ---------- */
  section('7. 交替大小写');

  await setText('hello');
  ok('hello → hElLo', blockOf('交替大小写') === 'hElLo', blockOf('交替大小写'));

  await setText('hello world');
  ok('空格不参与交替计数', blockOf('交替大小写') === 'hElLo WoRlD', blockOf('交替大小写'));

  await setText('中文');
  ok('中文没有大小写，原样输出', blockOf('交替大小写') === '中文', blockOf('交替大小写'));

  /* 上游用 /[a-z]/i 判断字母，é 不参与计数：café → cAfé */
  await setText('café');
  ok('带重音的字母参与交替计数',
     blockOf('交替大小写') === 'cAfÉ', blockOf('交替大小写'));

  /* ---------- 8. 整段大小写 ---------- */
  section('8. 整段大小写');

  await setText('Hello World');
  ok('全部大写', blockOf('全部大写') === 'HELLO WORLD', blockOf('全部大写'));
  ok('全部小写', blockOf('全部小写') === 'hello world', blockOf('全部小写'));

  await setText('line one\nline two');
  ok('整段大小写保留换行',
     blockOf('全部大写') === 'LINE ONE\nLINE TWO', JSON.stringify(blockOf('全部大写')));
  ok('词首大写也保留换行',
     blockOf('词首大写') === 'Line One\nLine Two', JSON.stringify(blockOf('词首大写')));

  /* ---------- 9. 复制 ---------- */
  section('9. 复制');

  await setText('getHTTPResponse');
  copied = null;
  await click('#tc-naming .value-row');
  ok('点击命名风格行复制到剪贴板',
     copied === 'getHttpResponse', JSON.stringify(copied));

  await setText('line one\nline two');
  copied = null;
  await click('#tc-block .value-row');
  ok('点击整段大小写行复制的是带换行的原文',
     copied === 'LINE ONE\nLINE TWO', JSON.stringify(copied));

  /* ---------- 10. 状态行与边界 ---------- */
  section('10. 状态行与边界');

  await setText('getHTTPResponse');
  ok('状态行显示词元数', $('#tc-status').textContent === '切出 3 个词元',
     $('#tc-status').textContent);
  ok('词元预览列出切分结果',
     $('#tc-tokens').textContent === '词元：get · http · response',
     $('#tc-tokens').textContent);

  await setText('hello world');
  ok('词元数随输入变化', $('#tc-status').textContent === '切出 2 个词元',
     $('#tc-status').textContent);

  await setText('line one\nline two');
  ok('多行时说明区提示已合并',
     $('#tc-naming-foot').textContent.includes('已把 2 行合并成一个标识符'),
     $('#tc-naming-foot').textContent);

  await setText('hello world');
  ok('单行时说明区是默认文案',
     $('#tc-naming-foot').textContent.includes('切成词元后重新拼接'));

  await setText('---');
  ok('只剩标点时命名风格区给出提示', $('#tc-naming .match-empty') !== null);
  ok('只剩标点时整段大小写仍有结果', block().length === 5);

  await click('[data-clear]');
  ok('清空后回到空态',
     $('#tc-naming .match-empty') !== null && $('#tc-block .match-empty') !== null);
  ok('清空后状态行也清空', $('#tc-status').textContent === '');
  ok('清空后词元预览也清空', $('#tc-tokens').textContent === '');

  /* ---------- 11. 示例 ---------- */
  section('11. 示例');

  await click('[data-demo]');
  ok('示例有 5 行命名风格', naming().length === 5);
  ok('示例：snake_case',
     namingOf('snake_case') === 'get_http_response_from_my_variable_name',
     namingOf('snake_case'));
  ok('示例：camelCase',
     namingOf('camelCase') === 'getHttpResponseFromMyVariableName',
     namingOf('camelCase'));
  ok('示例：CONSTANT_CASE',
     namingOf('CONSTANT_CASE') === 'GET_HTTP_RESPONSE_FROM_MY_VARIABLE_NAME',
     namingOf('CONSTANT_CASE'));
  ok('示例：全部大写',
     blockOf('全部大写') === 'GETHTTPRESPONSE_FROM MY-VARIABLE NAME',
     blockOf('全部大写'));
  ok('示例：交替大小写',
     blockOf('交替大小写') === 'gEtHtTpReSpOnSe_FrOm My-VaRiAbLe NaMe',
     blockOf('交替大小写'));

  /* ---------- 12. 页面结构 ---------- */
  section('12. 页面结构');

  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为文本分类的绿色',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#16a34a',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('说明区列出了来源与致谢', d.body.textContent.includes('来源与致谢'));
  ok('说明区写明了词元切分规则', d.body.textContent.includes('缩写词尾巴也认'));

  ok('全程无脚本错误', errors.length === 0, errors.join(' | '));
}
