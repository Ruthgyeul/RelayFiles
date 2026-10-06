import { Logo } from "@/shared/ui/Display";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[880px] flex-col items-center justify-center gap-3.5 px-4 text-center">
      <Logo size={64} />
      <h1 className="m-0 text-[34px] font-bold tracking-[-0.01em]">RelayFiles</h1>
      <p className="m-0 max-w-[520px] text-[16px] leading-[1.55] text-pretty text-t3">
        Project setup in progress. The interface is being built milestone by milestone.
      </p>
    </main>
  );
}
