"use client";

import { useEffect, useRef, useState } from "react";

interface UseInViewOnceOptions {
  margin?: string;
}

/**
 * Плейн IntersectionObserver вместо framer-motion whileInView: срабатывает
 * один раз и снимает наблюдатель, JS не требуется до пересечения вьюпорта.
 * Если IntersectionObserver недоступен (SSR, старый браузер) — элемент сразу
 * считается видимым, чтобы контент не оставался скрытым.
 */
export function useInViewOnce<T extends HTMLElement>({ margin = "0px" }: UseInViewOnceOptions = {}) {
  const ref = useRef<T | null>(null);
  // Всегда стартует со `false`: сервер не знает положения элемента во
  // вьюпорте, так что серверный и первый клиентский рендер обязаны совпасть.
  // Ленивый `typeof IntersectionObserver === "undefined"` здесь недопустим —
  // на сервере глобала нет вообще, проверка была бы true и рвала гидратацию.
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      // Старый браузер без поддержки — микротаска вместо синхронного
      // setState в теле эффекта, чтобы не ловить cascading-render варнинг.
      queueMicrotask(() => setIsInView(true));
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [margin]);

  return { ref, isInView };
}
