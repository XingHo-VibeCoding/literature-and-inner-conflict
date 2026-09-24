import { useEffect, useState } from 'react';
import { homeSections, readHomeMock } from '../services/homeMock.js';

const previewStates = [
  { id: 'content', label: '有内容' },
  { id: 'loading', label: '加载中' },
  { id: 'empty', label: '空数据' },
  { id: 'error', label: '读取错误' },
];

const updateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export default function HomePage() {
  const [request, setRequest] = useState({ scenario: 'content', version: 0 });
  const [view, setView] = useState({ status: 'loading', snapshot: null, error: '' });

  useEffect(() => {
    const controller = new AbortController();
    setView({ status: 'loading', snapshot: null, error: '' });
    // 仅本地预览可保持加载画面，方便人工检查；正常读取会自动结束等待。
    if (import.meta.env.DEV && request.scenario === 'loading') return () => controller.abort();
    readHomeMock({ scenario: request.scenario, signal: controller.signal }).then((snapshot) => {
      if (!controller.signal.aborted) {
        setView({ status: snapshot ? 'content' : 'empty', snapshot, error: '' });
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setView({ status: 'error', snapshot: null, error: error.message });
    });
    return () => controller.abort();
  }, [request]);

  function showScenario(scenario) {
    setView({ status: 'loading', snapshot: null, error: '' });
    setRequest((current) => ({ scenario, version: current.version + 1 }));
  }

  const snapshot = view.snapshot;

  return (
    <div className="home-page">
      <section className="home-introduction" aria-labelledby="home-title">
        <div>
          <p className="home-kicker"><span aria-hidden="true" /> 在文字里，慢慢靠近自己</p>
          <h1 id="home-title">文学与内心冲突</h1>
          <p className="home-intro-text">记录生活的褶皱，在文学、哲学与人文社科中，寻找理解自己的另一种目光。</p>
        </div>
        <div className="home-update">
          <span>示例内容更新时间</span>
          {snapshot ? <time dateTime={snapshot.updatedAt}>
            {updateFormatter.format(new Date(snapshot.updatedAt)).replaceAll('/', '.').replace(' ', ' · ')}
          </time> : <span>{view.status === 'loading' ? '正在读取…' : view.status === 'empty' ? '暂无示例更新时间' : '更新时间暂不可用'}</span>}
          <span>北京时间 · 首页虚构示例</span>
        </div>
      </section>

      <div className="home-workspace">
        <section className="home-state-card" aria-labelledby="home-state-title">
          <div className="home-card-heading">
            <p className="home-section-label">一页近况</p>
            <span className="home-demo-label">虚构示例</span>
          </div>
          <h2 id="home-state-title">此刻的自我</h2>
          <div className="home-state-body" aria-live="polite" aria-busy={view.status === 'loading'}>
            {view.status === 'loading' && <div className="home-state-message">
              <p className="home-state-heading" role="status">正在读取近况示例…</p>
              <p>文字正在铺开，请稍等片刻。</p>
              <div className="home-skeleton" aria-hidden="true"><span /><span /><span /></div>
            </div>}
            {view.status === 'content' && snapshot && <>
              <p className="home-summary-label">{snapshot.interpretation.label}</p>
              <p className="home-summary">{snapshot.interpretation.summary}</p>
              <p className="home-summary-detail">{snapshot.interpretation.detail}</p>
              <div className="home-original">
                <p className="home-original-label">虚构原文 · <time dateTime={snapshot.original.date}>
                  {snapshot.original.date.replaceAll('-', '.')}
                </time></p>
                <p>{snapshot.original.text}</p>
              </div>
            </>}
            {view.status === 'empty' && <div className="home-state-message">
              <p className="home-state-heading">还没有近况示例</p>
              <p>这个演示场景没有记录。可以从一段日精进开始，慢慢整理自己的感受与行动。</p>
              <a className="home-state-link" href="#/journal">写下第一段日精进 <span aria-hidden="true">→</span></a>
            </div>}
            {view.status === 'error' && <div className="home-state-message home-state-error">
              <div role="alert">
                <p className="home-state-heading">近况示例暂时没有读到</p>
                <p>{view.error}</p>
              </div>
              <button type="button" onClick={() => showScenario('content')}>重新读取示例</button>
            </div>}
          </div>
          <p className="home-state-note">首页仅展示虚构场景，不代表你的真实状态，也不用于判断长期变化。</p>
        </section>

        <section className="home-choices" aria-labelledby="home-choices-title">
          <div className="home-choices-heading">
            <p className="home-section-label">两个入口，一段与自己的对话</p>
            <h2 id="home-choices-title">今天，想从哪里开始？</h2>
            <p>可以先写下此刻，也可以先遇见一本书。</p>
          </div>
          <nav className="home-entry-grid" aria-label="两个主入口">
            {homeSections.map((section) => <a key={section.id}
              className={`home-entry-card home-entry-${section.id}`} href={section.href}
              aria-labelledby={`home-${section.id}-title`}>
              <div className="home-entry-top" aria-hidden="true">
                <svg viewBox="0 0 40 40" fill="none" className="home-entry-icon">
                  {section.iconPaths.map((path) => <path key={path} d={path} />)}
                </svg>
                <span>{section.number}</span>
              </div>
              <p className="home-entry-caption">{section.caption}</p>
              <h3 id={`home-${section.id}-title`}>{section.title}</h3>
              <p className="home-entry-description">{section.description}</p>
              <ul className="home-entry-features" aria-label={`${section.title}板块内容`}>
                {section.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              <span className="home-entry-action">{section.action} <span aria-hidden="true">↗</span></span>
            </a>)}
          </nav>
        </section>
      </div>

      <aside className="home-letter" aria-labelledby="home-letter-title">
        <div className="home-letter-heading">
          <span className="home-letter-mark" aria-hidden="true">予</span>
          <h2 id="home-letter-title">写在页边</h2>
          <span>我们的初心与祝愿</span>
        </div>
        <div className="home-letter-copy">
          <p>理解自己，或许始于允许一个问题暂时没有答案。</p>
          <p>我们想留下一处空间，让经历被认真记录，让阅读与生活相互照见。<br className="home-letter-break" />愿你在文字间获得片刻从容，带着对自己的善意，继续走向生活。</p>
        </div>
        <span className="home-letter-source">本站原创寄语</span>
      </aside>

      <p className="home-storage-note">你的记录、收藏和备注仅保存在当前浏览器；换设备不共享，清理浏览器数据后可能丢失。</p>

      {import.meta.env.DEV && <details className="home-preview-controls">
        <summary>首页状态演示</summary>
        <p>只切换首页的虚构场景，不读取或改动个人记录。“加载中”会保持等待画面，选择其他状态即可结束；刷新页面恢复有内容的示例。</p>
        <div className="home-preview-options" role="group" aria-label="选择首页演示状态">
          {previewStates.map((state) => <button type="button" key={state.id}
            aria-pressed={request.scenario === state.id} onClick={() => showScenario(state.id)}>{state.label}</button>)}
        </div>
      </details>}
    </div>
  );
}
