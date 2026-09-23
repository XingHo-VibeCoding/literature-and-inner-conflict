import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  bookCategories, categoryLabel, getBook, listBooks, situationTags, directionTags,
  buildRecommendations, resolveRecommendationContext,
} from '../services/catalog.js';
import { readReadingData } from '../services/localStore.js';
import { filterPersonalBooks } from '../services/readingModel.js';
import BookReadingPanel from './BookReadingPanel.jsx';
import { createDemoExplanation, explanationKey, hasDemoExplanation } from '../services/explanationDemo.js';

const personalViews = [
  { id: 'all', label: '全部书目' },
  { id: 'favorites', label: '我的收藏' },
  { id: 'noted', label: '有备注' },
];

function BookTypes({ book }) {
  return (
    <p className="book-types">
      {book.categories.map(categoryLabel).join(' · ')}
      {book.literaryForms?.length > 0 && ` / ${book.literaryForms.join('、')}`}
    </p>
  );
}

export default function BooksPage({ path, browse, onBrowseChange, listPosition, detailContext, onDraftChange }) {
  const { category, situationTagId, directionTagId, view, results, errors, notice } = browse;
  const isList = path === '/books';
  const book = isList ? null : getBook(path.slice('/books/'.length));
  const [reading, setReading] = useState({ favorites: [], notes: [], status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [explanations, setExplanations] = useState({});
  const [explanationError, setExplanationError] = useState(null);
  const books = filterPersonalBooks(listBooks(category), view, reading);
  const personalView = view === 'favorites' || view === 'noted';
  const viewTitle = personalViews.find((item) => item.id === view)?.label || '全部书目';
  const resolvedContext = resolveRecommendationContext(detailContext, results);
  const activeContext = resolvedContext?.bookId === book?.id ? resolvedContext : null;
  const activeExplanationKey = explanationKey(activeContext);
  const activeExplanation = activeExplanationKey ? explanations[activeExplanationKey] : null;
  const heading = useRef(null);
  const list = useRef(null);

  useEffect(() => {
    let active = true;
    setReading((previous) => ({ ...previous, status: 'loading' }));
    readReadingData().then((data) => {
      if (active) setReading({ ...data, status: 'ready' });
    }).catch(() => {
      if (active) setReading((previous) => ({ ...previous, status: 'error' }));
    });
    return () => { active = false; };
  }, [path, reloadKey]);

  function updateReading(name, value) {
    setReading((previous) => ({
      ...previous,
      [name]: [...previous[name].filter((item) => item.bookId !== book.id), ...(value ? [value] : [])],
    }));
  }

  const readingStatus = reading.status !== 'ready' && (
    reading.status === 'loading' ? <p role="status">正在读取收藏和备注…</p> : (
      <div className="error-panel" role="alert">
        <p>收藏和备注读取失败，当前无法确认个人保存状态。原有数据没有清空。</p>
        <button type="button" onClick={() => setReloadKey((value) => value + 1)}>重新读取</button>
      </div>
    )
  );

  useLayoutEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  useLayoutEffect(() => {
    if (isList) {
      if (reading.status === 'loading') return;
      const selectedLink = [...list.current.querySelectorAll('a[data-book-key]')]
        .find((link) => link.dataset.bookKey === listPosition.current.bookKey);
      selectedLink?.focus({ preventScroll: true });
      window.scrollTo({ top: listPosition.current.top, behavior: 'instant' });
      const rememberScroll = () => { listPosition.current.top = window.scrollY; };
      window.addEventListener('scroll', rememberScroll);
      return () => window.removeEventListener('scroll', rememberScroll);
    }
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [path, category, view, results, isList, listPosition, reading.status]);

  function rememberBook(event, id, groupId) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    listPosition.current = { top: window.scrollY, bookKey: `${groupId || 'all'}:${id}` };
  }

  function changeConditions(patch) {
    setExplanations({});
    setExplanationError(null);
    listPosition.current = { top: 0, bookKey: null };
    onBrowseChange((previous) => ({
      ...previous, ...patch, results: null, errors: {},
      notice: previous.results || previous.view === 'recommendations'
        ? '条件已改变，请重新查看两类推荐。' : '',
    }));
  }

  function showRecommendations(event) {
    event.preventDefault();
    const next = buildRecommendations({ category, situationTagId, directionTagId });
    if (!next.results) {
      onBrowseChange((previous) => ({ ...previous, errors: next.errors, notice: '' }));
      return;
    }
    listPosition.current = { top: 0, bookKey: null };
    setExplanations({});
    setExplanationError(null);
    onBrowseChange((previous) => ({
      ...previous, ...next,
      results: { ...next.results, selectionId: crypto.randomUUID() },
      view: 'recommendations', notice: '已按本次选择更新两类推荐，每组最多展示 3 本。',
    }));
  }

  function showAllBooks() {
    showView('all');
  }

  function showView(nextView) {
    listPosition.current = { top: 0, bookKey: null };
    onBrowseChange((previous) => ({ ...previous, view: nextView, errors: {}, notice: '' }));
  }

  function renderBookCard(item, groupId, baseReason) {
    const Title = groupId ? 'h4' : 'h3';
    return (
      <article className="book-card" key={item.id}>
        <BookTypes book={item} />
        <Title>
          <a href={`#/books/${item.id}`} data-book-key={`${groupId || 'all'}:${item.id}`}
            data-recommendation-group={groupId}
            onClick={(event) => rememberBook(event, item.id, groupId)}>{item.title}</a>
        </Title>
        <p className="book-author">{item.author}</p>
        {reading.status === 'ready' && (
          <p className="reading-badges">
            {reading.favorites.some((value) => value.bookId === item.id) && <span>已收藏</span>}
            {reading.notes.some((value) => value.bookId === item.id) && <span>有备注</span>}
          </p>
        )}
        <p>{item.intro}</p>
        {baseReason && (
          <div className="match-reason">
            <p className="reason-label">阅读联系（依据主题整理）</p>
            <p>{baseReason}</p>
            <a href={item.sources[0].url} target="_blank" rel="noopener noreferrer"
              aria-label={`查看《${item.title}》资料来源（新标签页）`}>资料来源 ↗</a>
          </div>
        )}
        <a className="book-open" href={`#/books/${item.id}`} aria-label={`查看《${item.title}》详情`}
          data-recommendation-group={groupId}
          onClick={(event) => rememberBook(event, item.id, groupId)}>查看详情 →</a>
      </article>
    );
  }

  function showDemoExplanation() {
    try {
      const explanation = createDemoExplanation(book, activeContext, results);
      if (!explanation) return;
      setExplanations((current) => ({ ...current, [explanation.contextKey]: explanation }));
      setExplanationError(null);
    } catch (error) {
      setExplanationError({ contextKey: activeExplanationKey, message: error.message });
    }
  }

  if (!isList) {
    return (
      <div className="books-page">
        <a className="back-link" href="#/books" onClick={() => {
          if (activeContext) onBrowseChange((previous) => ({ ...previous, view: 'recommendations' }));
        }}>← 返回书单</a>
        {book ? (
          <article className="book-detail" aria-labelledby="book-title">
            <p className="eyebrow">作品详情</p>
            <h2 id="book-title" ref={heading} tabIndex={-1}>{book.title}</h2>
            <p className="book-author">作者／编纂：{book.author}</p>
            <BookTypes book={book} />
            {activeContext && (
              <section className="match-reason" aria-label="本次推荐理由">
                <h3>{activeContext.groupTitle}</h3>
                <p className="scope-note">本次处境：{results.situationLabel}；改变方向：{results.directionLabel}；作品类型：{categoryLabel(results.conditions.category)}。</p>
                <p>{activeContext.baseReason}</p>
              </section>
            )}
            {activeContext && <section className="demo-explanation" aria-label="本次阅读讲解演示">
              <h3>阅读讲解 · 固定演示</h3>
              <p className="scope-note">真实 AI 讲解尚未接入。演示内容依据下方资料和本次选择编写，仅在这次浏览中显示；不读取日精进、收藏或备注。</p>
              {hasDemoExplanation(book, activeContext) ? (
                <button type="button" onClick={showDemoExplanation}>
                  {activeExplanation ? '重新查看固定演示讲解' : '查看固定演示讲解'}
                </button>
              ) : <p>这个组合暂没有固定演示讲解。仍可核对上方推荐理由与下方作品资料。</p>}
              {explanationError?.contextKey === activeExplanationKey && <p className="field-error" role="alert">{explanationError.message}</p>}
              {activeExplanation && <div className="demo-explanation-result" role="status">
                <p className="reason-label">固定演示文字，非真实 AI 生成</p>
                <p>{activeExplanation.explanation}</p>
                <p><strong>阅读问题：</strong>{activeExplanation.readingQuestion}</p>
                <a href={book.sources[0].url} target="_blank" rel="noopener noreferrer">
                  核对《{book.title}》资料来源（新标签页） ↗
                </a>
              </div>}
            </section>}
            <h3>作品简介</h3>
            <p>{book.intro}</p>
            <h3>作品涉及的主题</h3>
            <ul>{book.topics.map((topic) => <li key={topic}>{topic}</li>)}</ul>
            <h3>资料来源</h3>
            <ul className="book-sources">
              {book.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.name}（新标签页）
                  </a>
                </li>
              ))}
            </ul>
            <p className="scope-note">简介、主题与阅读联系由 AI 依据所列资料整理，供你核对；未引用作品原文。推荐只使用你本次选择的条件，不读取日精进原文。</p>
            {readingStatus}
            {reading.status === 'ready' && <BookReadingPanel key={`${book.id}:${reloadKey}`}
              book={book} favorite={reading.favorites.some((item) => item.bookId === book.id)}
              note={reading.notes.find((item) => item.bookId === book.id) || null}
              onSaved={updateReading} onReload={() => setReloadKey((value) => value + 1)}
              onDraftChange={onDraftChange} />}
          </article>
        ) : (
          <div className="book-detail">
            <h2 ref={heading} tabIndex={-1}>作品暂不可用</h2>
            <p>没有找到这件作品，或它的资料尚不完整。请返回书单选择作品。</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="books-page">
      <p>从一件作品开始，了解它关注的生活、思想与社会问题。</p>
      <fieldset className="book-filters">
        <legend>书目视图</legend>
        <div className="filter-options">
          {personalViews.map((item) => <button type="button" key={item.id}
            aria-pressed={view === item.id} onClick={() => showView(item.id)}>{item.label}</button>)}
        </div>
      </fieldset>
      <fieldset className="book-filters">
        <legend>作品类型</legend>
        <div className="filter-options">
          {bookCategories.map((item) => (
            <button type="button" key={item.id} aria-pressed={category === item.id}
              onClick={() => {
                if (category === item.id) return;
                changeConditions({ category: item.id });
              }}>
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>
      <form className="recommendation-form" onSubmit={showRecommendations} noValidate>
        <fieldset>
          <legend>选择本次阅读线索</legend>
          <p className="scope-note" id="selection-help">两项各选一个。选项代表你的本次选择，不会自动从日精进中推断。</p>
          <div className="selection-grid">
            <div>
              <label htmlFor="situation-tag">当前处境</label>
              <select id="situation-tag" value={situationTagId} aria-invalid={Boolean(errors.situation)}
                aria-describedby={errors.situation ? 'situation-error selection-help' : 'selection-help'}
                onChange={(event) => changeConditions({ situationTagId: event.target.value })}>
                <option value="">请选择当前处境</option>
                {situationTags.map((tag) => <option value={tag.id} key={tag.id}>{tag.label}</option>)}
              </select>
              {errors.situation && <p className="field-error" id="situation-error" role="alert">{errors.situation}</p>}
            </div>
            <div>
              <label htmlFor="direction-tag">改变方向</label>
              <select id="direction-tag" value={directionTagId} aria-invalid={Boolean(errors.direction)}
                aria-describedby={errors.direction ? 'direction-error selection-help' : 'selection-help'}
                onChange={(event) => changeConditions({ directionTagId: event.target.value })}>
                <option value="">请选择改变方向</option>
                {directionTags.map((tag) => <option value={tag.id} key={tag.id}>{tag.label}</option>)}
              </select>
              {errors.direction && <p className="field-error" id="direction-error" role="alert">{errors.direction}</p>}
            </div>
          </div>
          {errors.category && <p className="field-error" role="alert">{errors.category}</p>}
          <div className="record-actions">
            <button className="primary-button" type="submit">查看两类推荐</button>
            {view === 'recommendations' && <button type="button" onClick={showAllBooks}>返回全部书目</button>}
          </div>
          <p className="scope-note">推荐从符合类型筛选的全部书库中匹配，不受收藏或备注限制。阅读联系是供你核对的建议；不会调用 AI 服务或修改个人记录。</p>
        </fieldset>
      </form>
      {notice && <p className="recommendation-notice" role="status">{notice}</p>}
      {readingStatus}
      <div ref={list}>
        {view === 'recommendations' ? (
          <section aria-labelledby="recommendation-title">
            <h2 id="recommendation-title">两类推荐</h2>
            {results ? (
              <>
                <p className="recommendation-conditions">本次处境：{results.situationLabel}；改变方向：{results.directionLabel}；作品类型：{categoryLabel(results.conditions.category)}。</p>
                {results.groups.map((group) => (
                  <section className="recommendation-group" key={group.id} aria-labelledby={`group-${group.id}`}>
                    <h3 id={`group-${group.id}`}>{group.title}</h3>
                    <p className="scope-note">匹配 {group.totalMatches} 本，本组展示 {group.items.length} 本。</p>
                    {group.items.length ? (
                      <div className="book-grid">
                        {group.items.map((item) => renderBookCard(getBook(item.bookId), group.id, item.baseReason))}
                      </div>
                    ) : <p className="empty-recommendations">暂无匹配作品。可以调整当前处境、改变方向或作品类型，再次查看。</p>}
                  </section>
                ))}
              </>
            ) : <p>请核对上方两项选择和作品类型，再点击“查看两类推荐”。</p>}
          </section>
        ) : (
          <>
            <div className="book-list-heading">
              <h2>{viewTitle}</h2>
              {(!personalView || reading.status === 'ready') && <p role="status">{categoryLabel(category)} · {books.length} 本</p>}
            </div>
            <p className="scope-note">首批收录 {listBooks().length} 本作品；同一作品可以属于多个类型。</p>
            {(!personalView || reading.status === 'ready') && <div className="book-grid">
              {books.map((item) => renderBookCard(item))}
              {books.length === 0 && (
                <div className="book-detail">
                  <p>{personalView ? `“${viewTitle}”中没有符合当前类型的作品。` : '没有符合此类型的作品。'}</p>
                  <div className="record-actions">
                    {category !== 'all' && <button type="button" onClick={() => changeConditions({ category: 'all' })}>清除类型筛选</button>}
                    <button type="button" onClick={() => changeConditions({ category: 'all', view: 'all' })}>返回全部书目</button>
                  </div>
                </div>
              )}
            </div>}
          </>
        )}
      </div>
    </div>
  );
}
