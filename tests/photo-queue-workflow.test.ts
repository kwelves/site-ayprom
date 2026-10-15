import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "photo-queue.yml"), "utf8");

// What the photo worker needs to write product photos to R2 (src/lib/media-storage.ts): the bucket, the account and
// its key pair, the private journal bucket and the two switches. All of them come from the GitHub environment of
// the site (staging or production), never from the repository level.
const FROM_VARIABLES = [
  "MEDIA_STORAGE_WRITE_TARGET", "NEXT_PUBLIC_MEDIA_BASE_URL", "R2_BUCKET_NAME", "MEDIA_STORAGE_JOURNAL_BUCKET",
  "MEDIA_STORAGE_DUAL_WRITE_SUPABASE", "MEDIA_STORAGE_RETAIN_OBJECTS", "PUBLICATION_WORKFLOW_FILE", "PUBLICATION_WORKFLOW_REF",
];
const FROM_SECRETS = ["SUPABASE_SECRET_KEY", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];

describe("photo queue workflow", () => {
  it.each(FROM_VARIABLES)("passes %s from the environment variables to the worker", (name) => {
    expect(workflow).toMatch(new RegExp(`^\\s+${name}: \\$\\{\\{ vars\\.${name} \\}\\}`, "m"));
  });

  it.each(FROM_SECRETS)("passes %s from the environment secrets to the worker", (name) => {
    expect(workflow).toMatch(new RegExp(`^\\s+${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`, "m"));
  });

  it("works in the GitHub environment named by the input, staging by default", () => {
    expect(workflow).toContain("environment: ${{ inputs.environment || 'staging' }}");
  });
});
