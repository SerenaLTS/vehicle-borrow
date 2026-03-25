export default function BorrowLoading() {
  return (
    <div className="pageShell">
      <aside className="sidebar">
        <div className="sidebarTop">
          <div>
            <p className="eyebrow">Vehicle Borrow</p>
            <h1>Borrow</h1>
            <p className="sidebarCopy">Loading available vehicles...</p>
          </div>
        </div>
      </aside>

      <main className="content">
        <section className="panel skeletonBlock" />
        <section className="panel skeletonBlock" />
      </main>
    </div>
  );
}
