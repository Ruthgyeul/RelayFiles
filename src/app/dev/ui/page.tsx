import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAppEnv } from "@/config/env";
import { UiCatalog } from "@/features/ui-catalog/UiCatalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "UI catalog · RelayFiles", robots: { index: false } };

/** Component catalog for design review. Disabled unless ENABLE_UI_CATALOG=true. */
export default function UiCatalogPage() {
  const env = getAppEnv();
  if (!env.ENABLE_UI_CATALOG) notFound();
  return <UiCatalog initialTheme={env.DEFAULT_THEME} />;
}
