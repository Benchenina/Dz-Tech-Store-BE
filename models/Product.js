const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      minlength: [2, 'Product name must contain at least 2 characters'],
      maxlength: [120, 'Product name cannot exceed 120 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
      default: '',
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
      validate: {
        validator: (value) => Number.isFinite(value),
        message: 'Price must be a finite number',
      },
    },
    oldPrice: {
      type: Number,
      min: [0, 'Old price cannot be negative'],
      validate: {
        validator: (value) => value === undefined || value === null || Number.isFinite(value),
        message: 'Old price must be a finite number',
      },
    },
    category: {
      type: String,
      trim: true,
      maxlength: [60, 'Category cannot exceed 60 characters'],
      default: 'General',
    },
    // `image` is the field used by the React storefront.
    image: {
      type: String,
      trim: true,
      maxlength: [500, 'Image URL cannot exceed 500 characters'],
      default: '',
    },
    // `imageUrl` is kept for the original testing dashboard and older clients.
    imageUrl: {
      type: String,
      trim: true,
      maxlength: [500, 'Image URL cannot exceed 500 characters'],
      default: '',
    },
    stock: {
      type: Number,
      default: 0,
      min: [0, 'Stock cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Stock must be an integer',
      },
    },
    // Storefront presentation fields. They are optional so the basic lab
    // requirements still work with only name, price, category and image.
    rating: {
      type: Number,
      min: [0, 'Rating cannot be negative'],
      max: [5, 'Rating cannot exceed 5'],
      default: 0,
      validate: {
        validator: (value) => Number.isFinite(value),
        message: 'Rating must be a finite number',
      },
    },
    reviews: {
      type: Number,
      min: [0, 'Reviews cannot be negative'],
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: 'Reviews must be an integer',
      },
    },
    badge: {
      type: String,
      trim: true,
      maxlength: [40, 'Badge cannot exceed 40 characters'],
      default: '',
    },
    featured: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

productSchema.index({ category: 1 });
productSchema.index({ createdAt: -1 });

// Keep the two image field names in sync for direct model usage and seeding.
productSchema.pre('validate', function syncImageFields(next) {
  if (!this.image && this.imageUrl) this.image = this.imageUrl;
  if (!this.imageUrl && this.image) this.imageUrl = this.image;
  next();
});

productSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    // Keep the native identifier as well, for interoperability with MongoDB
    // tooling and clients that expect _id.
    ret._id = ret._id.toString();

    // The React app uses `image`; the legacy dashboard uses `imageUrl`.
    // Return both so either client can consume the same API response.
    ret.image = ret.image || ret.imageUrl || '';
    ret.imageUrl = ret.imageUrl || ret.image || '';

    if (ret.oldPrice === null) delete ret.oldPrice;
    return ret;
  },
});

module.exports = mongoose.model('Product', productSchema);
