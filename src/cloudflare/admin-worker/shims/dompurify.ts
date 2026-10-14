import { sanitizeSvgDocument } from "../svg/sanitize";

// Stand-in for `isomorphic-dompurify` inside the admin Worker, covering the part upload-validation
// uses: `sanitize()` returns clean SVG markup and `removed` lists what had to be dropped.
const DOMPurify = {
  removed: [] as unknown[],
  sanitize(source: string, options?: unknown): string {
    void options;
    const result = sanitizeSvgDocument(source);
    DOMPurify.removed = result.removed;
    return result.valid ? result.output : "";
  },
};

export default DOMPurify;
