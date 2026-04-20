type LoadingShellProps = {
  title?: string;
  subtitle?: string;
};

export function LoadingShell({
  title = "Loading",
  subtitle = "Getting the latest vehicle records ready...",
}: LoadingShellProps) {
  return (
    <div className="pageShell">
      <aside className="sidebar">
        <div className="sidebarTop">
          <div>
            <p className="eyebrow">Vehicle Borrow</p>
            <h1>{title}</h1>
            <p className="sidebarCopy">{subtitle}</p>
          </div>
        </div>
      </aside>

      <main className="content">
        <section className="panel loadingPanel">
          <div className="duckLoader" aria-hidden="true">
            <div className="duckOrbit">
              <span className="duckEmoji">🦆</span>
            </div>
          </div>
          <p className="loadingCopy">One duck moment...</p>
        </section>

        <section className="panel skeletonBlock" />
        <section className="panel skeletonBlock" />
      </main>
    </div>
  );
}
