import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleUnits } from './lib.ts';
// @ts-expect-error plain JS module without type declarations
import { articleStructure, normalizeArticle } from '../server/article.mjs';

test('标题行紧跟正文时，正文仍算一个自然段', () => {
  const units = articleUnits('## 第一节\n紧跟标题的正文。\n\n第二段。');
  assert.deepEqual(units, [
    { kind: 'h2', text: '第一节', para: null },
    { kind: 'p', text: '紧跟标题的正文。', para: 0 },
    { kind: 'p', text: '第二段。', para: 1 },
  ]);
});

test('段落编号按出现顺序，标题不占号', () => {
  const units = articleUnits('## 一\n第一段。\n\n第二段。\n\n### 小节\n第三段。');
  assert.deepEqual(
    units.map((u) => [u.kind, u.para]),
    [['h2', null], ['p', 0], ['p', 1], ['h3', null], ['p', 2]],
  );
});

test('整段引用算一个 quote 单元，并保留段落号', () => {
  const units = articleUnits('> 引用一\n> 引用二\n\n正文。');
  assert.deepEqual(
    units.map((u) => [u.kind, u.text, u.para]),
    [['quote', '引用一 引用二', 0], ['p', '正文。', 1]],
  );
});

test('空文档不产生单元', () => {
  assert.deepEqual(articleUnits(''), []);
});

// paraMap is indexed by the server's paragraph order; the reader must count paragraphs the same way.
test('前端段落编号与服务端 articleStructure 一致', () => {
  const samples = [
    '## 一\n紧跟标题的正文。\n\n第二段。\n\n### 小节\n第三段。',
    '> 引用一\n> 引用二\n\n正文。\n\n#### 四级标题不算标题\n\n##没有空格也不算',
    normalizeArticle('## 节\n第一段。\n第二段。\n> 引1\n> 引2\n第三段。'),
  ];
  for (const text of samples) {
    const front = articleUnits(text).filter((u) => u.para !== null).length;
    assert.equal(front, articleStructure(text).paragraphs.length, text);
  }
});
