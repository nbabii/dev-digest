/** Whether a picked file is a zip archive (vs. a single .md/.txt file) —
    only zips can carry ignored entries. */
export function isZipFile(file: File | null): boolean {
  return !!file && file.name.toLowerCase().endsWith(".zip");
}
