import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleUnits } from './lib.ts';

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
