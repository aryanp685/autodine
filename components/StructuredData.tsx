import { siteOrigin } from '@/lib/site-origin';
import type { PublicRestaurantProfile } from '@/lib/db/public-restaurant';

type Props = {
  restaurant?: PublicRestaurantProfile | null;
  nonce?: string | null;
};

function jsonLd(value: unknown, nonce: string | null | undefined) {
  return (
    <script
      type="application/ld+json"
      nonce={nonce ?? undefined}
      dangerouslySetInnerHTML={{ __html: JSON.stringify(value) }}
    />
  );
}

export default async function StructuredData({ restaurant, nonce }: Props) {
  const origin = await siteOrigin();

  const organization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'AutoDine',
    ...(origin ? { url: origin } : {}),
  };

  const restaurantJsonLd = restaurant
    ? {
        '@context': 'https://schema.org',
        '@type': 'Restaurant',
        name: restaurant.name,
        ...(origin ? { url: `${origin}/menu?s=${restaurant.slug}` } : {}),
        ...(restaurant.phone ? { telephone: restaurant.phone } : {}),
        ...(restaurant.address
          ? { address: { '@type': 'PostalAddress', streetAddress: restaurant.address } }
          : {}),
      }
    : null;

  return (
    <>
      {jsonLd(organization, nonce)}
      {restaurantJsonLd && jsonLd(restaurantJsonLd, nonce)}
    </>
  );
}
