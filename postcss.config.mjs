/**
 * Tailwind's PostCSS plugin.
 *
 * One plugin, no autoprefixer: Tailwind 4 handles vendor prefixing itself, and
 * a second pass would only add weight to every stylesheet in the build.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
