const mongoose = require('mongoose');

const categoryTypeSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Category type name is required'],
        trim: true
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: [true, 'Category is required']
    },
    description: {
        type: String,
        default: ''
    },
    image: {
        url: {
            type: String,
            default: ''
        },
        publicId: {
            type: String,
            default: ''
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    order: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Ensure unique category type names within the same category
categoryTypeSchema.index({ name: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('CategoryType', categoryTypeSchema);