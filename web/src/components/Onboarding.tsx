// First-visit tour on the home screen and a one-time hint the first time an
// article is read. Sequencing lives in ../onboarding.ts; this file wires it to
// the page. Clicking the lit control counts as Next, as in OpenMausBot's tour.
import { useCallback, useEffect, useState } from 'react';
import Spotlight from './Spotlight';
import { SPOT_ANCHOR, SPOT_TEXT, currentStep, loadSeen, saveSeen, spotDue, stepNumber, withTourFinished, withTourReset, type SpotId } from '../onboarding';

export function useOnboarding() {
  const [seen, setSeen] = useState<string[]>(() => loadSeen());
  const update = useCallback((next: (prev: string[]) => string[]) => {
    setSeen((prev) => { const value = next(prev); saveSeen(value); return value; });
  }, []);
  return {
    seen,
    markSeen: useCallback((id: string) => update((prev) => (prev.includes(id) ? prev : [...prev, id])), [update]),
    finishTour: useCallback(() => update(withTourFinished), [update]),
    replayTour: useCallback(() => update(withTourReset), [update]),
  };
}

export function GuidedTour({ seen, active, onSeen, onFinish }: {
  seen: string[];
  /** The home screen is showing and nothing else is on top of it. */
  active: boolean;
  onSeen: (id: string) => void;
  onFinish: () => void;
}) {
  const step = currentStep(seen);
  const next = useCallback(() => { if (step) onSeen(step.id); }, [step, onSeen]);

  // Pressing the lit control is as good as Next.
  useEffect(() => {
    if (!active || !step?.anchor) return;
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest(`[data-tour="${step.anchor}"]`)) next();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active, step, next]);

  if (!active || !step) return null;
  const closing = step.id === 'tour.done';
  const { current, total } = stepNumber(step);
  return (
    <Spotlight
      anchor={step.anchor}
      placement={step.placement}
      progress={closing ? undefined : `${current} / ${total}`}
      primary={{ label: closing ? '开始使用' : '下一步', onClick: closing ? onFinish : next }}
      secondary={closing ? undefined : { label: '跳过', onClick: onFinish }}
      onDone={onFinish}
    >
      {step.text}
    </Spotlight>
  );
}

export function FirstSightHint({ id, seen, active, onSeen }: { id: SpotId; seen: string[]; active: boolean; onSeen: (id: string) => void }) {
  const dismiss = useCallback(() => onSeen(id), [id, onSeen]);
  if (!active || !spotDue(id, seen)) return null;
  return (
    <Spotlight key={id} anchor={SPOT_ANCHOR[id]} placement="below" primary={{ label: '知道了', onClick: dismiss }} onDone={dismiss}>
      {SPOT_TEXT[id]}
    </Spotlight>
  );
}
