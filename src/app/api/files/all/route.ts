import { allFilesQuerySchema } from "@/contracts/all-files";
import { apiHandler } from "@/server/http/api-handler";
import { allFilesPage } from "@/server/services/all-files.service";

/** "All Files": every file of the active account, without folders, one page per request. */
export const GET = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  return allFilesPage(account.id, allFilesQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams)));
});
