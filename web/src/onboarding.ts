// First-visit guidance, kept pure so it can be tested without a DOM.
// Pattern adapted from OpenMausBot's guided tour (Apache-2.0,
// github.com/milind-soni/OpenMausBot, src/lib/guided-tour.ts): steps point at
// live controls by `data-tour` id, progress is a list of seen ids, and a
// replay clears only the tour's ids.

export type TourStepId = 'tour.link' | 'tour.file' | 'tour.library' | 'tour.done';
export type SpotId = 'spot.verify';
export type Placement = 'above' | 'below' | 'right';

export interface TourStep {
  id: TourStepId;
  /** `data-tour` id of the control; null centres the card. */
  anchor: string | null;
  placement: Placement;
  text: string;
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'tour.link', anchor: 'link', placement: 'below', text: '粘贴 B 站、YouTube、抖音或播客链接。分享口令整段粘进来也行，会自动找出里面的链接。' },
  { id: 'tour.file', anchor: 'file', placement: 'below', text: '也可以选择或直接拖入本地音频、视频文件。' },
  { id: 'tour.library', anchor: 'library', placement: 'right', text: '导入过的都在资料库里：原音轨、逐字稿和文章存在同一条目下。' },
  { id: 'tour.done', anchor: null, placement: 'below', text: '转录和整理都等你点了才开始，不会自动消耗额度。先粘一个链接试试。' },
];

export const SPOT_TEXT: Record<SpotId, string> = {
  'spot.verify': '点「核对」，左边是文章，右边是原稿。点任意一段，能看到它出自原稿的哪一段。',
};

export const SPOT_ANCHOR: Record<SpotId, string> = { 'spot.verify': 'verify' };

export function currentStep(seen: readonly string[]): TourStep | null {
  return TOUR_STEPS.find((step) => !seen.includes(step.id)) ?? null;
}

/** 1-based position among the steps with a Next button; the closing card has no number. */
export function stepNumber(step: TourStep): { current: number; total: number } {
  const numbered = TOUR_STEPS.filter((s) => s.id !== 'tour.done');
  const index = numbered.indexOf(step);
  return { current: index < 0 ? numbered.length : index + 1, total: numbered.length };
}

export function withTourFinished(seen: readonly string[]): string[] {
  return [...new Set([...seen, ...TOUR_STEPS.map((s) => s.id)])];
}

export function withTourReset(seen: readonly string[]): string[] {
  const ids = new Set<string>(TOUR_STEPS.map((s) => s.id));
  return seen.filter((id) => !ids.has(id));
}

/** A first-sight hint waits for the tour, so two spotlights never stack. */
export function spotDue(id: SpotId, seen: readonly string[]): boolean {
  return currentStep(seen) === null && !seen.includes(id);
}

const KEY = 'tengqing.onboarding.v1';

interface KeyValue { getItem(key: string): string | null; setItem(key: string, value: string): void; }

// Guests have no account, so progress lives in the browser. A private window
// or a blocked storage simply shows the tour again.
export function loadSeen(storage: KeyValue | undefined = globalThis.localStorage): string[] {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) || '{}');
    return Array.isArray(parsed.seen) ? parsed.seen.filter((id: unknown) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveSeen(seen: readonly string[], storage: KeyValue | undefined = globalThis.localStorage): void {
  try { storage?.setItem(KEY, JSON.stringify({ seen })); } catch { /* storage unavailable: tour shows again next visit */ }
}
