// Predefined rail route segments (approximate railway geometry)
// Keys are normalized as "origin|destination" (lowercase, no accents)

const PREDEFINED_RAIL_ROUTES = {
  "porto|vigo": [
    [41.1579, -8.6291],
    [41.2800, -8.5900],
    [41.4200, -8.5200],
    [41.5518, -8.4229],
    [41.7000, -8.5800],
    [41.8500, -8.6200],
    [42.0260, -8.6440],
    [42.1500, -8.6900],
    [42.2406, -8.7207]
  ],

  "vigo|madrid": [
    [42.2406, -8.7207],
    [42.3358, -8.2000],
    [42.3358, -7.8639],
    [42.2000, -7.1000],
    [42.0000, -6.4000],
    [41.8000, -5.6000],
    [41.6523, -4.7245],
    [41.2000, -4.2000],
    [40.8000, -3.9000],
    [40.4168, -3.7038]
  ],

  "madrid|barcelona": [
    [40.4168, -3.7038],
    [40.6000, -3.2000],
    [40.8000, -2.5000],
    [41.0000, -1.8000],
    [41.2000, -1.2000],
    [41.3500, -0.9000],
    [41.6488, -0.8891],
    [41.5500, -0.4000],
    [41.6176, 0.6200],
    [41.5000, 1.2000],
    [41.4200, 1.7000],
    [41.3874, 2.1686]
  ]
};

// Build a normalized key for looking up rail routes
function routeKey(from, to) {
  return `${normalizePlaceName(from.originalQuery)}|${normalizePlaceName(to.originalQuery)}`;
}

// Normalize place names: lowercase, strip accents, trim
function normalizePlaceName(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}
