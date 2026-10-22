import IncidentDetailView from "@/components/IncidentDetailView";

export default async function IncidentDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  return <IncidentDetailView id={(await params).id} />;
}
