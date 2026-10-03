import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export async function GET(req: NextRequest, ctx: RouteContext<"/icons/[size]">) {
  const { size: raw } = await ctx.params;
  const size = Math.min(1024, Math.max(48, parseInt(raw, 10) || 192));
  const maskable = req.nextUrl.searchParams.has("maskable");
  const glyph = size * (maskable ? 0.5 : 0.62);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg,#14264f,#22377a)",
          color: "#4fe0ad",
          fontSize: glyph,
          fontWeight: 800,
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        ₹
      </div>
    ),
    { width: size, height: size },
  );
}
