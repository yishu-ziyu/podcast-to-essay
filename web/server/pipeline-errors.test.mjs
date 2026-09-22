import test from 'node:test';
import assert from 'node:assert/strict';
import { DOUYIN_PAGE_MESSAGE, classifyMediaUrl } from './domain/media-url.mjs';
import { failureForClassification, interpretExtractor, messageFor } from './domain/errors.mjs';
import { redact } from './infrastructure/logger.mjs';

const PAGE = '这是抖音主页，不是具体视频。请打开要导入的视频，复制该视频的分享链接。';

test('douyin profile and home failures use the page message, not a bilibili or missing-audio message', () => {
  for (const url of [
    'https://www.douyin.com/user/self?from_tab_name=main',
    'https://www.douyin.com/user/MS4wLjABAAAA123',
    'https://www.douyin.com/',
    'https://www.douyin.com/search/播客',
  ]) {
    const failure = failureForClassification(classifyMediaUrl(url));
    assert.equal(failure.code, 'unsupported_page');
    assert.equal(failure.userMessage, PAGE);
    assert.equal(failure.retryable, false);
    assert.ok(failure.diagnosticId);
    assert.doesNotMatch(failure.userMessage, /B 站|未获取到可转录的音频/);
  }
  assert.equal(DOUYIN_PAGE_MESSAGE, PAGE);
});

test('extractor failures name the platform that was actually requested', () => {
  const douyin = interpretExtractor('ERROR: This video requires login', 'douyin', 'downloading_media');
  assert.equal(douyin.code, 'login_required');
  assert.match(douyin.userMessage, /抖音/);
  assert.doesNotMatch(douyin.userMessage, /B 站/);

  const bili = interpretExtractor('ERROR: HTTP Error 412: Precondition Failed', 'bilibili', 'downloading_media');
  assert.equal(bili.code, 'platform_refused');
  assert.match(bili.userMessage, /B 站/);
  assert.doesNotMatch(bili.userMessage, /抖音/);

  const missing = interpretExtractor("/usr/bin/env: 'python3': No such file or directory", 'douyin', 'reading_info');
  assert.equal(missing.code, 'extractor_unavailable');
  assert.equal(messageFor('transcription_quota_exhausted'), '转录服务额度已用尽。补充额度后可以从这一段继续。');
  assert.equal(messageFor('transcription_auth_failed'), '转录服务授权失效，请检查设置后重试。');
});

test('logs redact tokens, passwords, and session cookies', () => {
  const env = {
    STEP_API_KEY: 'step-secret-value',
    ACCESS_PASSWORD: 'gate-secret',
    ANTHROPIC_AUTH_TOKEN: 'anthropic-secret',
  };
  const text = redact('key=step-secret-value Authorization: Bearer anthropic-secret cookie=gate-secret p2e_session=abc.def', env);
  assert.doesNotMatch(text, /step-secret-value|anthropic-secret|gate-secret|abc\.def/);
  assert.match(text, /\[redacted\]/);
});
