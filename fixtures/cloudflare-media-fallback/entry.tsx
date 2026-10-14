import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { ImageFallback } from "@/components/ui/ImageFallback";

const master = new URLSearchParams(location.search).get("master") === "missing" ? "/missing-master.jpg" : "/master.jpg";
const root = document.getElementById("root");
if (!root) throw new Error("probe_root_missing");

createRoot(root).render(createElement("div", { style: { position: "relative", width: 300, height: 220 } },
  createElement(ImageFallback, {
    src: "/variant.webp", fallbackSrc: master, alt: "Probe product", sizes: "300px", unoptimized: true,
    onLoad: () => { document.body.dataset.ready = String(Number(document.body.dataset.ready ?? 0) + 1); },
    onError: () => { document.body.dataset.failed = String(Number(document.body.dataset.failed ?? 0) + 1); },
  })));
