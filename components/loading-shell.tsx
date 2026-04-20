type LoadingShellProps = {
  title?: string;
  subtitle?: string;
};

export function LoadingShell({
  title = "Loading",
  subtitle = "Getting the latest vehicle records ready...",
}: LoadingShellProps) {
  return (
    <div className="loadingScreen" role="status" aria-live="polite">
      <div className="loadingBackdrop">
        <div className="loadingHeader">
          <p className="eyebrow">Vehicle Borrow</p>
          <h1>{title}</h1>
          <p className="sidebarCopy">{subtitle}</p>
        </div>

        <div className="duckPond" aria-hidden="true">
          <div className="pondWater pondWaterBack" />
          <div className="duckSwimmer">
            <span className="duckIllustration">
              <span className="duckTail" />
              <span className="duckBody" />
              <span className="duckWing" />
              <span className="duckNeck" />
              <span className="duckHead">
                <span className="duckEye" />
                <span className="duckBeak" />
              </span>
            </span>
            <span className="duckRipple duckRippleOne" />
            <span className="duckRipple duckRippleTwo" />
          </div>
          <div className="pondWater pondWaterFront" />
        </div>

        <p className="loadingCopy">Duck is on the way...</p>
      </div>
    </div>
  );
}
