import { useCallback, useLayoutEffect, useRef } from 'react';

const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
const heightOf = (element) => element.getBoundingClientRect().height;

// 只改变面板高度，不缩放文字或画面；连点时从当前可见高度接续。
function useHeightAnimation() {
  const ref = useRef(null);
  const running = useRef(null);

  const stop = useCallback((settle = false) => {
    const current = running.current;
    if (!current) return;
    running.current = null;
    current.animation.onfinish = null;
    current.animation.cancel();
    current.element.style.overflow = current.overflow;
    if (settle) current.complete?.();
  }, []);

  const animate = useCallback((from, to, complete) => {
    const element = ref.current;
    stop();
    if (!element) return;
    if (Math.abs(from - to) < 1 || typeof element.animate !== 'function'
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      complete?.();
      return;
    }
    const overflow = element.style.overflow;
    element.style.overflow = 'clip';
    const animation = element.animate([
      { height: from + 'px' }, { height: to + 'px' },
    ], { duration: to > from ? 320 : 240, easing, fill: 'both' });
    running.current = { animation, element, overflow, complete };
    animation.onfinish = () => {
      if (running.current?.animation === animation) stop(true);
    };
  }, [stop]);

  useLayoutEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const settle = () => stop(true);
    const reduce = () => { if (preference.matches) settle(); };
    window.addEventListener('resize', settle);
    preference?.addEventListener('change', reduce);
    return () => {
      stop();
      window.removeEventListener('resize', settle);
      preference?.removeEventListener('change', reduce);
    };
  }, [stop]);

  return { ref, running, stop, animate };
}

// React 仍即时卸载收起的表单、清空敏感输入，外框平滑回到自然高度。
export function useAutoHeightMotion(changes) {
  const { ref, running, stop, animate } = useHeightAnimation();
  const previous = useRef(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const from = running.current ? heightOf(element) : previous.current;
    stop();
    const to = heightOf(element);
    previous.current = to;
    if (from !== null) animate(from, to);
  }, changes);

  useLayoutEffect(() => {
    const remember = () => { previous.current = ref.current ? heightOf(ref.current) : null; };
    window.addEventListener('resize', remember);
    return () => window.removeEventListener('resize', remember);
  }, []);

  return ref;
}

// 保留原生 details / summary 的键盘操作；收起完成后才关闭内容区。
export function useDetailsMotion() {
  const motion = useHeightAnimation();
  const targetOpen = useRef(null);

  function onClick(event) {
    const element = motion.ref.current;
    const summary = event.target.closest('summary');
    if (!element || summary?.parentElement !== element || event.defaultPrevented) return;
    event.preventDefault();

    const opening = !(targetOpen.current ?? element.open);
    const from = heightOf(element);
    motion.stop();
    targetOpen.current = opening;
    element.open = true;
    const content = element.querySelector('.home-record-content');
    if (content) content.inert = !opening;
    summary.setAttribute('aria-expanded', String(opening));

    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    const frame = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((sum, name) => sum + (parseFloat(style[name]) || 0), 0);
    const to = opening ? heightOf(element) : heightOf(summary) + frame;

    motion.animate(from, to, () => {
      element.open = opening;
      if (content) content.inert = !opening;
      summary.removeAttribute('aria-expanded');
      targetOpen.current = null;
    });
  }

  return { ref: motion.ref, onClick };
}
