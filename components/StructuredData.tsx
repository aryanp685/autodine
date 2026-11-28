import { siteOrigin } from '@/lib/site-origin';
import type { PublicRestaurantProfile } from '@/lib/db/public-restaurant';

type Props = {
  restaurant?: PublicRestaurantProfile | null;
  nonce?: string | null;
};

/**
 * JSON-LD inside a <script> must not be able to close that tag.
 *
 * The payload carries owner-written text (restaurant name, address), so a name
 * containing `</script>` would otherwise end the block and inject markup into
 * the public menu page. Escaping these five characters keeps the JSON valid --
 * each becomes a JSON escape, not a literal -- so parsers see the same values.
 */
const JSON_LD_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

export function jsonLdMarkup(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => JSON_LD_ESCAPES[character] ?? character);
}

function jsonLd(value: unknown, nonce: string | null | undefined) {
  return (
    <script
      type="application/ld+json"
      nonce={nonce ?? undefined}
      dangerouslySetInnerHTML={{ __html: jsonLdMarkup(value) }}
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
