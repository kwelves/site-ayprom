import { describe, expect, it, vi } from "vitest";
import {
  PRODUCT_RPC_FALLBACK_MESSAGE,
  isIntentionalProductRpcError,
  toProductRpcError,
} from "@/lib/admin/product-rpc-error";

// QA-002: сообщение о конфликте версий бесполезно, если не доходит до
// администратора. Ошибки PostgREST в рантайме не являются экземплярами Error,
// поэтому общий getErrorMessage подменял бы их текст на «не удалось сохранить».
// Проверено на живом клиенте: `error instanceof Error` для них ложно.
describe("toProductRpcError", () => {
  it("передаёт дословно сообщение о конфликте версий", () => {
    const conflict = {
      code: "55000",
      message: "Товар был изменён другим администратором. Обновите страницу, чтобы увидеть актуальную версию.",
    };

    const error = toProductRpcError(conflict);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(conflict.message);
  });

  it("передаёт дословно сообщение проверки входа", () => {
    const validation = { code: "22023", message: "Один из выбранных брендов не найден." };

    expect(toProductRpcError(validation).message).toBe(validation.message);
  });

  it("скрывает неожиданную ошибку базы за общим текстом", () => {
    const unexpected = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "products_slug_key"',
      details: "Key (slug)=(pump) already exists.",
    };

    const error = toProductRpcError(unexpected);

    expect(error.message).toBe(PRODUCT_RPC_FALLBACK_MESSAGE);
    expect(error.message).not.toContain("products_slug_key");
  });

  it("отдаёт подробности неожиданной ошибки только в журнал", () => {
    const onUnexpected = vi.fn();
    const unexpected = { code: "42P01", message: 'relation "products" does not exist', details: "d" };

    toProductRpcError(unexpected, onUnexpected);

    expect(onUnexpected).toHaveBeenCalledWith({
      code: "42P01",
      message: 'relation "products" does not exist',
      details: "d",
    });
  });

  it("не вызывает журнал для намеренных сообщений", () => {
    const onUnexpected = vi.fn();

    toProductRpcError({ code: "55000", message: "Конфликт." }, onUnexpected);

    expect(onUnexpected).not.toHaveBeenCalled();
  });

  it("считает намеренной только пару из известного кода и непустого текста", () => {
    expect(isIntentionalProductRpcError({ code: "55000", message: "Есть текст." })).toBe(true);
    expect(isIntentionalProductRpcError({ code: "55000" })).toBe(false);
    expect(isIntentionalProductRpcError({ code: "23505", message: "Есть текст." })).toBe(false);
    expect(isIntentionalProductRpcError({})).toBe(false);
  });
});
