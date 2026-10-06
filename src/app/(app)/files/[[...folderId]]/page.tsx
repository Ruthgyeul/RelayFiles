import { notFound } from "next/navigation";
import { getAppEnv } from "@/config/env";
import { folderRefSchema } from "@/contracts/nodes";
import { FileManager } from "@/features/files/FileManager";
import { currentDevice } from "@/server/auth/current";
import { ApiError } from "@/server/http/api-error";
import { getFolderView } from "@/server/services/node.service";
import Loading from "../../loading";

/** File Manager: /files is the account root, /files/<folderId> a folder inside it. */
export default async function FilesPage({ params }: PageProps<"/files/[[...folderId]]">) {
  const { folderId } = await params;
  if (folderId && folderId.length > 1) notFound();
  const ref = folderRefSchema.safeParse(folderId?.[0] ?? "root");
  if (!ref.success) notFound();

  const device = await currentDevice();
  // A first visit has no account yet; the shell creates one and refreshes this page.
  if (!device.active) return <Loading />;

  const view = await getFolderView(device.active.account.id, ref.data).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  return <FileManager key={view.folder.id} view={view} isAdmin={device.active.account.isAdmin} publicUrl={getAppEnv().PUBLIC_URL.replace(/\/$/, "")} />;
}
