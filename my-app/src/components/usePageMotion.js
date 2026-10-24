import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import homeDesktop from '../assets/home/landscape-desktop.webp';
import homeMobile from '../assets/home/landscape-mobile.webp';
import journalDesktop from '../assets/journal/river-town-desktop.webp';
import journalMobile from '../assets/journal/river-town-mobile.webp';
import booksDesktop from '../assets/books/study-desktop.webp';
import booksMobile from '../assets/books/study-mobile.webp';

// 详情沿用书房主题；路由与历史标识仍保留完整作品地址。
const themePath = path => path.startsWith('/books/') ? '/books' : path;

const themes = { '/': 'landscape', '/journal': 'river-town', '/books': 'study' };
const backgrounds = {
  '/': [homeDesktop, homeMobile],
  '/journal': [journalDesktop, journalMobile],
  '/books': [booksDesktop, booksMobile],
};

// 页面只挂载一次；只交叠原背景图片，不复制表单、不缩放固定画卷。
export default function usePageMotion(path) {
  const targetPath = useRef(path);
  const displayedPath = useRef(path);
  const sequence = useRef(0);
  const active = useRef(null);
  const images = useRef(new Map());

  function prepareBackground(nextPath) {
    const nextThemePath = themePath(nextPath);
    const sources = backgrounds[nextThemePath];
    if (!sources || !window.Image) return Promise.resolve();
    const breakpoint = nextThemePath === '/journal' ? 760 : 700;
    const source = sources[window.matchMedia?.('(max-width: ' + breakpoint + 'px)').matches ? 1 : 0];
    if (!images.current.has(source)) {
      const image = new window.Image();
      image.src = source;
      images.current.set(source, image.decode ? image.decode().catch(() => {}) : Promise.resolve());
    }
    return images.current.get(source);
  }

  useEffect(() => {
    // 提前准备当前屏宽的三幅原图；不改变画面、不等待网络才响应点击。
    Object.keys(backgrounds).forEach(prepareBackground);
    return () => {
      sequence.current += 1;
      active.current?.cancel();
      active.current = null;
      delete document.documentElement.dataset.pageTransition;
    };
  }, []);

  function transitionTo(nextPath, update, { startAtTop = false } = {}) {
    const id = ++sequence.current;
    const nextTheme = themes[themePath(nextPath)];
    const eligible = themes[themePath(displayedPath.current)] && nextTheme;
    const shell = document.querySelector('.app-shell');
    const main = shell?.querySelector('main');
    const footer = shell?.querySelector('.site-footer');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const canAnimate = eligible && !reduced && main?.animate && document.visibilityState !== 'hidden';
    const startOpacity = canAnimate ? window.getComputedStyle(main).opacity : 1;
    targetPath.current = nextPath;
    // 连点时保留当前背景混合比例，新一轮从眼前画面接续。
    let veil = active.current?.cancel(Boolean(canAnimate)) || null;
    active.current = null;
    delete document.documentElement.dataset.pageTransition;
    prepareBackground(nextPath);
    let committed = false;
    const commit = () => {
      if (sequence.current !== id || committed) return false;
      committed = true;
      flushSync(update);
      displayedPath.current = nextPath;
      if (startAtTop) window.scrollTo({ top: 0, behavior: 'instant' });
      return true;
    };

    if (!canAnimate) {
      commit();
      return;
    }

    const background = window.getComputedStyle(shell, '::before');
    const oldBackground = background.background;
    const oldHeight = background.height;
    const wasInert = main.inert;
    const oldMinHeight = main.style.minHeight;
    const oldMainHeight = main.getBoundingClientRect().height;
    let layoutFrame = 0;
    const animations = [];
    let finished = false;
    const cancel = (preserveBackground = false) => {
      // 先留住当前透明度，再取消动画；旧回调不能清理下一轮的画面。
      if (preserveBackground && veil) veil.style.opacity = window.getComputedStyle(veil).opacity;
      window.cancelAnimationFrame(layoutFrame);
      animations.forEach((animation) => animation.cancel());
      main.style.minHeight = oldMinHeight;
      main.inert = wasInert;
      if (!preserveBackground) veil?.remove();
      return preserveBackground ? veil : null;
    };
    const finish = () => {
      if (sequence.current !== id || finished) return;
      finished = true;
      cancel();
      active.current = null;
      delete document.documentElement.dataset.pageTransition;
    };
    const recover = () => {
      if (sequence.current !== id || finished) return;
      main.inert = wasInert;
      commit();
      finish();
    };

    active.current = { cancel };
    document.documentElement.dataset.pageTransition = nextTheme;
    const enter = () => {
      if (sequence.current !== id) return;
      try {
        const backgroundLayer = document.createElement('div');
        backgroundLayer.className = 'page-background-veil';
        backgroundLayer.setAttribute('aria-hidden', 'true');
        backgroundLayer.style.background = oldBackground;
        backgroundLayer.style.height = oldHeight;
        // 连续切换时，把尚未淡完的画卷保留在原背景上，一起柔和退去。
        if (veil) backgroundLayer.append(veil);
        veil = backgroundLayer;
        shell.append(veil);
        // 新页的布局效果会恢复书卡焦点，必须在提交前解除旧页的输入锁。
        main.inert = wasInert;
        if (!commit()) return;
        const reveal = () => {
          if (sequence.current !== id || finished) return;
          try {
            const duration = nextPath === '/' ? 460 : nextPath === '/journal' ? 420 : 380;
            const backgroundFade = veil.animate([{ opacity: 1 }, { opacity: 0 }], {
              duration, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both',
            });
            const fades = [main, footer].filter(Boolean).map((element) => element.animate(
              [{ opacity: 0 }, { opacity: 1 }],
              { duration: 280, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' },
            ));
            animations.push(backgroundFade, ...fades);
            Promise.all([backgroundFade.finished, ...fades.map((animation) => animation.finished)]).then(finish, recover);
          } catch { recover(); }
        };
        // 正文保持透明，先完成初读、原有滚动恢复和两帧稳定布局，再显现。
        const started = window.performance.now();
        let previous = '';
        let stableFrames = 0;
        let releasedHeight = false;
        const settleLayout = () => {
          if (sequence.current !== id || finished) return;
          try {
            main.getAnimations?.({ subtree: true }).forEach((animation) => {
              if (animation.animationName === 'journal-reveal') animation.finish();
            });
            const elapsed = window.performance.now() - started;
            const ready = !main.querySelector('[data-page-ready="false"]');
            if (ready || elapsed >= 600) {
              if (!releasedHeight) {
                main.style.minHeight = oldMinHeight;
                releasedHeight = true;
                previous = '';
              }
              const rect = main.getBoundingClientRect();
              const signature = [rect.x, rect.y, rect.width, rect.height, window.scrollY].join(',');
              stableFrames = signature === previous ? stableFrames + 1 : 0;
              previous = signature;
              if (stableFrames >= 2 || elapsed >= 700) { reveal(); return; }
            }
            layoutFrame = window.requestAnimationFrame(settleLayout);
          } catch { recover(); }
        };
        layoutFrame = window.requestAnimationFrame(settleLayout);
      } catch {
        recover();
      }
    };

    try {
      main.style.minHeight = oldMainHeight + 'px';
      main.inert = true;
      const exit = main.animate([{ opacity: startOpacity }, { opacity: 0 }], {
        duration: 120, easing: 'ease-out', fill: 'both',
      });
      animations.push(exit);
      if (footer?.animate) animations.push(footer.animate(
        [{ opacity: window.getComputedStyle(footer).opacity }, { opacity: 0 }],
        { duration: 120, easing: 'ease-out', fill: 'both' },
      ));
      exit.finished.then(enter, recover);
    } catch {
      recover();
    }
  }

  return { transitionTo, targetPath };
}
