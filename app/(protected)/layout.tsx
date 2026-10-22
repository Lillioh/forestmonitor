import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { AlertsProvider } from "@/context/AlertsContext";
import { requireUser } from "@/lib/server/auth";
import { monitoringState } from "@/lib/server/state";

export const runtime = "nodejs";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const initialState = await monitoringState();
  return (
    <AlertsProvider initialState={initialState} user={user}>
      <main className="flex h-full overflow-hidden">
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
