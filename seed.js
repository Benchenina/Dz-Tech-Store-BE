/**
 * DZ Tech Store catalogue and idempotent seeding helper.
 *
 * Usage:
 *   npm run seed        -> inserts the catalogue only if the collection is empty
 *   npm run seed:fresh  -> deletes all products then inserts the catalogue
 */
require('dotenv').config();

const Product = require('./models/Product');
const { connectDB, disconnectDB } = require('./config/db');

const imageUrl = (photoId) =>
  `https://images.unsplash.com/photo-${photoId}?auto=format&fit=crop&w=900&h=675&q=80`;

/**
 * This is the original mock catalogue from the React storefront
 * (`dz-tech-store/src/data/products.js`). Keeping the same field names here
 * means the API, seed data and frontend all speak the same product language.
 */
const STOREFRONT_PRODUCTS = [
  {
    id: 'aurora-pro-headphones',
    name: 'Aurora Pro Headphones',
    price: 249,
    oldPrice: 299,
    category: 'Audio',
    image: imageUrl('1505740420928-5e560c06d30e'),
    description:
      'Adaptive noise cancelling, spatial audio, and 40 hours of battery in a featherweight frame.',
    rating: 4.8,
    reviews: 412,
    badge: 'Bestseller',
    featured: true,
  },
  {
    id: 'nimbus-mechanical-keyboard',
    name: 'Nimbus Mechanical Keyboard',
    price: 149,
    category: 'Keyboards',
    image: imageUrl('1587829741301-dc798b83add3'),
    description:
      'Hot-swappable switches, gasket mount, and per-key RGB in a low-profile aluminium body.',
    rating: 4.7,
    reviews: 286,
    badge: 'New',
  },
  {
    id: 'orbit-wireless-mouse',
    name: 'Orbit Wireless Mouse',
    price: 89,
    category: 'Accessories',
    image: imageUrl('1527864550417-7fd91fc51a46'),
    description:
      'Featherlight 58 g shell with a 26K optical sensor and 90-hour wireless battery.',
    rating: 4.6,
    reviews: 198,
  },
  {
    id: 'vision-4k-monitor',
    name: 'Vision 27" 4K Monitor',
    price: 449,
    category: 'Displays',
    image: imageUrl('1527443224154-c4a3942d3acf'),
    description:
      '27-inch 4K IPS panel with 99% DCI-P3, USB-C power delivery, and a near-zero bezel.',
    rating: 4.9,
    reviews: 154,
  },
  {
    id: 'pulse-smartwatch',
    name: 'Pulse Smartwatch X',
    price: 299,
    oldPrice: 349,
    category: 'Wearables',
    image: imageUrl('1546868871-7041f2a55e12'),
    description:
      'AMOLED display, advanced health tracking, and a 7-day battery in a titanium case.',
    rating: 4.7,
    reviews: 233,
    badge: 'Bestseller',
  },
  {
    id: 'echo-portable-speaker',
    name: 'Echo Portable Speaker',
    price: 129,
    category: 'Audio',
    image: imageUrl('1608043152269-423dbba4e7e1'),
    description:
      'Room-filling 360° sound, IP67 waterproofing, and 20 hours of playtime per charge.',
    rating: 4.5,
    reviews: 176,
  },
  {
    id: 'apex-pro-controller',
    name: 'Apex Pro Controller',
    price: 79,
    category: 'Gaming',
    image: imageUrl('1600080972464-8e5f35f63d08'),
    description:
      'Hall-effect sticks, back paddles, and pro-grade latency for console and PC.',
    rating: 4.8,
    reviews: 521,
  },
  {
    id: 'vector-14-ultrabook',
    name: 'Vector 14 Ultrabook',
    price: 1299,
    category: 'Laptops',
    image: imageUrl('1611186871348-b1ce696e52c9'),
    description:
      'A 14-inch OLED ultrabook with a 1.1 kg chassis, 32 GB RAM, and all-day battery.',
    rating: 4.9,
    reviews: 87,
    badge: 'New',
  },
  {
    id: 'nova-gaming-pc',
    name: 'Nova Gaming PC',
    price: 1899,
    category: 'Desktops',
    image: imageUrl('1597872200969-2b65d56bd16b'),
    description:
      'RTX-class graphics, liquid cooling, and a tool-less chassis built for high-refresh gaming.',
    rating: 4.9,
    reviews: 64,
  },
  {
    id: 'halo-magnetic-charger',
    name: 'Halo Magnetic Charger',
    price: 59,
    category: 'Accessories',
    image: imageUrl('1615526675159-e248c3021d3f'),
    description:
      '15 W magnetic fast charging with a woven cable and a slim, travel-ready profile.',
    rating: 4.4,
    reviews: 318,
  },
  {
    id: 'studio-pro-microphone',
    name: 'Studio Pro Microphone',
    price: 159,
    category: 'Audio',
    image: imageUrl('1590602847861-f357a9332bbc'),
    description:
      'Broadcast-grade cardioid condenser with USB-C, zero-latency monitoring, and a boom arm.',
    rating: 4.8,
    reviews: 142,
    badge: 'New',
  },
  {
    id: 'lumen-mirrorless-camera',
    name: 'Lumen Mirrorless Camera',
    price: 899,
    oldPrice: 999,
    category: 'Cameras',
    image: imageUrl('1516035069371-29a1b244cc32'),
    description:
      'Full-frame sensor, 6K video, and in-body stabilisation in a compact weather-sealed body.',
    rating: 4.9,
    reviews: 76,
    badge: 'Bestseller',
  },
];

const STOCK_BY_PRODUCT = [24, 42, 63, 18, 16, 31, 38, 8, 6, 54, 25, 5];

const SAMPLE_PRODUCTS = STOREFRONT_PRODUCTS.map((product, index) => {
  const { id: _legacyStorefrontId, ...fields } = product;

  return {
    ...fields,
    // The legacy dashboard reads imageUrl, so seed both aliases.
    imageUrl: fields.image,
    stock: STOCK_BY_PRODUCT[index] ?? 20,
  };
});

async function seedIfEmpty({ force = false, verbose = true } = {}) {
  const existing = await Product.countDocuments();

  if (existing > 0 && !force) {
    if (verbose) {
      console.log(`[seed] Collection already contains ${existing} product(s); nothing to do.`);
    }
    return { seeded: false, count: existing };
  }

  if (force) {
    await Product.deleteMany({});
  }

  const products = await Product.insertMany(SAMPLE_PRODUCTS);
  if (verbose) {
    console.log(`[seed] Inserted ${products.length} DZ Tech Store products.`);
  }

  return { seeded: true, count: products.length };
}

async function run() {
  const force = process.argv.includes('--force');

  try {
    await connectDB();
    await seedIfEmpty({ force });
  } catch (error) {
    console.error(`[seed] Failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
}

if (require.main === module) {
  run();
}

module.exports = { SAMPLE_PRODUCTS, STOREFRONT_PRODUCTS, seedIfEmpty };
