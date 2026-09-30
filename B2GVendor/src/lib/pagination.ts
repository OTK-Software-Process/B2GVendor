// The page numbers to show in a pager: a window of `size` consecutive pages that
// starts at the current page (1..10, then 2..11, then 3..12 ...) and stops
// sliding once it reaches the last page, so it never shrinks or shows gaps.
export function pageWindow(current: number, total: number, size: number): number[] {
  const count = Math.max(0, Math.min(size, total));
  const start = Math.min(Math.max(1, current), total - count + 1);
  return Array.from({ length: count }, (_, i) => start + i);
}
