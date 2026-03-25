export default function AdminLoading() {
  return (
    <div className="pageShell">
      <aside className="sidebar">
        <div className="sidebarTop">
          <div>
            <p className="eyebrow">Vehicle Borrow</p>
            <h1>Admin</h1>
            <p className="sidebarCopy">Loading admin data...</p>
          </div>
        </div>
      </aside>

      <main className="content">
        <section className="panel skeletonBlock" />
        <section className="panel skeletonBlock" />
        <section className="panel skeletonBlock" />
      </main>
    </div>
  );
}
