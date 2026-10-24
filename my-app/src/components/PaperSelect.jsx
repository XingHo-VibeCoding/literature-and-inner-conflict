import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// 阅读线索专用单选器：焦点始终留在触发器，选项高亮与已确认值分别管理。
export default function PaperSelect({
  id, labelId, value, options, placeholder, onChange, triggerRef,
  open, onOpenChange, invalid, describedBy,
}) {
  const root = useRef(null);
  const menu = useRef(null);
  const search = useRef({ text: '', time: 0 });
  const items = [{ id: '', label: placeholder }, ...options];
  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [placement, setPlacement] = useState({ side: 'below', room: 280 });
  const menuId = `${id}-options`;

  function close(restoreFocus = false) {
    onOpenChange(false);
    search.current = { text: '', time: 0 };
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }

  function reveal(index = selectedIndex) {
    setActiveIndex(index);
    search.current = { text: '', time: 0 };
    onOpenChange(true);
  }

  function choose(index) {
    close(true);
    if (items[index].id !== value) onChange(items[index].id);
  }

  useLayoutEffect(() => {
    if (!open) return;
    const element = triggerRef.current;
    const view = element.ownerDocument.defaultView;
    const updatePlacement = () => {
      const rect = element.getBoundingClientRect();
      const viewport = view.visualViewport;
      const top = viewport?.offsetTop || 0;
      const bottom = top + (viewport?.height || view.innerHeight);
      const below = bottom - rect.bottom - 16;
      const above = rect.top - top - 16;
      const needed = Math.min(menu.current.scrollHeight, 280);
      const side = below < needed && above > below ? 'above' : 'below';
      const room = Math.max(80, Math.min(280, side === 'above' ? above : below));
      setPlacement((previous) => previous.side === side && previous.room === room ? previous : { side, room });
    };
    const onScroll = (event) => {
      if (!menu.current?.contains(event.target)) updatePlacement();
    };
    updatePlacement();
    view.addEventListener('resize', updatePlacement);
    view.addEventListener('scroll', onScroll, true);
    view.visualViewport?.addEventListener('resize', updatePlacement);
    view.visualViewport?.addEventListener('scroll', updatePlacement);
    return () => {
      view.removeEventListener('resize', updatePlacement);
      view.removeEventListener('scroll', onScroll, true);
      view.visualViewport?.removeEventListener('resize', updatePlacement);
      view.visualViewport?.removeEventListener('scroll', updatePlacement);
    };
  }, [open, triggerRef]);

  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const option = menu.current.children[activeIndex];
    if (!option) return;
    // 只滚动选项纸面，不因键盘高亮带动整页。
    const start = option.offsetTop;
    const end = start + option.offsetHeight;
    if (start < menu.current.scrollTop) menu.current.scrollTop = start;
    else if (end > menu.current.scrollTop + menu.current.clientHeight) menu.current.scrollTop = end - menu.current.clientHeight;
  }, [activeIndex, open, placement.room]);

  useEffect(() => {
    if (!open) return;
    const document = root.current.ownerDocument;
    const outside = (event) => { if (!root.current.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, onOpenChange]);

  function onKeyDown(event) {
    if (event.isComposing) return;
    const key = event.key;
    if (key === 'Tab') { if (open) close(); return; }
    if (key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); close(true); }
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (open) choose(activeIndex); else reveal();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      let next;
      if (key === 'Home') next = 0;
      else if (key === 'End') next = items.length - 1;
      else next = Math.max(0, Math.min(items.length - 1, (open ? activeIndex : selectedIndex) + (key === 'ArrowDown' ? 1 : -1)));
      if (open) setActiveIndex(next); else reveal(next);
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const text = (now - search.current.time < 700 ? search.current.text : '') + key;
      const match = items.findIndex((item) => item.label.toLocaleLowerCase().startsWith(text.toLocaleLowerCase()));
      search.current = { text, time: now };
      if (match !== -1) {
        event.preventDefault();
        setActiveIndex(match);
        if (!open) onOpenChange(true);
      }
    }
  }

  return (
    <div className="paper-select" ref={root} data-open={open} data-placement={placement.side}
      style={{ '--paper-select-room': `${placement.room}px` }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
      <button type="button" id={id} ref={triggerRef} className="paper-select-trigger" role="combobox"
        aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId}
        aria-labelledby={`${labelId} ${id}-value`} aria-required="true"
        aria-invalid={invalid} aria-describedby={describedBy}
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        onKeyDown={onKeyDown} onClick={() => open ? close() : reveal()}>
        <span id={`${id}-value`} className={value ? 'paper-select-value' : 'paper-select-placeholder'}>{items[selectedIndex].label}</span>
        <svg className="paper-select-arrow" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          <path d="m5 7 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div id={menuId} className="paper-select-menu" ref={menu} role="listbox" aria-labelledby={labelId}
        aria-hidden={!open} inert={!open}>
        {items.map((item, index) => (
          <div id={`${id}-option-${index}`} className="paper-select-option" key={item.id}
            role="option" aria-selected={value === item.id} data-active={activeIndex === index}
            onPointerMove={(event) => { if (open && event.pointerType === 'mouse') setActiveIndex(index); }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { if (open) choose(index); }}>
            <span>{item.label}</span>
            <svg className="paper-select-check" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="m4 10 4 4 8-8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}
