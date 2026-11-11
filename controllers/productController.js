const mongoose = require('mongoose');
const Product = require('../models/Product');

const ALLOWED_FIELDS = [
  'name',
  'description',
  'price',
  'oldPrice',
  'category',
  'image',
  'imageUrl',
  'stock',
  'rating',
  'reviews',
  'badge',
  'featured',
];

function notFound(res) {
  return res.status(404).json({
    error: 'Not Found',
    message: 'Product not found.',
  });
}

function badRequest(res, message) {
  return res.status(400).json({ error: 'Bad Request', message });
}

/**
 * Whitelist and validate product fields.
 * Returns { value, error } where error is a human-readable message.
 */
function parseProductInput(body, { partial = false } = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const value = {};
  let provided = 0;

  for (const field of ALLOWED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    provided += 1;
    value[field] = source[field];
  }

  if (partial && provided === 0) {
    return { error: 'Provide at least one product field to update.' };
  }

  if (Object.prototype.hasOwnProperty.call(value, 'name') || !partial) {
    if (typeof value.name !== 'string' || value.name.trim().length < 2) {
      return { error: 'Product name must contain at least 2 characters.' };
    }
    value.name = value.name.trim();
    if (value.name.length > 120) {
      return { error: 'Product name cannot exceed 120 characters.' };
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'description')) {
    if (value.description === null || value.description === undefined) {
      value.description = '';
    }
    if (typeof value.description !== 'string') {
      return { error: 'Description must be a string.' };
    }
    value.description = value.description.trim();
    if (value.description.length > 2000) {
      return { error: 'Description cannot exceed 2000 characters.' };
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'price') || !partial) {
    if (value.price === null || value.price === undefined) {
      return { error: 'Price is required.' };
    }
    if (
      typeof value.price !== 'number' &&
      !(typeof value.price === 'string' && value.price.trim() !== '')
    ) {
      return { error: 'Price must be a number.' };
    }
    const price = Number(value.price);
    if (!Number.isFinite(price) || price < 0) {
      return { error: 'Price must be a finite number greater than or equal to 0.' };
    }
    value.price = price;
  }

  if (Object.prototype.hasOwnProperty.call(value, 'oldPrice')) {
    if (value.oldPrice === null || value.oldPrice === '') {
      value.oldPrice = null;
    } else {
      const oldPrice = Number(value.oldPrice);
      if (!Number.isFinite(oldPrice) || oldPrice < 0) {
        return { error: 'Old price must be a finite number greater than or equal to 0.' };
      }
      value.oldPrice = oldPrice;
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'category')) {
    if (value.category === null || value.category === undefined) value.category = 'General';
    if (typeof value.category !== 'string') {
      return { error: 'Category must be a string.' };
    }
    value.category = value.category.trim() || 'General';
    if (value.category.length > 60) {
      return { error: 'Category cannot exceed 60 characters.' };
    }
  }

  for (const imageField of ['image', 'imageUrl']) {
    if (!Object.prototype.hasOwnProperty.call(value, imageField)) continue;

    if (value[imageField] === null || value[imageField] === undefined) {
      value[imageField] = '';
    }
    if (typeof value[imageField] !== 'string') {
      return { error: 'Image URL must be a string.' };
    }
    value[imageField] = value[imageField].trim();
    if (value[imageField].length > 500) {
      return { error: 'Image URL cannot exceed 500 characters.' };
    }
  }

  // The React client sends `image`; the legacy dashboard sends `imageUrl`.
  // Synchronise both fields so a product works in either interface.
  if (Object.prototype.hasOwnProperty.call(value, 'image')) {
    value.imageUrl = value.image;
  } else if (Object.prototype.hasOwnProperty.call(value, 'imageUrl')) {
    value.image = value.imageUrl;
  }

  if (Object.prototype.hasOwnProperty.call(value, 'stock')) {
    if (value.stock === null || value.stock === undefined) {
      return { error: 'Stock must be an integer.' };
    }
    if (
      typeof value.stock !== 'number' &&
      !(typeof value.stock === 'string' && value.stock.trim() !== '')
    ) {
      return { error: 'Stock must be an integer.' };
    }
    const stock = Number(value.stock);
    if (!Number.isInteger(stock) || stock < 0) {
      return { error: 'Stock must be a non-negative integer.' };
    }
    value.stock = stock;
  }

  if (Object.prototype.hasOwnProperty.call(value, 'rating')) {
    if (value.rating === null || value.rating === '') {
      value.rating = 0;
    } else {
      const rating = Number(value.rating);
      if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
        return { error: 'Rating must be a number between 0 and 5.' };
      }
      value.rating = rating;
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'reviews')) {
    if (value.reviews === null || value.reviews === '') {
      value.reviews = 0;
    } else {
      const reviews = Number(value.reviews);
      if (!Number.isInteger(reviews) || reviews < 0) {
        return { error: 'Reviews must be a non-negative integer.' };
      }
      value.reviews = reviews;
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'badge')) {
    if (value.badge === null || value.badge === undefined) value.badge = '';
    if (typeof value.badge !== 'string') {
      return { error: 'Badge must be a string.' };
    }
    value.badge = value.badge.trim();
    if (value.badge.length > 40) {
      return { error: 'Badge cannot exceed 40 characters.' };
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'featured')) {
    if (typeof value.featured === 'string') {
      value.featured = value.featured.toLowerCase() === 'true';
    }
    if (typeof value.featured !== 'boolean') {
      return { error: 'Featured must be a boolean.' };
    }
  }

  return { value };
}

/**
 * GET /api/products (public)
 */
async function listProducts(_req, res, next) {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    return res.status(200).json(products);
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/products/:id (public)
 */
async function getProduct(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) return notFound(res);

    const product = await Product.findById(id);
    if (!product) return notFound(res);

    return res.status(200).json(product);
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/products (JWT or OAuth2 protected)
 */
async function createProduct(req, res, next) {
  try {
    const { value, error } = parseProductInput(req.body, { partial: false });
    if (error) return badRequest(res, error);

    const product = await Product.create(value);
    return res.status(201).json(product);
  } catch (error) {
    return next(error);
  }
}

/**
 * PUT /api/products/:id (JWT or OAuth2 protected)
 */
async function updateProduct(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return notFound(res);

    const { value, error } = parseProductInput(req.body, { partial: true });
    if (error) return badRequest(res, error);

    const product = await Product.findByIdAndUpdate(
      id,
      { $set: value },
      { new: true, runValidators: true }
    );

    if (!product) return notFound(res);
    return res.status(200).json(product);
  } catch (error) {
    return next(error);
  }
}

/**
 * DELETE /api/products/:id (JWT or OAuth2 protected)
 */
async function deleteProduct(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return notFound(res);

    const product = await Product.findByIdAndDelete(id);
    if (!product) return notFound(res);

    return res.status(200).json({
      message: 'Product deleted successfully.',
      id: product._id.toString(),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
};
