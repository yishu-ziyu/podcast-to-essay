import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOUR_STEPS, currentStep, loadSeen, saveSeen, spotDue, stepNumber, withTourFinished, withTourReset } from './onboarding.ts';

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => { data[key] = value; },
    data,
  };
}

test('巡览从第一个没看过的步骤开始，全部看过则结束', () => {
  assert.equal(currentStep([])?.id, 'tour.link');
  assert.equal(currentStep(['tour.link'])?.id, 'tour.file');
  assert.equal(currentStep(TOUR_STEPS.map((s) => s.id)), null);
});

test('进度只数用户会看到的步骤，收尾卡不占号', () => {
  const total = TOUR_STEPS.length - 1;
  assert.deepEqual(stepNumber(TOUR_STEPS[0]), { current: 1, total });
  assert.deepEqual(stepNumber(TOUR_STEPS.at(-1)!), { current: total, total });
});

test('跳过记下所有步骤；重放只清巡览，不清场景提示', () => {
  const done = withTourFinished(['spot.verify']);
  assert.equal(currentStep(done), null);
  assert.ok(done.includes('spot.verify'));
  const reset = withTourReset(done);
  assert.equal(currentStep(reset)?.id, 'tour.link');
  assert.deepEqual(reset, ['spot.verify']);
});

test('核对提示在巡览结束后、没看过时才出现', () => {
  assert.equal(spotDue('spot.verify', []), false, '巡览没结束时不叠加提示');
  const toured = withTourFinished([]);
  assert.equal(spotDue('spot.verify', toured), true);
  assert.equal(spotDue('spot.verify', [...toured, 'spot.verify']), false);
});

test('进度存在本地；坏数据或存储不可用时当作没看过，不报错', () => {
  const store = memory();
  saveSeen(['tour.link'], store);
  assert.deepEqual(loadSeen(store), ['tour.link']);
  assert.deepEqual(loadSeen(memory({ 'tengqing.onboarding.v1': '{broken' })), []);
  assert.deepEqual(loadSeen(memory({ 'tengqing.onboarding.v1': '{"seen":"x"}' })), []);
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(loadSeen(throwing), []);
  assert.doesNotThrow(() => saveSeen(['tour.link'], throwing));
});
