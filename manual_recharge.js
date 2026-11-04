require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI is not defined in environment variables.');
    process.exit(1);
}

// Minimal schemas required for this operation
const UserSchema = new mongoose.Schema({
    userId: String,
    name: String,
    email: String,
    balance: Number
}, { strict: false });

const TransactionSchema = new mongoose.Schema({
    txId: String,
    userId: String,
    user: String,
    type: String,
    desc: String,
    cost: Number,
    credit: Number,
    status: String
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);

function generateId(prefix) {
    return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

async function executeManualRecharge(email, amount) {
    try {
        console.log('Connecting to database...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected successfully.');

        const targetEmail = String(email).toLowerCase().trim();
        const rechargeAmount = Number(amount);

        const user = await User.findOne({ email: targetEmail });

        if (!user) {
            console.error(`❌ User with email ${targetEmail} not found.`);
            return;
        }

        console.log(`User found: ${user.name} (Current Balance: ₦${user.balance})`);

        // 1. Increment the balance safely
        const updatedUser = await User.findOneAndUpdate(
            { email: targetEmail },
            { $inc: { balance: rechargeAmount } },
            { new: true }
        );

        // 2. Create the audit transaction
        const txDoc = await Transaction.create({
            txId: generateId('TX'),
            userId: updatedUser.userId,
            user: updatedUser.name,
            type: 'RECHARGE',
            desc: 'Manual Admin Direct Recharge',
            cost: 0,
            credit: rechargeAmount,
            status: 'Completed'
        });

        console.log(`✅ Successfully credited +₦${rechargeAmount} to ${updatedUser.name}.`);
        console.log(`✅ Transaction ID: ${txDoc.txId}`);
        console.log(`✅ New Wallet Balance: ₦${updatedUser.balance}`);

    } catch (err) {
        console.error('❌ Error executing manual recharge:', err);
    } finally {
        await mongoose.disconnect();
        console.log('Database connection closed.');
        process.exit(0);
    }
}

// Execute for destisibor@gmail.com with N20000
executeManualRecharge('destisibor@gmail.com', 20000);