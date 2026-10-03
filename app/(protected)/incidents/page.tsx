import IncidentDetailView from "@/components/IncidentDetailView";

export default async function IncidentDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <IncidentDetailView id={id} />;
}
