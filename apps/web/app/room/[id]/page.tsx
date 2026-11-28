import { notFound } from 'next/navigation';
import { WatchRoom } from '../../../components/party/watch-room';

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) notFound();
  return <WatchRoom id={id} />;
}
