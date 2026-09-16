export default function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#1e2b24] bg-[#0d1712] px-5">
      <h1 className="text-base font-semibold tracking-tight">
        Live Map
      </h1>

      <div className="flex items-center gap-5 text-[10px]">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#78bd7b]" />
          <span className="text-gray-300">3/3 NODES ONLINE</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#e9a52e]" />
          <span className="text-gray-400">LATENCY</span>
          <span className="text-gray-200">18.4s</span>
        </div>

        <span className="font-mono text-[#e6a52d]">
          02:47:19 PHT
        </span>
      </div>
    </header>
  );
}