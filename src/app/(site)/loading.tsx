import Image from "next/image";

export default function PublicLoading() {
  return (
    // loading.tsx replaces the route content while the shared footer stays
    // mounted. Reserve one viewport in normal flow so the footer starts below
    // the visible area and cannot jump when a long catalog page streams in.
    <div className="min-h-[calc(100svh-4rem)]">
      <div className="fixed inset-0 z-[100] flex min-h-dvh items-center justify-center bg-background px-6" role="status">
        <div className="flex w-full max-w-48 flex-col items-center gap-7">
          <Image
            src="/brand/ayprom-logo.svg"
            alt="AYPROM"
            width={378}
            height={90}
            preload
            unoptimized
            className="w-48 animate-pop-in"
          />
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface-strong"
            role="progressbar"
            aria-label="Загрузка сайта"
            aria-valuetext="Загрузка"
          >
            <div className="h-full w-2/5 rounded-full bg-primary animate-site-loading-progress" />
          </div>
        </div>
        <span className="sr-only">Загрузка сайта</span>
      </div>
    </div>
  );
}
