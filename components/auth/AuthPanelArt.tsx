/**
 * The forest panel's botanical line-art, drawn as one SVG in the reference's
 * style: a waiter holding a cloche aloft, leaves, a bird and an orange sun.
 * Strokes and fills come from the auth tokens; the scene is decorative and
 * every moving group is aria-hidden via the parent.
 */
export function AuthPanelArt() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 520 620"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
    >
      {/* orange sun + cream blob */}
      <circle cx="452" cy="70" r="86" fill="var(--auth-accent)" opacity="0.92" />
      <circle cx="40" cy="580" r="130" fill="#fbf6ee" opacity="0.07" />

      {/* leaves, top left */}
      <g className="auth-leaf-sway" stroke="#fbf6ee" strokeWidth="2.4" strokeLinecap="round" opacity="0.75">
        <path d="M28 40 Q64 22 84 58 Q52 72 28 40 Z" />
        <path d="M30 42 Q60 40 80 56" strokeWidth="1.6" />
        <path d="M96 96 Q124 78 140 104 Q114 122 96 96 Z" opacity="0.6" />
        <path d="M150 26 q10 22 -6 40" opacity="0.5" />
        <path d="M160 24 q12 20 -4 40" opacity="0.35" />
      </g>

      {/* leaves, bottom right */}
      <g
        className="auth-leaf-sway"
        stroke="#fbf6ee"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.6"
        style={{ animationDelay: '-3s' }}
      >
        <path d="M436 520 Q470 500 492 532 Q458 552 436 520 Z" />
        <path d="M440 522 Q468 518 488 530" strokeWidth="1.6" />
        <path d="M400 566 q14 16 34 14" opacity="0.5" />
      </g>

      {/* bird, top centre */}
      <g className="auth-bird">
        <path d="M242 96 q10 -14 24 -10 q-2 8 -10 12 q10 0 16 6 q-14 8 -26 0 q-6 -4 -4 -8 Z" fill="var(--auth-accent)" />
        <circle cx="262" cy="89" r="1.6" fill="#1f3d2e" />
        <path d="M238 100 q-10 -2 -14 -8" stroke="var(--auth-accent)" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* the waiter: cream line-art on forest */}
      <g className="auth-cloche" stroke="#fbf6ee" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {/* cloche, held aloft */}
        <path d="M300 178 a44 44 0 0 1 88 0" fill="#fbf6ee" fillOpacity="0.08" />
        <circle cx="344" cy="126" r="5" fill="#fbf6ee" stroke="none" />
        <path d="M344 131 v8" />
        <path d="M320 156 a26 26 0 0 1 14 -16" strokeWidth="2" opacity="0.7" />
        {/* tray under the cloche */}
        <path d="M292 190 h104" strokeWidth="3.4" />
        <path d="M300 190 l-6 12 h116 l-6 -12" strokeWidth="2.6" fill="#fbf6ee" fillOpacity="0.08" />

        {/* head + turban */}
        <circle cx="286" cy="236" r="21" />
        <path d="M268 228 q14 -16 36 -6" strokeWidth="2.4" />
        <path d="M270 242 q4 4 8 2 M296 240 q4 3 8 1" strokeWidth="2" opacity="0.8" />
        <path d="M279 251 q7 5 14 0" strokeWidth="2" opacity="0.9" />

        {/* kurta */}
        <path
          d="M286 257 q-6 1 -12 6 q-16 12 -18 44 l-4 84 h68 l-4 -84 q-2 -32 -18 -44 q-6 -5 -12 -6 Z"
          fill="#fbf6ee"
          fillOpacity="0.07"
        />
        <path d="M278 259 l8 12 l8 -12" strokeWidth="2.4" />

        {/* raised arm to the tray, other arm down */}
        <path d="M280 274 q-18 -46 26 -78" />
        <path d="M300 280 q22 10 26 40" />

        {/* legs + shoes */}
        <path d="M270 391 l-4 66 h14 l6 -50 M302 391 l4 66 h-14 l-6 -50" strokeWidth="2.8" />
        <path d="M264 457 h18 M296 457 h18" strokeWidth="4" />
      </g>

      {/* ground line */}
      <path d="M236 462 h160" stroke="#fbf6ee" strokeWidth="2.4" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}
