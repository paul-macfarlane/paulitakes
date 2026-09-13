import type { MetadataRoute } from "next";

// Hexes are the rendered brand token values (ADR-0024): theme tokens are
// CSS-only, and the manifest is static JSON served outside the CSS cascade.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Paulitakes",
    short_name: "Paulitakes",
    description:
      "Sports analysis. Stories. Cheap laughs. A sports blog from Paul and guest authors.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafcfe",
    theme_color: "#c33f00",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
