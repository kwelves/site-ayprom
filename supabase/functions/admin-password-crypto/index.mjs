import { createAdminPasswordCryptoHandler } from "./core.mjs";

Deno.serve(createAdminPasswordCryptoHandler(() => Deno.env.get("AYPROM_ADMIN_CRYPTO_KEY")));
