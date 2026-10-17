type Coordinates = { latitude: number; longitude: number };
const GOOGLE_MAPS_API_KEY = String(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
type RouteInfo = {
  points: Coordinates[];
  durationSec: number;
  distanceMeters: number;
};

const toCoordinates = (latitude: unknown, longitude: unknown): Coordinates | null => {
  if (latitude == null || longitude == null) return null;
  const lat = Number(latitude), lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { latitude: lat, longitude: lng } : null;
};
const fetchRouteJson = async (url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error('Directions unavailable');
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const fetchGoogleDrivingRoute = async (start: Coordinates, end: Coordinates): Promise<RouteInfo | null> => {
  if (!GOOGLE_MAPS_API_KEY) {
    return null;
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.latitude},${start.longitude}&destination=${end.latitude},${end.longitude}&mode=driving&key=${GOOGLE_MAPS_API_KEY}`;
    const data = await fetchRouteJson(url);
    const route = data?.routes?.[0];
    const encoded = route?.overview_polyline?.points;
    const leg = route?.legs?.[0];

    if (!encoded || !leg) {
      return null;
    }

    const decodePolyline = (encodedPolyline: string): Coordinates[] => {
      let index = 0;
      let lat = 0;
      let lng = 0;
      const coordinates: Coordinates[] = [];

      while (index < encodedPolyline.length) {
        let b;
        let shift = 0;
        let result = 0;
        do {
          b = encodedPolyline.charCodeAt(index++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : (result >> 1);
        lat += deltaLat;

        shift = 0;
        result = 0;
        do {
          b = encodedPolyline.charCodeAt(index++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : (result >> 1);
        lng += deltaLng;

        coordinates.push({
          latitude: lat / 1e5,
          longitude: lng / 1e5,
        });
      }

      return coordinates;
    };

    const points = decodePolyline(String(encoded)).filter(point => toCoordinates(point.latitude, point.longitude) !== null);
    if (points.length < 2) {
      return null;
    }

    return {
      points,
      durationSec: Number(leg?.duration?.value || 0),
      distanceMeters: Number(leg?.distance?.value || 0),
    };
  } catch {
    return null;
  }
};

export const fetchDrivingRoute = async (start: Coordinates, end: Coordinates): Promise<RouteInfo> => {
  const googleRoute = await fetchGoogleDrivingRoute(start, end);
  if (googleRoute) {
    return googleRoute;
  }

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson`;
    const data = await fetchRouteJson(url);
    const bestRoute = data?.routes?.[0];
    const route = bestRoute?.geometry?.coordinates;

    if (!Array.isArray(route) || route.length < 2) {
      return {
        points: [start, end],
        durationSec: 0,
        distanceMeters: 0,
      };
    }

    const points = route
      .map((pair: unknown) => {
        if (!Array.isArray(pair) || pair.length < 2) {
          return null;
        }
        return toCoordinates(pair[1], pair[0]);
      })
      .filter((point: Coordinates | null): point is Coordinates => point !== null);

    return {
      points: points.length >= 2 ? points : [start, end],
      durationSec: points.length >= 2 ? Number(bestRoute?.duration || 0) : 0,
      distanceMeters: points.length >= 2 ? Number(bestRoute?.distance || 0) : 0,
    };
  } catch {
    return {
      points: [start, end],
      durationSec: 0,
      distanceMeters: 0,
    };
  }
};

