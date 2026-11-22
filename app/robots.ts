import { MetadataRoute } from 'next';

const generateRobots = async (): Promise<MetadataRoute.Robots> => ({
  rules: [
    {
      userAgent: '*',
      allow: ['/'],
      disallow: [
        '/dashboard',
        '/kitchen',
        '/admin',
        '/invoice',
        '/orders',
        '/bill',
        '/api/',
        '/auth',
        '/login',
        '/signup',
        '/forgot-password',
        '/reset-password',
        '/join',
        '/t',
      ],
    },
  ],
  sitemap: '/sitemap.xml',
});

export { generateRobots };
export default generateRobots;
