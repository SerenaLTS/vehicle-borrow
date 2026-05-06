type DuckLoaderProps = {
  label?: string;
};

export function DuckLoader({ label }: DuckLoaderProps) {
  return (
    <span className="miniDuckLoader" role="status" aria-live="polite">
      <span className="miniDuckPond" aria-hidden="true">
        <span className="miniDuckWater" />
        <span className="miniDuckScale">
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
        </span>
      </span>
      {label ? <span>{label}</span> : null}
    </span>
  );
}
