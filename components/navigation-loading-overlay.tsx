"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { APP_NAME } from "@/lib/app-config";

export function NavigationLoadingOverlay() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setIsLoading(false);
  }, [routeKey]);

  useEffect(() => {
    function showLoading() {
      setIsLoading(true);
    }

    function hideLoading() {
      setIsLoading(false);
    }

    window.addEventListener("app:navigation-start", showLoading);
    window.addEventListener("app:navigation-end", hideLoading);
    window.addEventListener("pageshow", hideLoading);

    return () => {
      window.removeEventListener("app:navigation-start", showLoading);
      window.removeEventListener("app:navigation-end", hideLoading);
      window.removeEventListener("pageshow", hideLoading);
    };
  }, []);

  if (!isLoading) {
    return null;
  }

  return (
    <div className="navigationLoadingOverlay" role="status" aria-live="polite">
      <div className="loadingScreen">
        <div className="loadingBackdrop">
          <div className="loadingHeader">
            <p className="eyebrow">{APP_NAME}</p>
            <h1>Loading</h1>
            <p className="sidebarCopy">Getting the latest vehicle records ready...</p>
          </div>

          <div className="duckPond" aria-hidden="true">
            <div className="pondWater pondWaterBack" />
            <div className="duckSwimmer">
              <span className="duckFloatRing" />
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
          </div>

          <p className="loadingCopy">Duck is on the way...</p>
        </div>
      </div>
    </div>
  );
}
