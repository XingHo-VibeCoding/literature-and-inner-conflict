import { useCallback, useLayoutEffect, useRef } from 'react';

const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';

// 观察内层的自然尺寸，只在外层缓动高度，避免嵌套动画互相裁切。
export function useJournalPanelMotion(changes) {
  const ref = useRef(null);
  const contentRef = useRef(null);
  const previous = useRef(null);
  const running = useRef(null);
  const pointerHeld = useRef(false);

  const stop = useCallback(() => {
    const current = running.current;
    if (!current) return;
    running.current = null;
    current.animation.onfinish = null;
    current.animation.cancel();
    current.element.style.overflow = current.overflow;
  }, []);

  const measure = useCallback((allowMotion = true) => {
    const element = ref.current;
    const content = contentRef.current;
    if (!element || !content) return;
    const view = element.ownerDocument.defaultView;
    if (element.ownerDocument.documentElement.dataset.pageTransition) allowMotion = false;
    const natural = content.getBoundingClientRect();
    const old = previous.current;
    const from = running.current ? element.getBoundingClientRect().height : old?.height;
    const sameWidth = old && Math.abs(old.width - natural.width) < 1;
    previous.current = { height: natural.height, width: natural.width };
    const reduce = view.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (allowMotion && !pointerHeld.current && sameWidth && !reduce
      && running.current && Math.abs(running.current.to - natural.height) < 1) return;
    stop();
    if (!allowMotion || pointerHeld.current || !sameWidth || reduce || from === undefined
      || Math.abs(from - natural.height) < 1 || typeof element.animate !== 'function') return;
    const overflow = element.style.overflow;
    element.style.overflow = 'clip';
    const animation = element.animate([
      { height: from + 'px' }, { height: natural.height + 'px' },
    ], { duration: natural.height > from ? 320 : 240, easing, fill: 'both' });
    running.current = { element, animation, overflow, to: natural.height };
    animation.onfinish = () => {
      if (running.current?.animation === animation) measure(false);
    };
  }, [stop]);

  useLayoutEffect(() => { measure(); }, changes);

  useLayoutEffect(() => {
    const element = ref.current;
    const content = contentRef.current;
    if (!element || !content) return;
    const view = element.ownerDocument.defaultView;
    const preference = view.matchMedia?.('(prefers-reduced-motion: reduce)');
    const settle = () => measure(false);
    const reduce = () => { if (preference.matches) settle(); };
    const hold = () => { pointerHeld.current = true; };
    const release = () => { pointerHeld.current = false; };
    // 拖动输入框和横竖屏切换直接跟手；点击造成的高度变化才播放过渡。
    const observer = view.ResizeObserver ? new view.ResizeObserver(() => measure()) : null;
    observer?.observe(content);
    view.addEventListener('resize', settle);
    view.addEventListener('pointerdown', hold);
    view.addEventListener('pointerup', release);
    view.addEventListener('pointercancel', release);
    preference?.addEventListener('change', reduce);
    return () => {
      stop();
      observer?.disconnect();
      view.removeEventListener('resize', settle);
      view.removeEventListener('pointerdown', hold);
      view.removeEventListener('pointerup', release);
      view.removeEventListener('pointercancel', release);
      preference?.removeEventListener('change', reduce);
    };
  }, [measure, stop]);

  return { ref, contentRef };
}
