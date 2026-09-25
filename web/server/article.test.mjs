import test from 'node:test';
import assert from 'node:assert/strict';
import { articleConfig, articleMessages, articleProviderError, articleStructure, extractChunkMap, generateArticle, minimumArticleLength, normalizeArticle, transcriptChunks, validateArticle, validateMap } from './article.mjs';

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

test('validateArticle scales the length floor down for a short transcript', () => {
  assert.equal(minimumArticleLength(457), 200);
  assert.equal(minimumArticleLength(2_000), 500);
  assert.equal(minimumArticleLength(30_000), 1_500);

  // 457 字逐字稿的忠实整理在 500 字上下浮动，不能再被固定门槛拦掉。
  const article = `## 第一节\n\n${'内容'.repeat(150)}。`;
  assert.equal(validateArticle(article, 457).stats.chars, article.length);
  assert.throws(() => validateArticle('整理完成。', 457), /过短/);
  assert.throws(() => validateArticle('内容'.repeat(150), 2_000), /过短/);
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

const RAW3 = [
  '[00:00:00,000] Speaker 0: 第一段逐字稿。',
  '[00:03:00,000] Speaker 0: 第二段逐字稿。',
  '[00:06:00,000] Speaker 1: 第三段逐字稿。',
].join('\n');

test('transcriptChunks reads one ~3-minute chunk per timestamped line', () => {
  assert.deepEqual(transcriptChunks(RAW3).map(({ start, end }) => [start, end]), [[0, 180], [180, 360], [360, 540]]);
  assert.equal(transcriptChunks('没有时间戳的文字'), null);
});

test('the prompt numbers transcript chunks instead of asking for seconds', () => {
  const [, user] = articleMessages('节目', RAW3);
  assert.match(user.content, /【段1】Speaker 0: 第一段逐字稿。\n【段2】Speaker 0: 第二段逐字稿。\n【段3】Speaker 1: 第三段逐字稿。/);
  assert.doesNotMatch(user.content, /\[00:03:00,000\]|<<<MAP>>>/);
  assert.match(user.content, /\{\{N-M\}\}/);
});

test('chunk tags map each paragraph by its own tag, so one bad tag cannot shift the rest', () => {
  const chunks = transcriptChunks(RAW3);
  const tagged = [
    '## 第一节', '', '{{1}}第一段。', '', '{{9}}段号超出范围。', '', '{{?}}判断不了。', '',
    '## 第二节', '', '{{2-3}}跨两段。', '', '第二行没有标记，', '{{3}}第三行有。', '',
    '{{2}}', '', '标记单独占一行时归下一段。', '', '> {{1}}引用块。',
  ].join('\n');
  const { text, map } = extractChunkMap(tagged, chunks);
  assert.doesNotMatch(text, /\{\{/);
  assert.equal(articleStructure(text).paragraphs.length, 7);
  assert.deepEqual(map, [[0, 180], null, null, [180, 540], [360, 540], [180, 360], [0, 180]]);
  assert.match(text, /^> 引用块。$/m);
});

test('no tags, or a transcript without chunks, gives no map rather than a guess', () => {
  const chunks = transcriptChunks(RAW3);
  assert.equal(extractChunkMap('## 标题\n\n正文。', chunks).map, null);
  assert.equal(extractChunkMap('{{1}}正文。', null).map, null);
  assert.equal(extractChunkMap('{{1}}正文。', null).text, '正文。');
});

test('generateArticle stores seconds converted from chunk tags and validates the untagged text', async () => {
  const line = '这是一句足够长的整理后正文，用来凑够文章的最低字数要求。';
  const content = `## 第一节\n\n{{1}}${line}${line}${line}\n\n{{1-2}}${line}${line}${line}\n\n## 第二节\n\n{{3}}${line}${line}${line}`;
  const result = await generateArticle({
    title: '测试节目',
    rawText: `${RAW3}\n${'[00:09:00,000] Speaker 0: ' + '逐字稿'.repeat(150)}`,
    env: { STEP_API_KEY: 'test-token', STEP_ARTICLE_MODEL: 'step-3.7-flash' },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ model: 'step-3.7-flash', choices: [{ finish_reason: 'stop', message: { content } }] }),
    }),
  });
  assert.deepEqual(result.meta.paraMap, [[0, 180], [0, 360], [360, 540]]);
  assert.ok(!result.text.includes('{{'));
  assert.equal(result.meta.stats.paragraphs, 3);
});

test('validateMap accepts ranges, rejects count mismatch and garbage', () => {
  assert.deepEqual(validateMap([[0, 10], null], 2), [[0, 10], null]);
  assert.equal(validateMap([[0, 10]], 2), null);
  assert.equal(validateMap([[10, 5], null], 2), null);
  assert.equal(validateMap([null, null], 2), null);
  assert.equal(validateMap('nope', 2), null);
});

// step-3.7-flash drafts the whole article in its reasoning before writing it, and reasoning
// counts toward max_tokens: 12k tokens left an 18-minute episode ~700 tokens of headroom.
test('整理请求给推理模型留足输出空间', async () => {
  let body = null;
  await generateArticle({
    title: 't',
    rawText: '逐字稿'.repeat(100),
    env: { STEP_API_KEY: 'test-token' },
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '' } }] }) };
    },
  }).catch(() => {});
  assert.ok(body.max_tokens >= 100_000, `max_tokens=${body.max_tokens}`);
});

// The model sometimes separates paragraphs with a single newline; the reader and the map
// split on blank lines, so a whole section would render as one block.
test('normalizeArticle gives every prose line its own paragraph and keeps quote lines together', () => {
  assert.equal(
    normalizeArticle('## 节\n第一段。\n第二段。\n> 引1\n> 引2\n第三段。\n\n\n第四段。'),
    '## 节\n\n第一段。\n\n第二段。\n\n> 引1\n> 引2\n\n第三段。\n\n第四段。',
  );
});
