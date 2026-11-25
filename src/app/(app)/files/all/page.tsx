import type { Metadata } from "next";
import { ALL_FILES } from "@/config/policy";
import { AllFilesPage } from "@/features/all-files/AllFilesPage";
import { allFilesPage } from "@/server/services/all-files.service";
import { initialViewOf, withActiveAccount } from "../../with-active-account";

export const metadata: Metadata = { title: "All Files" };

/** "All Files": every file of the active account without folders, newest first (more pages load on demand). */
export default async function AllFilesRoute({ searchParams }: PageProps<"/files/all">) {
  const { view: viewParam } = await searchParams;
  return withActiveAccount(async ({ account }) => {
    const initial = await allFilesPage(account.id, { sort: "date", kind: "all", q: "", limit: ALL_FILES.pageSize });
    return <AllFilesPage key={account.id} initial={initial} isAdmin={account.isAdmin} initialView={initialViewOf(viewParam)} />;
  });
}
