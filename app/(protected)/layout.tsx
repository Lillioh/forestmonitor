import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { AlertsProvider } from "@/context/AlertsContext";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AlertsProvider>
      <main className="flex h-screen overflow-hidden">
        <Sidebar />

        <section className="flex min-w-0 flex-1 flex-col">
          <TopBar />

          <div className="min-h-0 flex-1 overflow-y-auto">
            {children}
          </div>
        </section>
      </main>
    </AlertsProvider>
  );
}