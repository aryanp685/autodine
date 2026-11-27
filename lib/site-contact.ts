/**
 * The public merchant identity, shown on every public page and quoted in the
 * legal documents. One source of truth so the footer and the legal pages
 * cannot drift apart. No phone number here on purpose: support runs over
 * email.
 */
export const SITE_CONTACT = {
  operator: 'Aryan Prashant Patil',
  product: 'AutoDine',
  email: 'iamjarvis9896@gmail.com',
  line: 'AutoDine — operated by Aryan Prashant Patil',
  contactLine: 'Contact: iamjarvis9896@gmail.com',
} as const;
