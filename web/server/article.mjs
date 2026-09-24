const DEFAULT_BASE_URL = 'https://api.stepfun.com/step_plan/v1';
const DEFAULT_MODEL = 'step-3.7-flash';

const SYSTEM_PROMPT = `你是一位克制、准确的中文特稿编辑。你的任务是把播客逐字稿整理成一篇真正可读的文章，而不是删掉时间戳后原样拼接。

硬性要求：
- 保留原始事实、观点与关键论证，不虚构信息，不替受访者补充观点。
- 所有日期、任职年限、数量和因果关系都必须能从逐字稿直接得到；不要自行换算时间跨度，也不要用“无人不知”“幕后推手”等夸张判断代替原始事实。
- 删除主持人口头禅、重复追问、无意义语气词和节目开场预告的重复内容。
- 用 12 至 24 个长度适中的自然段组织叙述，段落之间必须空一行；长节目使用 3 至 8 个二级标题（##），每节至少包含两个自然段，标题应具体、克制。
- 可保留少量有信息量的直接引语，但不要保留 Speaker 0、Speaker 1 等 ASR 标签。
- 不输出时间戳，不写“以下是整理后的文章”等说明，不输出一级标题。
- 中文标点和专有名词应统一；不能确认的专有名词保留原样。
- 输出 Markdown 正文，篇幅以完整表达核心内容为准，不追求逐字覆盖。`;

export function articleConfig(env = process.env) {
  const apiKey = env.STEP_API_KEY || env.ANTHROPIC_AUTH_TOKEN || '';
  const baseUrl = (env.STEP_ARTICLE_BASE_URL || env.STEP_API_BASE || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = env.STEP_ARTICLE_MODEL || DEFAULT_MODEL;
  if (!apiKey) throw new Error('还没有配置文章整理服务。请先设置 STEP_API_KEY。');
  return { apiKey, baseUrl, model };
}

export function articleMessages(title, rawText) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `节目标题：${title || '未命名音轨'}\n\n请将下面的完整逐字稿整理成文章：\n\n${rawText}\n\n附加要求（不影响正文）：正文结束后另起一行，只输出以 <<<MAP>>> 开头的 JSON 数组，为正文每个自然段（按出现顺序、以空行分隔、不含 ##/### 标题行，引用块按一个自然段计）给出其内容在逐字稿中的起止秒数 [start, end]（根据逐字稿行首 [HH:MM:SS,mmm] 时间戳估算；无法判断填 null）。数组长度必须与自然段数一致，例如：\n<<<MAP>>> [[0, 182], [180, 375], null]`,
    },
  ];
}

export function normalizeArticle(content) {
  return String(content || '')
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/^#\s+[^\n]+\n+/, '')
    .trim();
}

export function articleStructure(text) {
  const headings = [];
  const paragraphs = [];
  const lineCounts = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length) { paragraphs.push(buffer.join(' ').trim()); lineCounts.push(buffer.length); }
    buffer = [];
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) { flush(); continue; }
    if (/^#{2,3}\s+\S/.test(line)) {
      flush();
      headings.push(line);
      continue;
    }
    buffer.push(line);
  }
  flush();
  return { headings, paragraphs, lineCounts };
}

export function validateArticle(content, rawLength = 0) {
  const text = normalizeArticle(content);
  const { headings, paragraphs } = articleStructure(text);
  const minChars = minimumArticleLength(rawLength);

  if (/\[\d{2}:\d{2}:\d{2}(?:,\d{3})?\]/.test(text)) throw new Error('文章仍含时间戳，未写入结果。');
  if (/(?:\*\*)?Speaker\s*\d+\s*[：:]/i.test(text)) throw new Error('文章仍含 ASR 说话人标签，未写入结果。');
  if (text.length < minChars) throw new Error('模型返回的文章过短，未写入结果。');
  if (rawLength > 20_000 && headings.length < 3) throw new Error(`文章缺少必要的章节结构（检测到 ${headings.length} 节），未写入结果。`);
  if (rawLength > 20_000 && paragraphs.length < 8) throw new Error(`文章段落结构不足（检测到 ${paragraphs.length} 段），未写入结果。`);

  return { text, stats: { chars: text.length, paragraphs: paragraphs.length, headings: headings.length } };
}

// 短音频的逐字稿可能不到 500 字，固定下限会让忠实整理必然或随机失败。
// 下限随逐字稿长度收缩，长节目仍走原有的 1500 字门槛。
export function minimumArticleLength(rawLength = 0) {
  if (rawLength > 20_000) return 1_500;
  return Math.max(200, Math.min(500, Math.round(rawLength * 0.4)));
}

export function articleProviderError(status) {
  if (status === 401 || status === 403) return '文章整理服务鉴权失败，请检查本机密钥配置。';
  if (status === 402) return '文章整理额度不足，补充额度后可以继续。';
  if (status === 429) return '文章整理服务正在限流，请稍后再试。';
  if (status === 400 || status === 404) return '文章整理模型当前不可用，请检查模型配置后重试。';
  if (status >= 500) return '文章整理服务暂时不可用，请稍后再试。';
  return `文章整理服务没有完成请求（${status}）。`;
}

export async function generateArticle({ title, rawText, env = process.env, fetchImpl = fetch }) {
  const config = articleConfig(env);
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: articleMessages(title, rawText),
      reasoning_effort: 'low',
      temperature: 0.2,
      max_tokens: 12_000,
    }),
  });

  if (!response.ok) {
    throw new Error(articleProviderError(response.status));
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('文章生成达到长度上限，未写入不完整结果。');
  const { text: withMap, map } = extractMap(choice?.message?.content);
  const { text, stats } = validateArticle(withMap, rawText.length);
  return {
    text,
    meta: {
      provider: 'stepfun-token-plan',
      model: data.model || config.model,
      generatedAt: new Date().toISOString(),
      stats,
      paraMap: validateMap(map, stats.paragraphs) || validateMap(foldLineMap(map, articleStructure(text).lineCounts), stats.paragraphs),
    },
  };
}

export function extractMap(content) {
  const m = String(content || '').match(/<<<MAP>>>\s*(\[[\s\S]*\])\s*$/);
  if (!m) return { text: String(content || ''), map: null };
  let map = null;
  try {
    const parsed = JSON.parse(m[1]);
    if (Array.isArray(parsed)) map = parsed;
  } catch {}
  return { text: String(content || '').slice(0, m.index).trim(), map };
}

// The model often maps every line instead of every blank-line paragraph (13 ranges for
// 4 paragraphs). When the count equals the total line count, merge each paragraph's lines.
export function foldLineMap(map, lineCounts) {
  if (!Array.isArray(map) || map.length !== lineCounts.reduce((sum, n) => sum + n, 0)) return null;
  let at = 0;
  return lineCounts.map((count) => {
    const ranges = map.slice(at, at += count).filter((entry) => Array.isArray(entry) && entry.length === 2);
    if (!ranges.length) return null;
    return [Math.min(...ranges.map((entry) => Number(entry[0]))), Math.max(...ranges.map((entry) => Number(entry[1])))];
  });
}

export function validateMap(map, paragraphCount) {
  if (!Array.isArray(map) || map.length !== paragraphCount) return null;
  const clean = map.map((entry) => {
    if (entry === null) return null;
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const start = Number(entry[0]);
    const end = Number(entry[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
    return [start, end];
  });
  if (clean.every((entry) => entry === null)) return null;
  return clean;
}
