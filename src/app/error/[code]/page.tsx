import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ERROR_PAGE_CODES, type ErrorPageCode } from "@/contracts/errors";
import { ErrorScreen } from "@/features/errors/ErrorScreen";
import { ERROR_PRESETS } from "@/features/errors/presets";
import { RetryCountdown } from "@/features/errors/RetryCountdown";
import { ButtonLink } from "@/shared/ui/ButtonLink";

/** Explicit error screens the app redirects to (docs/plan.md §9.2). */
const ROUTED_CODES = ["400", "410", "429", "503", "storage-offline"] as const satisfies readonly ErrorPageCode[];
type RoutedCode = (typeof ROUTED_CODES)[number];

/** Wait shown when the redirect did not include a Retry-After value. */
const DEFAULT_RETRY_SECONDS = 30;

const isRoutedCode = (value: string): value is RoutedCode => (ROUTED_CODES as readonly string[]).includes(value);

export const dynamicParams = false;
export function generateStaticParams() {
  return ROUTED_CODES.map((code) => ({ code }));
}

export async function generateMetadata({ params }: PageProps<"/error/[code]">): Promise<Metadata> {
  const { code } = await params;
  const preset = isRoutedCode(code) ? ERROR_PRESETS[code] : null;
  return { title: preset ? `${preset.title} · RelayFiles` : "RelayFiles", robots: { index: false } };
}

/** Only allow same-site relative paths as the retry target (no open redirects). */
function safeReturnPath(value: string | string[] | undefined): string {
  const path = Array.isArray(value) ? value[0] : value;
  return path && path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

export default async function ErrorCodePage({ params, searchParams }: PageProps<"/error/[code]">) {
  const { code } = await params;
  if (!isRoutedCode(code) || !ERROR_PAGE_CODES.includes(code)) notFound();
  const query = await searchParams;
  const preset = ERROR_PRESETS[code];
  const home = (
    <ButtonLink href="/" icon="house">
      Go home
    </ButtonLink>
  );

  if (code === "429") {
    const requested = Number(Array.isArray(query.retry) ? query.retry[0] : query.retry);
    const seconds = Number.isFinite(requested) ? Math.min(3_600, Math.max(0, requested)) : DEFAULT_RETRY_SECONDS;
    return <ErrorScreen preset={preset} description={<RetryCountdown seconds={seconds} retryHref={safeReturnPath(query.from)} />} />;
  }

  return <ErrorScreen preset={preset} actions={home} />;
}
