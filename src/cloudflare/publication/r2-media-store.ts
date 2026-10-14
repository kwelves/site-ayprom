// Private external Node only. Constructing the store performs no request; the caller supplies the
// S3-compatible client (real R2 credentials are a separately authorized execution gate).
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { MediaObjectStore } from "./media-release";

interface R2Client { send(command: HeadObjectCommand | PutObjectCommand): Promise<unknown> }
const unavailable = () => new Error("media_store_unavailable");
const status = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;

export function createR2MediaObjectStore(input: { client: R2Client; bucketName: string }): MediaObjectStore {
  const { client, bucketName } = input ?? {};
  if (!client || typeof client.send !== "function" || typeof bucketName !== "string" || !bucketName.trim()) throw unavailable();
  return {
    async head(key) {
      try {
        const answer = await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key })) as
          { ContentLength?: number; Metadata?: Record<string, string> };
        if (!Number.isSafeInteger(answer?.ContentLength)) throw unavailable();
        const sha256 = answer.Metadata?.sha256;
        return { size: answer.ContentLength as number, sha256: typeof sha256 === "string" ? sha256 : null };
      } catch (error) {
        const name = (error as { name?: string } | null)?.name;
        if (name === "NotFound" || name === "NoSuchKey" || status(error) === 404) return null;
        throw unavailable();
      }
    },
    async putIfAbsent({ key, bytes, contentType, sha256 }) {
      try {
        await client.send(new PutObjectCommand({ Bucket: bucketName, Key: key, Body: bytes,
          ContentLength: bytes.byteLength, ContentType: contentType, Metadata: { sha256 },
          CacheControl: "public, max-age=31536000, immutable", IfNoneMatch: "*" }));
        return "created";
      } catch (error) {
        if (status(error) === 412) return "exists";
        throw unavailable();
      }
    },
  };
}
