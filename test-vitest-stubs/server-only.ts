/**
 * A stand-in for Next.js's `server-only` marker, for tests only.
 *
 * WHY THIS FILE EXISTS
 *
 * `server-only` is not a dependency of this project: Next.js aliases it
 * internally, at build time, to a module whose only job is to make importing
 * it from a Client Component a compile error. That alias does not exist in
 * Vitest, which runs plain modules in Node -- so the moment a test renders a
 * Server Component that transitively reaches `lib/supabase/admin.ts`, the
 * suite dies with "Cannot find package 'server-only'" and says nothing about
 * the screen under test.
 *
 * The alternative was to mock `@/app/auth/actions` in every screen test that
 * renders the shared bar. That works once and then rots: the next component
 * that touches a server action adds another four mocks, and the mocks quietly
 * stop being about the screen. One alias in vitest.config.mts keeps the guard
 * in the build, where it belongs, and keeps the marker out of the tests'
 * import graph, where it never meant anything.
 */
export {};
