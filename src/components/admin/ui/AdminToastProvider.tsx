"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Toast, type ToastTone } from "@/components/admin/ui/Toast";

interface AdminToastApi {
  showToast: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const EMPTY_API: AdminToastApi = {
  showToast: () => undefined,
  success: () => undefined,
  error: () => undefined,
};

const AdminToastContext = createContext<AdminToastApi>(EMPTY_API);

export function AdminToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; tone: ToastTone } | null>(null);
  const nextToastId = useRef(0);

  const showToast = useCallback((message: string, tone: ToastTone = "success") => {
    setToast({ id: ++nextToastId.current, message, tone });
  }, []);
  const success = useCallback((message: string) => showToast(message, "success"), [showToast]);
  const error = useCallback((message: string) => showToast(message, "error"), [showToast]);
  const api = useMemo(() => ({ showToast, success, error }), [error, showToast, success]);

  return (
    <AdminToastContext.Provider value={api}>
      {children}
      <Toast key={toast?.id} message={toast?.message ?? null} tone={toast?.tone} onDismiss={() => setToast(null)} />
    </AdminToastContext.Provider>
  );
}

export function useAdminToast() {
  return useContext(AdminToastContext);
}
