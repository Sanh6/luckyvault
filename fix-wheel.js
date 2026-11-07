require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('❌ FATAL: MONGODB_URI is not defined in your .env file.');
    process.exit(1);
}

// Minimal schema to target the specific document without requiring the full server schema
const PlatformConfigSchema = new mongoose.Schema({
    singletonKey: String,
    wheelConfig: mongoose.Schema.Types.Mixed
}, { strict: false });

const PlatformConfig = mongoose.model('PlatformConfig', PlatformConfigSchema);

const getReferenceWheelSegments = () => [
    { id: 1, label: '₦50', value: 50.00, color: '#c91429', weight: 20 },
    { id: 2, label: '₦100', value: 100.00, color: '#f0c330', weight: 15 },
    { id: 3, label: '₦500', value: 500.00, color: '#1b6b6b', weight: 3 },
    { id: 4, label: '₦1000', value: 1000.00, color: '#623aa2', weight: 2 },
    { id: 5, label: '₦200', value: 200.00, color: '#ea691c', weight: 10 },
    { id: 6, label: '₦300', value: 300.00, color: '#1565c0', weight: 5 },
    { id: 7, label: '₦5000', value: 5000.00, color: '#278a3f', weight: 1 },
    { id: 8, label: '₦0', value: 0.00, color: '#111111', weight: 40 },
    { id: 9, label: '₦50,000', value: 50000.00, color: '#9333ea', weight: 0 }
];

async function runFix() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB Atlas.');

        const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' });

        if (!config) {
            console.error('❌ GLOBAL_CONFIG document not found.');
            process.exit(1);
        }

        // Preserve existing wheel config (like spinCost) but overwrite segments
        config.wheelConfig = {
            ...config.wheelConfig,
            segments: getReferenceWheelSegments()
        };

        // Explicitly flag the mixed type for saving
        config.markModified('wheelConfig');
        await config.save();

        console.log('✅ Wheel segments successfully updated to 9 segments in the database.');
    } catch (err) {
        console.error('❌ Error updating database:', err);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB.');
        process.exit(0);
    }
}

runFix();