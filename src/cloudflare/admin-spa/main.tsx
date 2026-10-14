import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import { AdminApp } from "./AdminApp";

createRoot(document.getElementById("root") as HTMLElement).render(<AdminApp />);
