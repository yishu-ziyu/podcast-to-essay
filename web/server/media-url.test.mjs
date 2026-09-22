import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMediaUrl } from './domain/media-url.mjs';

const SELF = 'https://www.douyin.com/user/self?from_tab_name=main&showTab=post';

test('a Douyin self profile is not sent to the extractor', () => {
  const got = classifyMediaUrl(SELF);
  assert.equal(got.platform, 'douyin');
  assert.equal(got.kind, 'douyin_self_profile');
  assert.equal(got.supported, false);
  assert.match(got.reason, /主页/);
});

test('classifies concrete videos, short links, profiles, and direct files', () => {
  const video = classifyMediaUrl('https://www.douyin.com/video/7123456789012345678?previous_page=app');
  assert.equal(video.kind, 'douyin_video');
  assert.equal(video.supported, true);
  assert.equal(video.normalizedUrl, 'https://www.douyin.com/video/7123456789012345678');

  const short = classifyMediaUrl('https://v.douyin.com/iJd8k123/');
  assert.equal(short.kind, 'douyin_short_link');
  assert.equal(short.supported, true);

  const profile = classifyMediaUrl('https://www.douyin.com/user/MS4wLjABAAAA123');
  assert.equal(profile.kind, 'douyin_profile');
  assert.equal(profile.supported, false);

  const home = classifyMediaUrl('https://www.douyin.com/');
  assert.equal(home.kind, 'unsupported_page');
  assert.equal(home.supported, false);

  const search = classifyMediaUrl('https://www.douyin.com/search/播客');
  assert.equal(search.kind, 'unsupported_page');
  assert.equal(search.supported, false);

  const bili = classifyMediaUrl('https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333');
  assert.equal(bili.kind, 'bilibili_video');
  assert.equal(bili.supported, true);
  assert.equal(bili.normalizedUrl, 'https://www.bilibili.com/video/BV1xx411c7mD');

  const file = classifyMediaUrl('https://cdn.example.com/shows/episode.mp3?token=1');
  assert.equal(file.kind, 'direct_media');
  assert.equal(file.supported, true);

  const bad = classifyMediaUrl('not a url');
  assert.equal(bad.kind, 'invalid_url');
  assert.equal(bad.supported, false);

  const loopback = classifyMediaUrl('http://127.0.0.1/a.mp3');
  assert.equal(loopback.kind, 'invalid_url');
  assert.equal(loopback.supported, false);
});
