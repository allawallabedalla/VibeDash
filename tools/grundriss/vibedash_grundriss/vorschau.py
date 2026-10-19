"""Preview of the plan as one SVG (all floors side by side): rooms coloured by kind with name and area, walls on
top. For checking the plan against the drawing together with the person – not shown in the dashboard."""

from __future__ import annotations

from xml.sax.saxutils import escape

from .plan import polygon

COLOR = {
    "raum": "#cfe3f7",
    "aussen": "#e3efd3",
    "nutz": "#f1ece2",
    "luftraum": "#ffffff",
    "treppe": "#e9e4f5",
    "dach": "#f3f0e8",
}


def svg(haus: dict, walls: dict | None = None) -> str:
    walls = walls or {}
    x0, y0, x1, y1 = haus.get("ausschnitt") or [-1, -1, 15, 15]
    w, h = x1 - x0, y1 - y0
    gap = 1.0
    parts = []
    for k, g in enumerate(haus.get("geschosse") or []):
        dx = k * (w + gap)
        t = [f'<g transform="translate({dx - x0:.3f},{-y0 + 1.2:.3f})">']
        t.append(
            f'<text x="{x0 + 0.1:.2f}" y="{y0 - 0.4:.2f}" font-size="0.6" font-family="sans-serif" '
            f'font-weight="bold">{escape(str(g.get("name") or g.get("id")))}</text>'
        )
        for r in g.get("raeume") or []:
            p = polygon(r)
            if p is None:
                continue
            pts = " ".join(f"{x:.3f},{y:.3f}" for x, y in list(p.exterior.coords)[:-1])
            t.append(
                f'<polygon points="{pts}" fill="{COLOR.get(r.get("art", "raum"), "#eee")}" '
                f'stroke="#8a8a8a" stroke-width="0.03"/>'
            )
        for wall in walls.get(g.get("id")) or []:
            pts = " ".join(f"{x:.3f},{y:.3f}" for x, y in wall)
            t.append(f'<polygon points="{pts}" fill="#3d3c3a"/>')
        for r in g.get("raeume") or []:
            c = r.get("zentrum_sichtbar") or r.get("zentrum")
            if not c:
                continue
            area = f"{r['flaeche_m2']:.1f} m²".replace(".", ",") if r.get("flaeche_m2") else ""
            t.append(
                f'<text x="{c[0]:.2f}" y="{c[1]:.2f}" font-size="0.32" font-family="sans-serif" '
                f'text-anchor="middle">{escape(str(r.get("name", "")))}</text>'
            )
            if area:
                t.append(
                    f'<text x="{c[0]:.2f}" y="{c[1] + 0.4:.2f}" font-size="0.26" font-family="sans-serif" '
                    f'text-anchor="middle" fill="#555">{area}</text>'
                )
        t.append("</g>")
        parts.append("".join(t))
    n = max(1, len(haus.get("geschosse") or []))
    width, height = n * w + (n - 1) * gap, h + 1.4
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.3f} {height:.3f}" '
        f'width="{width * 60:.0f}" height="{height * 60:.0f}"><rect width="100%" height="100%" fill="#fff"/>'
        + "".join(parts)
        + "</svg>"
    )
