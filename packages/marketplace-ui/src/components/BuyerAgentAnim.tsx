import { useEffect, useRef } from 'react';
import '../vendor/buyer-agent-anim.js';

/**
 * The buyer agent's story beside the Claim wallet checklist — see `vendor/buyer-agent-anim.js`.
 *
 * The script owns its own pacing: it never steps backwards and plays every scene in order for its
 * minimum time, so a poll that jumps several steps at once still reads as a story. This wrapper
 * therefore just forwards the step; it must not try to sequence or debounce anything itself.
 */

export type AnimStep =
  | 'created'
  | 'funded'
  | 'started'
  | 'discover'
  | 'discovered'
  | 'purchase'
  | 'finalize'
  | 'download'
  | 'done'
  | 'error';

interface AnimHandle {
  setStep(step: AnimStep): void;
  destroy(): void;
}

declare global {
  interface Window {
    BuyerAgentAnim: { mount(el: HTMLElement): AnimHandle };
  }
}

export default function BuyerAgentAnim({
  step,
  className,
}: {
  step: AnimStep;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const handle = useRef<AnimHandle>();

  // Mounted once. `destroy` removes the SVG, so StrictMode's double mount leaves exactly one.
  useEffect(() => {
    if (!box.current) return;
    const anim = window.BuyerAgentAnim.mount(box.current);
    handle.current = anim;
    return () => {
      anim.destroy();
      handle.current = undefined;
    };
  }, []);

  // Declared after the mount effect, so on first render it runs second and finds the handle.
  useEffect(() => {
    handle.current?.setStep(step);
  }, [step]);

  return <div ref={box} className={className} />;
}
