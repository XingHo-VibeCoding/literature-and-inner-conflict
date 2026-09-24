import { useEffect, useRef, useState } from 'react';
import JournalPage from './pages/JournalPage.jsx';
import BooksPage from './pages/BooksPage.jsx';
import HomePage from './pages/HomePage.jsx';
import { getBook, getRecommendationContext } from './services/catalog.js';

const sections = {
  '/journal': {
    title: '自总结投放分析',
    description: '留下今天的感受、想法与实际行动，逐渐看清自己的经历。',
    placeholder: '这里将用于输入日精进、查看分析和回看记录。',
  },
  '/books': {
    title: '书单推荐讲解',
    description: '从文学、哲学和人文社科作品中，寻找映照当下与探索改变的阅读线索。',
    placeholder: '这里将用于浏览书目、选择处境与方向，以及查看作品详情。',
  },
};

function readPath() {
  return window.location.hash.slice(1) || '/';
}

export default function App() {
  const [path, setPath] = useState(readPath);
  const [journalDraft, setJournalDraft] = useState({ dirty: false, saving: false });
  const [bookDraft, setBookDraft] = useState({ dirty: false, saving: false });
  const [pendingPath, setPendingPath] = useState(null);
  const [navigationMessage, setNavigationMessage] = useState('');
  const leaveDialog = useRef(null);
  const [bookBrowse, setBookBrowse] = useState({
    category: 'all', situationTagId: '', directionTagId: '',
    view: 'all', results: null, errors: {}, notice: '',
  });
  const bookListPosition = useRef({ top: 0, bookKey: null });
  const [bookDetailContext, setBookDetailContext] = useState(null);
  const bookVisits = useRef(new Map());
  const activeHistoryState = useRef(window.history.state);
  const isBooks = path === '/books' || path.startsWith('/books/');
  const section = sections[isBooks ? '/books' : path];
  const detailTitle = isBooks && path !== '/books'
    ? getBook(path.slice('/books/'.length))?.title || '作品暂不可用'
    : null;
  const isHome = path === '/';
  const activeDraft = path === '/journal' ? journalDraft : isBooks ? bookDraft : { dirty: false, saving: false };

  useEffect(() => {
    const onHashChange = () => {
      const nextPath = readPath();
      const context = bookVisits.current.get(window.history.state?.bookVisitId) || null;
      if (nextPath === path) {
        setBookDetailContext(context);
        return;
      }
      if (activeDraft.dirty || activeDraft.saving) {
        window.history.replaceState(activeHistoryState.current, '', `#${path}`);
        if (activeDraft.saving) setNavigationMessage('正在保存，请等待结果后再离开。');
        else setPendingPath({ path: nextPath, context });
      } else {
        activeHistoryState.current = window.history.state;
        setPath(nextPath);
        setBookDetailContext(context);
        if (context?.position) bookListPosition.current = { ...context.position };
        setJournalDraft({ dirty: false, saving: false });
        setBookDraft({ dirty: false, saving: false });
      }
    };
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('popstate', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('popstate', onHashChange);
    };
  }, [path, journalDraft, bookDraft]);

  useEffect(() => {
    if (pendingPath !== null) leaveDialog.current.showModal();
    else leaveDialog.current.close();
  }, [pendingPath]);

  function navigate(nextPath, context = null) {
    // 历史条目只存随机标识；推荐上下文留在本页内存，刷新后不恢复。
    const visitId = context ? crypto.randomUUID() : null;
    if (context) bookVisits.current.set(visitId, context);
    activeHistoryState.current = visitId ? { bookVisitId: visitId } : null;
    window.history.pushState(activeHistoryState.current, '', `#${nextPath}`);
    setPath(nextPath);
    setBookDetailContext(context);
    setJournalDraft({ dirty: false, saving: false });
    setBookDraft({ dirty: false, saving: false });
    setNavigationMessage('');
  }

  function handleLinkClick(event) {
    const link = event.target.closest('a[href^="#/"]');
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const nextPath = link.getAttribute('href').slice(1);
    if (nextPath === path) return;
    if (activeDraft.saving) {
      setNavigationMessage('正在保存，请等待结果后再离开。');
    } else if (activeDraft.dirty) {
      setPendingPath({ path: nextPath, context: null });
    } else {
      const context = path === '/books' && bookBrowse.view === 'recommendations'
        ? getRecommendationContext(bookBrowse.results, link.dataset.recommendationGroup, nextPath.slice('/books/'.length))
        : null;
      navigate(nextPath, context ? { ...context, position: { ...bookListPosition.current } } : null);
    }
  }

  useEffect(() => {
    document.title = isHome
      ? '文学与内心冲突'
      : `${detailTitle || section?.title || '页面未找到'}｜文学与内心冲突`;
  }, [isHome, section, detailTitle]);

  return (
    <div className={`app-shell${isHome ? ' home-shell' : ''}`} onClick={handleLinkClick}>
      <header className="site-header">
        <a className="brand" href="#/">
          {isHome && <span className="home-brand-mark" aria-hidden="true">文</span>}
          文学与内心冲突
        </a>
        <span className="stage-label">{isHome ? '记录 · 阅读 · 回看' : '本地记录版'}</span>
      </header>

      <main>
        {navigationMessage && <p role="status">{navigationMessage}</p>}
        {isHome ? (
          <HomePage />
        ) : (
          <section className="section-page" aria-labelledby="section-title">
            <a className="back-link" href="#/">← 返回首页</a>
            <h1 id="section-title">{section?.title || '页面未找到'}</h1>
            {path === '/journal' ? <JournalPage onDraftChange={setJournalDraft} /> : isBooks ? (
              <BooksPage path={path} browse={bookBrowse} onBrowseChange={setBookBrowse}
                listPosition={bookListPosition} detailContext={bookDetailContext} onDraftChange={setBookDraft} />
            ) : (
              <p>这个地址还没有对应页面，请返回首页选择入口。</p>
            )}
          </section>
        )}
      </main>

      <dialog ref={leaveDialog} aria-labelledby="leave-title" onCancel={() => setPendingPath(null)}>
        <h2 id="leave-title">要放弃未保存的更改吗？</h2>
        <p>离开会丢弃这次尚未保存的输入，已保存的记录不受影响。</p>
        <div className="dialog-actions">
          <button type="button" autoFocus onClick={() => setPendingPath(null)}>继续编辑</button>
          <button type="button" onClick={() => { navigate(pendingPath.path, pendingPath.context); setPendingPath(null); }}>放弃更改</button>
        </div>
      </dialog>

      <footer className="site-footer">从自己的记录出发，让阅读与生活相互参照。</footer>
    </div>
  );
}
