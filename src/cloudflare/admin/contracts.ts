import type { AdminProductReader } from "./products";
import type { AdminProductDetailReader } from "./product-detail-reader";
import type { ProductMutationFields } from "./product-mutation-ports";

export interface AuthAttemptReservation {
  allowed: boolean;
  retryAfter: number;
  reservationId: string | null;
}

/**
 * Result of checking a password against ONE read of the credential state:
 * either a refusal, or success together with the `sessionVersion` of that very
 * state. Two separate calls (a boolean check, then a version read) can straddle
 * a password change and pair an old password with a newer version.
 */
export type AdminPasswordProof =
  | { valid: false }
  | { valid: true; credentialVersion: number };

export interface AdminAuthPorts {
  reserve(keyHash: string, scope?: "login" | "password-change"): Promise<AuthAttemptReservation>;
  finish(reservationId: string, passwordIsValid: boolean): Promise<number>;
  verifyPassword(password: string): Promise<boolean>;
  /**
   * Optional. When present the login handler uses it INSTEAD of
   * `verifyPassword` (which is then never called, not even after an error) and
   * issues a session only with the proven version. Adapters without it keep the
   * previous `verifyPassword` + `credentialVersion` path.
   */
  verifyPasswordWithVersion?(password: string): Promise<AdminPasswordProof>;
  credentialVersion(): Promise<number>;
  hashPassword?(password: string): Promise<string>;
  replacePasswordHash?(passwordHash: string, expectedVersion: number): Promise<number>;
  readProducts?: AdminProductReader;
  /** Private read of one product (draft included); called only after the session check. */
  readProduct?: AdminProductDetailReader;
  createProduct?(fields: ProductMutationFields): Promise<{ id: string; slug: string }>;
  updateProduct?(input: { slug: string; newSlug: string; expectedUpdatedAt: string; fields: ProductMutationFields }): Promise<{ id: string; updatedAt: string }>;
  assets: { fetch(request: Request): Promise<Response> };
  secret: string;
  clientIp: string;
  now: () => number;
}
