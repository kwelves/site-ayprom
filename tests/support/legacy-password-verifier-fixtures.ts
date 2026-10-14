// Fictitious credentials for tests of src/cloudflare/admin/legacy-password-verifier.ts.
// None of these values is, or has ever been, a real AYPROM password.

export const FIXTURE_ENV_PASSWORD = "fixture-env-password-not-real";
export const FIXTURE_WRONG_PASSWORD = "fixture-wrong-password-not-real";
// NFC form; the NFD spelling of the same text must not match (no normalization,
// same as the legacy Next verifier).
export const FIXTURE_UNICODE_ENV_PASSWORD = "фиктивный-пароль-ёж-🔐";

export const GOLDEN_HASH_PASSWORD = "golden-fixture-password-only-for-tests";
// pbkdf2-sha256, 600000 iterations, salt = bytes 0..15, 32-byte key.
// Derived independently with node:crypto pbkdf2Sync, not with the module under test.
export const GOLDEN_PBKDF2_HASH =
  "pbkdf2-sha256:600000:AAECAwQFBgcICQoLDA0ODw:2kVRIdZmCtp1yEvJD68q_2Fk55abyP8PKSx1sPxjedk";
export const GOLDEN_SALT_BYTES = Array.from({ length: 16 }, (_, index) => index);
export const MALFORMED_HASH = "pbkdf2-sha256:1000:AAECAwQFBgcICQoLDA0ODw:2kVRIdZmCtp1yEvJD68q_2Fk55abyP8PKSx1sPxjedk";
