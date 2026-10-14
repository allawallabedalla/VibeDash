"""Sun position and clear-sky irradiance on a tilted plane (no extra package).

Accuracy is a few percent – enough for a clearness index (forecast GTI divided
by clear-sky GTI), which is only used to find similar days.
"""

import math
from datetime import UTC, datetime

import numpy as np


def sun_position(when: datetime, lat: float, lon: float) -> tuple[float, float]:
    """Solar elevation and azimuth in degrees (azimuth 0 = north, 180 = south). NOAA formulas."""
    t = when.astimezone(UTC)
    doy = t.timetuple().tm_yday
    hour = t.hour + t.minute / 60 + t.second / 3600
    g = 2 * math.pi / 365 * (doy - 1 + (hour - 12) / 24)
    eqtime = 229.18 * (
        0.000075
        + 0.001868 * math.cos(g)
        - 0.032077 * math.sin(g)
        - 0.014615 * math.cos(2 * g)
        - 0.040849 * math.sin(2 * g)
    )
    decl = (
        0.006918
        - 0.399912 * math.cos(g)
        + 0.070257 * math.sin(g)
        - 0.006758 * math.cos(2 * g)
        + 0.000907 * math.sin(2 * g)
        - 0.002697 * math.cos(3 * g)
        + 0.00148 * math.sin(3 * g)
    )
    tst = hour * 60 + eqtime + 4 * lon
    ha = math.radians(tst / 4 - 180)
    phi = math.radians(lat)
    cos_zen = math.sin(phi) * math.sin(decl) + math.cos(phi) * math.cos(decl) * math.cos(ha)
    zen = math.acos(max(-1.0, min(1.0, cos_zen)))
    elev = 90 - math.degrees(zen)
    az = (
        math.degrees(
            math.atan2(math.sin(ha), math.cos(ha) * math.sin(phi) - math.tan(decl) * math.cos(phi))
        )
        + 180
    )
    return elev, az % 360


def clear_sky_gti(when: datetime, lat: float, lon: float, tilt: float, azimuth: float) -> float:
    """Clear-sky irradiance on a plane (W/m²). Haurwitz GHI, simple beam/diffuse split,
    isotropic sky. `azimuth` in the Open-Meteo convention: 0 = south, -90 = east, 90 = west."""
    elev, sun_az = sun_position(when, lat, lon)
    if elev <= 0:
        return 0.0
    cz = math.sin(math.radians(elev))
    ghi = 1098 * cz * math.exp(-0.057 / cz)
    dhi = 0.15 * ghi
    dni = (ghi - dhi) / cz
    plane_az = 180 + azimuth  # to the 0 = north convention
    t, s = math.radians(tilt), math.radians(90 - elev)
    cos_inc = math.cos(s) * math.cos(t) + math.sin(s) * math.sin(t) * math.cos(
        math.radians(sun_az - plane_az)
    )
    beam = dni * max(0.0, cos_inc)
    diffuse = dhi * (1 + math.cos(t)) / 2
    reflected = ghi * 0.2 * (1 - math.cos(t)) / 2
    return float(beam + diffuse + reflected)


def clear_sky_series(times: list[datetime], lat, lon, tilt, azimuth) -> np.ndarray:
    return np.array([clear_sky_gti(t, lat, lon, tilt, azimuth) for t in times])
