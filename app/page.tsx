import GoogleLoginButton from "@/components/GoogleLoginButton";
import {
  Radio,
  MapPin,
  ShieldCheck,
  Activity,
} from "lucide-react";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07100b] text-white">
      
      {/* Background */}
      <div className="absolute inset-0">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-40"
          style={{
            backgroundImage: "url('/forest-map.jpg')",
          }}
        />

        <div className="absolute inset-0 bg-[#07100b]/75" />

        <div className="absolute inset-0 bg-gradient-to-r from-[#07100b] via-[#07100b]/80 to-transparent" />
      </div>

      {/* Grid */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
          backgroundSize: "50px 50px",
        }}
      />

      {/* Main content */}
      <div className="relative z-10 flex min-h-screen flex-col">
        
        {/* Header */}
        <header className="flex h-20 items-center justify-between border-b border-white/10 px-8 lg:px-14">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#6a8b70] bg-[#152319]">
              <Activity size={18} className="text-[#8ab58d]" />
            </div>

            <div>
              <p className="text-sm font-semibold tracking-[0.18em]">
                FOREST MONITOR
              </p>

              <p className="text-[9px] uppercase tracking-widest text-[#728178]">
                Acoustic Detection System
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-2 text-[10px] uppercase tracking-widest text-[#718077] sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#70b878]" />
            Monitoring Network Online
          </div>
        </header>

        {/* Hero */}
        <section className="flex flex-1 items-center px-8 py-16 lg:px-14">
          <div className="grid w-full max-w-7xl grid-cols-1 items-center gap-16 lg:grid-cols-2">

            {/* Left */}
            <div className="max-w-2xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#3d5544] bg-[#101c14]/80 px-3 py-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#74bd7a]" />

                <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-[#8ca193]">
                  Real-Time Forest Surveillance
                </span>
              </div>

              <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
                Protect the
                <br />

                <span className="text-[#91b995]">
                  forest.
                </span>

                <br />

                Detect threats.
              </h1>

              <p className="mt-7 max-w-xl text-sm leading-7 text-[#8b9990] sm:text-base">
                An intelligent acoustic monitoring platform for detecting
                suspicious forest activity, identifying chainsaw signals,
                and estimating incident locations using distributed sensor
                nodes.
              </p>

              {/* Technology indicators */}
              <div className="mt-9 grid max-w-lg grid-cols-3 gap-3">
                <Feature
                  icon={<Radio size={15} />}
                  title="Acoustic"
                  subtitle="Detection"
                />

                <Feature
                  icon={<MapPin size={15} />}
                  title="TDoA"
                  subtitle="Localization"
                />

                <Feature
                  icon={<ShieldCheck size={15} />}
                  title="Real-Time"
                  subtitle="Monitoring"
                />
              </div>
            </div>

            {/* Login card */}
            <div className="mx-auto w-full max-w-[410px] lg:ml-auto">
              <div className="rounded-2xl border border-[#2b3c31] bg-[#0c1510]/95 p-7 shadow-2xl backdrop-blur-xl sm:p-9">

                {/* Card header */}
                <div className="mb-8">
                  <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-[#18261d]">
                    <ShieldCheck
                      size={21}
                      className="text-[#8fb593]"
                    />
                  </div>

                  <h2 className="text-xl font-semibold">
                    Sign in to Forest Monitor
                  </h2>

                  <p className="mt-2 text-xs leading-5 text-[#718077]">
                    Authorized personnel only. Continue using your
                    organization account.
                  </p>
                </div>

                {/* OAuth */}
                <GoogleLoginButton />

                <div className="my-6 flex items-center gap-3">
                  <div className="h-px flex-1 bg-[#26342b]" />

                  <span className="text-[8px] uppercase tracking-widest text-[#56645b]">
                    Secure OAuth 2.0
                  </span>

                  <div className="h-px flex-1 bg-[#26342b]" />
                </div>

                {/* Security info */}
                <div className="space-y-3 rounded-lg border border-[#233129] bg-[#101a14] p-4">
                  <SecurityItem text="No password stored by Forest Monitor" />
                  <SecurityItem text="Authenticated through Google OAuth" />
                  <SecurityItem text="Encrypted authentication session" />
                </div>

                <p className="mt-6 text-center text-[9px] leading-4 text-[#4f5d54]">
                  Access is restricted to authorized monitoring personnel.
                  By continuing, you agree to the system's access policies.
                </p>
              </div>

              <p className="mt-5 text-center text-[9px] uppercase tracking-widest text-[#4b5a51]">
                Forest Outpost Network • Secure Access
              </p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-white/5 px-8 py-4 lg:px-14">
          <div className="flex flex-col justify-between gap-2 text-[8px] uppercase tracking-widest text-[#4d5b52] sm:flex-row">
            <span>
              Forest Monitor System
            </span>

            <span>
              Acoustic Intelligence • TDoA • IoT
            </span>
          </div>
        </footer>
      </div>
    </main>
  );
}

function Feature({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-lg border border-[#24342a] bg-[#0d1811]/80 p-3">
      <div className="mb-2 text-[#78a37d]">
        {icon}
      </div>

      <p className="text-[10px] font-semibold text-gray-300">
        {title}
      </p>

      <p className="text-[9px] text-[#5f6e64]">
        {subtitle}
      </p>
    </div>
  );
}

function SecurityItem({
  text,
}: {
  text: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-1.5 w-1.5 rounded-full bg-[#6ca773]" />

      <span className="text-[9px] text-[#718077]">
        {text}
      </span>
    </div>
  );
}