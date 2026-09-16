const assert = require('assert');
const pageDiscovery = require('../server/services/pageDiscoveryV7');

const pages = [
  {
    url: 'https://academy.ibsservices.co/',
    finalUrl: 'https://academy.ibsservices.co/',
    discoveryComplete: false,
    routeHints: [
      'https://academy.ibsservices.co/login',
      'https://academy.ibsservices.co/about',
      'https://external.example.com/login',
      'https://academy.ibsservices.co/logo.png',
    ],
  },
  {
    url: 'https://academy.ibsservices.co/about',
    finalUrl: 'https://academy.ibsservices.co/about',
    discoveryComplete: true,
    routeHints: [],
  },
];

assert.equal(typeof pageDiscovery.missingSameOriginRouteHints, 'function', 'pageDiscoveryV7 must expose deterministic missing-route calculation.');

const missing = pageDiscovery.missingSameOriginRouteHints(
  pages,
  'https://academy.ibsservices.co/',
  6,
);

assert.deepEqual(missing, ['https://academy.ibsservices.co/login'], 'Partial rendered discovery must retain only same-origin navigable route hints that were not already grounded.');

const limited = pageDiscovery.missingSameOriginRouteHints(
  [{
    url: 'https://academy.ibsservices.co/',
    finalUrl: 'https://academy.ibsservices.co/',
    routeHints: [
      'https://academy.ibsservices.co/login',
      'https://academy.ibsservices.co/catalog',
      'https://academy.ibsservices.co/contact',
    ],
  }],
  'https://academy.ibsservices.co/',
  2,
);

assert.deepEqual(limited, ['https://academy.ibsservices.co/login'], 'Missing-route completion must respect the remaining page budget.');

console.log('page-discovery-partial-route-smoke: PASS');
