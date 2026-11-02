// What counts as a TOR "PDF". Downloaded files and zip entries come from a
// remote server, so neither the name nor the server's Content-Type is trusted:
// the bytes must start with the PDF signature, and the name we keep is only a
// display name that always ends in .pdf.

const PDF_SIGNATURE = Buffer.from('%PDF-', 'latin1');

/**
 * True when the bytes start with "%PDF-". Strict (offset 0, no leading junk
 * tolerated): every one of the ~1,400 real e-GP TOR files checked on
 * 2026-11-02 starts exactly there.
 */
export function hasPdfSignature(bytes: Buffer): boolean {
  return bytes.length >= PDF_SIGNATURE.length && bytes.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE);
}

/**
 * A remote file name made safe to show and to offer as a download name: no
 * folders, no control or header-breaking characters, at most 150 characters,
 * and whatever extension it claimed replaced by .pdf (so "x.html" -> "x.pdf").
 */
export function safePdfFilename(raw: string | null | undefined, fallback = 'document.pdf'): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim();
  const stem = cleaned.replace(/\.[^.]*$/, '').trim().slice(0, 150);
  return stem ? `${stem}.pdf` : fallback;
}
