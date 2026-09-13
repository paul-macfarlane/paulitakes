import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

// Site-wide branded share card (BRAND-3; technical-design §5.8's "branded
// next/og card"). Routes that declare their own og:image (SEO-1 wires post
// thumbnails per FR-1.4) override this — it's the fallback identity card.
// Colors are the rendered ADR-0024 brand values: theme tokens are CSS-only
// and unavailable inside ImageResponse.

export const alt = "Paulitakes — Sports analysis. Stories. Cheap laughs.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  // fs (not fetch(import.meta.url)): Turbopack doesn't rewrite the fetch-asset
  // pattern. The route is static/cacheable and Next's file tracing picks these
  // literal paths into the serverless bundle (verified in route.js.nft.json).
  const [barlow600, barlow700] = await Promise.all([
    readFile(join(process.cwd(), "src/assets/fonts/barlow-condensed-600.ttf")),
    readFile(join(process.cwd(), "src/assets/fonts/barlow-condensed-700.ttf")),
  ]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: "#070b11",
        padding: "72px 80px 96px",
        fontFamily: "Barlow Condensed",
      }}
    >
      {/* mark tile — same shapes as src/app/icon.svg */}
      <svg width="96" height="96" viewBox="0 0 64 64">
        <rect width="64" height="64" rx="14" fill="#c33f00" />
        <path fill="#fff8f4" d="M19 9H41L48 16V39H31V53H19Z" />
        <path
          fill="#c33f00"
          d="M37.5 11C38.6 15 41.6 17.5 43.7 20.5C45.8 23.5 46.8 27 46.3 30.3C45.4 35.2 41.6 38 37 38C32.4 38 28.6 35.2 27.7 30.3C27.1 26.5 28.3 23 30.6 20.6C30.4 22.7 31 24.2 32.5 25.2C32.8 20.8 34.9 16.7 37.5 11Z"
        />
        <path
          fill="#ea6f2f"
          d="M37.3 14C38.2 17 40.5 19.2 42.2 21.7C43.9 24.2 44.7 27.1 44.3 29.9C43.6 33.9 40.6 36.2 37 36.2C33.4 36.2 30.4 33.9 29.7 29.9C29.3 27.1 30.1 24.4 31.9 22.4C31.8 24 32.4 25.3 33.7 26.1C33.9 22.5 35.4 18.8 37.3 14Z"
        />
        <path
          fill="#ffb037"
          d="M37 21.5C38.6 24 40.9 25.9 41.5 28.8C42.1 32.1 40 34.6 37 34.6C34 34.6 31.9 32.1 32.5 28.8C33.1 25.9 35.4 24 37 21.5Z"
        />
        <path
          fill="#fff8f4"
          d="M37 28C38.2 29.3 38.8 30.6 38.4 31.9C38 33.2 36 33.2 35.6 31.9C35.2 30.6 35.8 29.3 37 28Z"
        />
      </svg>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: 176,
            fontWeight: 700,
            color: "#eff2f5",
            textTransform: "uppercase",
            letterSpacing: "-0.01em",
            lineHeight: 0.9,
          }}
        >
          Paulitakes
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 56,
            fontWeight: 600,
            marginTop: 28,
          }}
        >
          <span style={{ color: "#ea6f2f" }}>Sports analysis.</span>
          <span style={{ color: "#96a0ab", marginLeft: 14 }}>
            Stories. Cheap laughs.
          </span>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "100%",
          height: 16,
          background: "linear-gradient(90deg, #c33f00, #ea6f2f)",
        }}
      />
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "Barlow Condensed",
          data: barlow600,
          weight: 600,
          style: "normal",
        },
        {
          name: "Barlow Condensed",
          data: barlow700,
          weight: 700,
          style: "normal",
        },
      ],
    },
  );
}
