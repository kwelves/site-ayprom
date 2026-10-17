import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import { applyAdminTheme, readStoredAdminTheme } from "@/lib/admin/theme";
import { AdminApp } from "./AdminApp";

// Before the first paint, so a dark-theme user never sees a light flash.
applyAdminTheme(readStoredAdminTheme());

createRoot(document.getElementById("root") as HTMLElement).render(<AdminApp />);
