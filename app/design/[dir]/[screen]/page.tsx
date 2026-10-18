import { notFound } from 'next/navigation';
import { directionList, screenBySlug, screens, type DirectionId } from '@/lib/directions';
import ScreenRenderer from '@/components/ScreenRenderer';

export function generateStaticParams() {
  return directionList.flatMap((d) => screens.map((s) => ({ dir: d.id, screen: s.slug })));
}

export default async function ScreenPage({
  params,
}: {
  params: Promise<{ dir: string; screen: string }>;
}) {
  const { dir, screen } = await params;
  if (!directionList.some((d) => d.id === dir)) notFound();
  if (!screenBySlug(screen)) notFound();

  return <ScreenRenderer dir={dir as DirectionId} screen={screen} />;
}
