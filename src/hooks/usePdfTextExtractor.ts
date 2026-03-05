/**
 * usePdfTextExtractor — Extracts text from a PDF File in-browser using pdf.js.
 *
 * Returns per-page text arrays for the "Reviewed Text" panel.
 * Everything is ephemeral — cleared on unmount or when clearText() is called.
 */

import { useState, useCallback, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";

// Use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export interface PageText {
  pageNumber: number;
  text: string;
}

export function usePdfTextExtractor() {
  const [pages, setPages] = useState<PageText[]>([]);
  const [fullText, setFullText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const abortRef = useRef(false);

  const extractText = useCallback(async (file: File) => {
    setExtracting(true);
    setError(null);
    setPages([]);
    setFullText("");
    abortRef.current = false;

    try {
      const arrayBuffer = await file.arrayBuffer();
      if (abortRef.current) return;

      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      if (abortRef.current) return;

      setPageCount(pdf.numPages);
      const extracted: PageText[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        if (abortRef.current) return;
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item: any) => item.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        extracted.push({ pageNumber: i, text: pageText });
      }

      setPages(extracted);
      setFullText(extracted.map((p) => p.text).join("\n\n"));
    } catch (err) {
      console.error("[PdfTextExtractor] Failed:", err);
      setError("Failed to extract text from PDF. The file may be image-only or corrupted.");
    } finally {
      setExtracting(false);
    }
  }, []);

  const clearText = useCallback(() => {
    abortRef.current = true;
    setPages([]);
    setFullText("");
    setError(null);
    setPageCount(0);
  }, []);

  return { pages, fullText, pageCount, extracting, error, extractText, clearText };
}
