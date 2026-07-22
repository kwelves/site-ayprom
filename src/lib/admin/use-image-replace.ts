"use client";

import { useState } from "react";
import { compressImage } from "@/lib/admin/compress-image";

// Shared "replace this entity's single image" flow for the admin forms
// (brand logo, category cover, subcategory cover). Each was carrying a
// byte-identical handler: compress the picked file, POST it to the entity's
// own replace Server Action, swap in the returned URL, and reset the input.
// The caller supplies `replace` bound to its entity (e.g. slug/id) and an
// `onReplaced` setter for its local preview state.
//
// ProductForm is deliberately NOT a caller — its gallery uploads several
// files at once with explicit order indices (uploadProductImage), a
// genuinely different flow, not this single-image replace.
export function useImageReplace(
  replace: (formData: FormData) => Promise<string | null>,
  onReplaced: (url: string) => void
) {
  const [isUploading, setIsUploading] = useState(false);

  async function handleReplace(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const compressed = await compressImage(file);
    const formData = new FormData();
    formData.set("file", compressed);
    const url = await replace(formData);
    if (url) onReplaced(url);
    setIsUploading(false);
    event.target.value = "";
  }

  return { isUploading, handleReplace };
}
