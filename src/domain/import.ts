/**
 * Path of a tar entry inside the account (npm run storage:import): the entry name without
 * "./" and trailing slashes, below the optional target folder. Null for the archive root and
 * for names that would leave it (absolute paths, "..").
 */
export function importRelPath(entryName: string, to = ""): string | null {
  if (entryName.startsWith("/")) return null;
  const parts = (path: string) => path.split("/").filter((segment) => segment !== "" && segment !== ".");
  const entry = parts(entryName);
  if (entry.length === 0) return null;
  const segments = [...parts(to), ...entry];
  return segments.includes("..") ? null : segments.join("/");
}
