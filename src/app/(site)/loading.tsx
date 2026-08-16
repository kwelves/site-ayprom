import Image from "next/image";

export default function PublicLoading() {
  return (
    <div className="fixed inset-0 z-[100] flex min-h-dvh flex-col bg-inverse px-6" role="status">
      <div className="flex flex-1 items-center justify-center pb-12">
        <Image
          src="/brand/ayprom-logo.svg"
          alt="AYPROM"
          width={378}
          height={90}
          priority
          unoptimized
          className="w-[min(78vw,26rem)] animate-pop-in"
        />
      </div>
      <div
        className="mb-8 h-1 overflow-hidden rounded-full bg-inverse-border sm:mb-10"
        role="progressbar"
        aria-label="Загрузка сайта"
        aria-valuetext="Загрузка"
      >
        <div className="h-full w-2/5 rounded-full bg-primary animate-site-loading-progress" />
      </div>
      <span className="sr-only">Загрузка сайта</span>
    </div>
  );
}
