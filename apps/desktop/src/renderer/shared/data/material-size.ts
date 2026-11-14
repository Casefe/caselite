export function materialSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Number((bytes / 1024).toFixed(2))} KB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(2))} MB`;
}
