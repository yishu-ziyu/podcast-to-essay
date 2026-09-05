import test from 'node:test';
import assert from 'node:assert/strict';
import { articleConfig, articleProviderError, articleStructure, extractMap, generateArticle, normalizeArticle, validateArticle, validateMap } from './article.mjs';

test('articleConfig refuses to run without a server-side token', () => {
  assert.throws(() => articleConfig({}), /还没有配置文章整理服务/);
});

test('normalizeArticle removes a wrapper fence and duplicate h1', () => {
  assert.equal(normalizeArticle('```markdown\n# 原标题\n\n## 第一节\n\n正文。\n```'), '## 第一节\n\n正文。');
});

test('validateArticle rejects transcript-shaped output', () => {
  assert.throws(() => validateArticle('**Speaker 0：** ' + '原话'.repeat(400), 30_000), /说话人标签/);
  assert.throws(() => validateArticle('[00:03:00,000] ' + '原话'.repeat(400), 30_000), /时间戳/);
});

test('articleStructure separates a heading from the paragraph on the next line', () => {
  const structure = articleStructure('## 第一节\n紧跟标题的正文。\n\n第二段。');
  assert.equal(structure.headings.length, 1);
  assert.deepEqual(structure.paragraphs, ['紧跟标题的正文。', '第二段。']);
});

test('articleProviderError turns provider responses into actionable Chinese', () => {
  assert.equal(articleProviderError(402), '文章整理额度不足，补充额度后可以继续。');
  assert.equal(articleProviderError(404), '文章整理模型当前不可用，请检查模型配置后重试。');
  assert.equal(articleProviderError(503), '文章整理服务暂时不可用，请稍后再试。');
});

test('generateArticle returns provenance only for a structured article', async () => {
  const section = (n) => `## 第${n}节\n\n` + Array.from({ length: 3 }, (_, i) => `这是第${n}节第${i + 1}段，${'内容'.repeat(100)}。`).join('\n\n');
  const content = [section(1), section(2), section(3)].join('\n\n');
  const result = await generateArticle({
    title: '测试节目',
    rawText: '逐字稿'.repeat(8_000),
    env: { STEP_API_KEY: 'test-token', STEP_ARTICLE_MODEL: 'step-3.7-flash' },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ model: 'step-3.7-flash', choices: [{ finish_reason: 'stop', message: { content } }] }),
    }),
  });

  assert.equal(result.meta.provider, 'stepfun-token-plan');
  assert.equal(result.meta.model, 'step-3.7-flash');
  assert.equal(result.meta.stats.headings, 3);
  assert.equal(result.meta.stats.paragraphs, 9);
  assert.equal(result.meta.paraMap, null);
});

test('extractMap splits the trailing map line from the article text', () => {
  const { text, map } = extractMap('## 第一节\n\n正文。\n<<<MAP>>> [[0, 182], null]');
  assert.equal(text, '## 第一节\n\n正文。');
  assert.deepEqual(map, [[0, 182], null]);
});

test('extractMap returns null map when the marker is absent or broken', () => {
  assert.deepEqual(extractMap('正文。').map, null);
  assert.deepEqual(extractMap('正文。\n<<<MAP>>> not json').map, null);
});

test('validateMap accepts ranges, rejects count mismatch and garbage', () => {
  assert.deepEqual(validateMap([[0, 10], null], 2), [[0, 10], null]);
  assert.equal(validateMap([[0, 10]], 2), null);
  assert.equal(validateMap([[10, 5], null], 2), null);
  assert.equal(validateMap([null, null], 2), null);
  assert.equal(validateMap('nope', 2), null);
});

test('generateArticle stores the paragraph map and keeps timestamps out of validation', async () => {
  const section = (n) => `## 第${n}节\n\n` + Array.from({ length: 3 }, (_, i) => `这是第${n}节第${i + 1}段，${'内容'.repeat(100)}。`).join('\n\n');
  const content = [section(1), section(2), section(3)].join('\n\n');
  const map = Array.from({ length: 9 }, (_, i) => [i * 100, i * 100 + 90]);
  const result = await generateArticle({
    title: '测试节目',
    rawText: '逐字稿'.repeat(8_000),
    env: { STEP_API_KEY: 'test-token', STEP_ARTICLE_MODEL: 'step-3.7-flash' },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ model: 'step-3.7-flash', choices: [{ finish_reason: 'stop', message: { content: `${content}\n<<<MAP>>> ${JSON.stringify(map)}` } }] }),
    }),
  });
  assert.deepEqual(result.meta.paraMap, map);
  assert.ok(!result.text.includes('<<<MAP>>>'));
});
