import { notFound } from "next/navigation";
import { folderRefSchema } from "@/contracts/nodes";
import { FileManager } from "@/features/files/FileManager";
import { ApiError } from "@/server/http/api-error";
import { autoCleanRuleOf } from "@/server/services/auto-clean.service";
import { getFolderView } from "@/server/services/node.service";
import { initialViewOf, withActiveAccount } from "../../with-active-account";

/** File Manager: /files is the account root, /files/<folderId> a folder inside it. */
export default async function FilesPage({ params, searchParams }: PageProps<"/files/[[...folderId]]">) {
  const [{ folderId }, { view: viewParam }] = await Promise.all([params, searchParams]);
  if (folderId && folderId.length > 1) notFound();
  const ref = folderRefSchema.safeParse(folderId?.[0] ?? "root");
  if (!ref.success) notFound();

  return withActiveAccount(async ({ account }) => {
    const view = await getFolderView(account.id, ref.data).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
      throw error;
    });
    const autoClean = view.isRoot ? null : await autoCleanRuleOf(account.id, view.folder.id);
    return <FileManager key={view.folder.id} view={view} autoClean={autoClean} isAdmin={account.isAdmin} initialView={initialViewOf(viewParam)} />;
  });
}
