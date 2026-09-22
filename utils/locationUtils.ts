export type Coordinates = {
  latitude: number;
  longitude: number;
};

const toNumberOrNull = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const extractCoordinates = (source: any): Coordinates | null => {
  if (!source) return null;

  const directLatitude = toNumberOrNull(source?.latitude ?? source?.lat);
  const directLongitude = toNumberOrNull(source?.longitude ?? source?.lng);
  if (directLatitude !== null && directLongitude !== null) {
    return { latitude: directLatitude, longitude: directLongitude };
  }

  const locationLatitude = toNumberOrNull(source?.location?.latitude ?? source?.location?.lat);
  const locationLongitude = toNumberOrNull(source?.location?.longitude ?? source?.location?.lng);
  if (locationLatitude !== null && locationLongitude !== null) {
    return { latitude: locationLatitude, longitude: locationLongitude };
  }

  const coordinatesLatitude = toNumberOrNull(source?.coordinates?.latitude ?? source?.coordinates?.lat);
  const coordinatesLongitude = toNumberOrNull(source?.coordinates?.longitude ?? source?.coordinates?.lng);
  if (coordinatesLatitude !== null && coordinatesLongitude !== null) {
    return { latitude: coordinatesLatitude, longitude: coordinatesLongitude };
  }

  const geoPointLatitude = toNumberOrNull(source?.geoPoint?.latitude);
  const geoPointLongitude = toNumberOrNull(source?.geoPoint?.longitude);
  if (geoPointLatitude !== null && geoPointLongitude !== null) {
    return { latitude: geoPointLatitude, longitude: geoPointLongitude };
  }

  return null;
};

export const getDistanceInKm = (pointA: Coordinates, pointB: Coordinates) => {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;

  const deltaLatitude = toRadians(pointB.latitude - pointA.latitude);
  const deltaLongitude = toRadians(pointB.longitude - pointA.longitude);

  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2)
    + Math.cos(toRadians(pointA.latitude))
    * Math.cos(toRadians(pointB.latitude))
    * Math.sin(deltaLongitude / 2)
    * Math.sin(deltaLongitude / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};
