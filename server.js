/**
 * ====================================================================
 * LuckyVault — server.js (Production Release)
 * Node.js + Express + MongoDB Atlas Backend
 * ====================================================================
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
        if (req.path === '/api/wallet/korapay-webhook') {
            req.rawBody = buf.toString('utf8');
        }
    }
}));

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const KORAPAY_SECRET_KEY = process.env.KORAPAY_SECRET_KEY;
const KORAPAY_PUBLIC_KEY = process.env.KORAPAY_PUBLIC_KEY;

if (!MONGODB_URI) {
    console.error('❌ FATAL: MONGODB_URI is not defined in environment variables.');
    process.exit(1);
}

if (!JWT_SECRET) {
    console.warn('⚠️ WARNING: JWT_SECRET is not set in environment variables. Using a fallback secret—set JWT_SECRET in production!');
}
const ACTIVE_JWT_SECRET = JWT_SECRET || 'luckyvault_prod_fallback_secret_change_me';

// ====================================================================
// 1. MONGOOSE SCHEMAS & MODELS
// ====================================================================

const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    phone: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['player', 'admin'], default: 'player' },
    status: { type: String, enum: ['Active', 'Suspended'], default: 'Active' },
    balance: { type: Number, default: 0, min: 0 },
    spinsCount: { type: Number, default: 0 },
    boxesCount: { type: Number, default: 0 },
    slotsCount: { type: Number, default: 0 },
    totalWon: { type: Number, default: 0 },
    games: { type: Number, default: 0 },
    referredBy: { type: String, default: null, index: true },
    referralEarnings: { type: Number, default: 0 },
    bankDetails: {
        bankName: { type: String, default: '' },
        accountNumber: { type: String, default: '' },
        accountName: { type: String, default: '' }
    }
}, { timestamps: true });

const TransactionSchema = new mongoose.Schema({
    txId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    user: { type: String, required: true },
    type: { type: String, enum: ['SPIN', 'BOX', 'SLOT', 'RECHARGE', 'WITHDRAWAL', 'INVEST_BUY', 'INVEST_PAYOUT', 'REFERRAL_COMMISSION'], required: true },
    desc: { type: String, required: true },
    cost: { type: Number, default: 0 },
    credit: { type: Number, default: 0 },
    status: { type: String, enum: ['Credited', 'Completed', 'Pending', 'Flagged', 'Rejected'], default: 'Credited' },
    balanceCredited: { type: Boolean, default: false, index: true },
    korapayReference: { type: String, default: null },
    korapayPayload: { type: Object, default: null }
}, { timestamps: true });

const InvestmentPlanSchema = new mongoose.Schema({
    planId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    cost: { type: Number, required: true, min: 0 },
    payoutFrequency: { type: String, enum: ['Daily', 'Maturity'], default: 'Maturity' },
    dailyRoiPercentage: { type: Number, default: 0, min: 0 },
    returnAmount: { type: Number, required: true, min: 0 },
    durationDays: { type: Number, required: true, min: 1 },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

const UserInvestmentSchema = new mongoose.Schema({
    invId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    user: { type: String, required: true },
    planId: { type: String, required: true },
    planName: { type: String, required: true },
    cost: { type: Number, required: true },
    payoutFrequency: { type: String, enum: ['Daily', 'Maturity'], default: 'Maturity' },
    dailyRoiPercentage: { type: Number, default: 0 },
    dailyPayoutAmount: { type: Number, default: 0 },
    returnAmount: { type: Number, required: true },
    durationDays: { type: Number, required: true },
    lastPayoutDate: { type: Date, default: null },
    nextPayoutDate: { type: Date, index: true },
    completedPayouts: { type: Number, default: 0 },
    maturityDate: { type: Date, required: true, index: true },
    status: { type: String, enum: ['Active', 'Completed'], default: 'Active', index: true }
}, { timestamps: true });

const PrizeWindowSchema = new mongoose.Schema({
    spinsSinceLast: { type: Number, default: 0 },
    isActive: { type: Boolean, default: false },
    windowRemaining: { type: Number, default: 0 },
    hasWonBefore: { type: Boolean, default: false }
}, { _id: false });

const TierPrizeStateSchema = new mongoose.Schema({
    p5000: { type: PrizeWindowSchema, default: () => ({ spinsSinceLast: 0, isActive: false, windowRemaining: 0, hasWonBefore: false }) },
    p1000: { type: PrizeWindowSchema, default: () => ({ spinsSinceLast: 0, isActive: false, windowRemaining: 0, hasWonBefore: false }) },
    p500: { type: PrizeWindowSchema, default: () => ({ spinsSinceLast: 0, isActive: false, windowRemaining: 0, hasWonBefore: false }) }
}, { _id: false });

const ChatMessageSchema = new mongoose.Schema({
    messageId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true }, // "GUEST-xxxx" for guests
    isGuest: { type: Boolean, default: false },
    guestName: { type: String, default: '' },
    guestEmail: { type: String, default: '' },
    senderId: { type: String, required: true },
    senderName: { type: String, required: true },
    senderRole: { type: String, enum: ['player', 'admin', 'guest'], required: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false }
}, { timestamps: true });

const PlatformConfigSchema = new mongoose.Schema({
    singletonKey: { type: String, default: 'GLOBAL_CONFIG', unique: true },
    rechargeMigrationV1Done: { type: Boolean, default: false },
    settings: {
        currency: { type: String, default: '₦' },
        minRecharge: { type: Number, default: 1000 },
        maxRecharge: { type: Number, default: 3000 },
        minWithdrawal: { type: Number, default: 1000 },
        regBonus: { type: Number, default: 0 },
        instantRechargeApproval: { type: Boolean, default: false },
        maintenanceMode: { type: Boolean, default: false },
        enableConfetti: { type: Boolean, default: true },
        soundEnabled: { type: Boolean, default: true },
        bankDetails: {
            bankName: { type: String, default: 'Moniepoint MFB' },
            accountNumber: { type: String, default: '1234567890' },
            accountName: { type: String, default: 'LuckyVault Gaming' }
        }
    },
    referralConfig: {
        available: { type: Boolean, default: true },
        level1Percent: { type: Number, default: 10 },
        level2Percent: { type: Number, default: 3 },
        level3Percent: { type: Number, default: 1 }
    },
    wheelConfig: {
        available: { type: Boolean, default: true },
        spinCost: { type: Number, default: 250.00 },
        segments: [{
            id: Number,
            label: String,
            value: Number,
            color: String,
            weight: Number
        }]
    },
    spinState: {
        outcomeDeck: { type: [Boolean], default: [] },
        prizes: {
            p5000: { type: PrizeWindowSchema, default: () => ({ spinsSinceLast: 0, isActive: false, windowRemaining: 0, hasWonBefore: false }) },
            p1000: { type: PrizeWindowSchema, default: () => ({ spinsSinceLast: 0, isActive: false, windowRemaining: 0, hasWonBefore: false }) },
            p500: { type: PrizeWindowSchema, default: () => ({ spinsSinceLast: 0, isActive: false, windowRemaining: 0, hasWonBefore: false }) }
        }
    },
    slotConfig: {
        available: { type: Boolean, default: true },
        spinCost: { type: Number, default: 250.00 },
        payouts: [{
            id: Number,
            combo: String,
            symbol: String,
            name: String,
            label: String,
            value: Number,
            weight: Number,
            color: String
        }]
    },
    slotState: {
        outcomeDeck: { type: [Boolean], default: [] },
        prizes: {
            p5000: { type: PrizeWindowSchema, default: () => ({ spinsSinceLast: 0, isActive: false, windowRemaining: 0, hasWonBefore: false }) },
            p1000: { type: PrizeWindowSchema, default: () => ({ spinsSinceLast: 0, isActive: false, windowRemaining: 0, hasWonBefore: false }) },
            p500: { type: PrizeWindowSchema, default: () => ({ spinsSinceLast: 0, isActive: false, windowRemaining: 0, hasWonBefore: false }) }
        }
    },
    mysteryState: {
        prizes: {
            p5000: { type: PrizeWindowSchema, default: () => ({ spinsSinceLast: 0, isActive: false, windowRemaining: 0, hasWonBefore: false }) },
            p1000: { type: PrizeWindowSchema, default: () => ({ spinsSinceLast: 0, isActive: false, windowRemaining: 0, hasWonBefore: false }) },
            p500: { type: PrizeWindowSchema, default: () => ({ spinsSinceLast: 0, isActive: false, windowRemaining: 0, hasWonBefore: false }) }
        },
        tiers: {
            'BOX-CLASSIC': { type: TierPrizeStateSchema, default: () => ({}) },
            'BOX-ROYAL': { type: TierPrizeStateSchema, default: () => ({}) },
            'BOX-DIAMOND': { type: TierPrizeStateSchema, default: () => ({}) }
        }
    },
    mysteryConfig: {
        available: { type: Boolean, default: true },
        activeBoxId: { type: String, default: 'BOX-CLASSIC' },
        boxes: [{
            id: String,
            name: String,
            badge: String,
            cost: Number,
            primaryColor: String,
            secondaryColor: String,
            prizes: [{
                label: String,
                value: Number,
                odds: String
            }]
        }]
    }
});

const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);
const InvestmentPlan = mongoose.model('InvestmentPlan', InvestmentPlanSchema);
const UserInvestment = mongoose.model('UserInvestment', UserInvestmentSchema);
const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);
const PlatformConfig = mongoose.model('PlatformConfig', PlatformConfigSchema);

// ====================================================================
// 2. DEFAULT PLATFORM CONFIGURATION & ADMIN BOOTSTRAP
// ====================================================================

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

const getReferenceSlotPayouts = () => [
    { id: 1, combo: '7️⃣ 7️⃣ 7️⃣', symbol: '7', name: 'Triple Lucky 7s', label: '₦5000', value: 5000.00, weight: 1, color: '#c91429' },
    { id: 2, combo: '💎 💎 💎', symbol: 'DIAMOND', name: 'Triple Diamonds', label: '₦1000', value: 1000.00, weight: 2, color: '#623aa2' },
    { id: 3, combo: '🔔 🔔 🔔', symbol: 'BELL', name: 'Triple Golden Bells', label: '₦500', value: 500.00, weight: 3, color: '#1b6b6b' },
    { id: 4, combo: '🍉 🍉 🍉', symbol: 'MELON', name: 'Triple Melons', label: '₦300', value: 300.00, weight: 5, color: '#1565c0' },
    { id: 5, combo: '🍇 🍇 🍇', symbol: 'GRAPE', name: 'Triple Grapes', label: '₦200', value: 200.00, weight: 10, color: '#ea691c' },
    { id: 6, combo: '🍋 🍋 🍋', symbol: 'LEMON', name: 'Triple Lemons', label: '₦100', value: 100.00, weight: 15, color: '#f0c330' },
    { id: 7, combo: '🍒 🍒 🍒', symbol: 'CHERRY', name: 'Triple Cherries', label: '₦50', value: 50.00, weight: 20, color: '#278a3f' },
    { id: 8, combo: '🍒 🍋 🍇', symbol: 'MISS', name: 'No Match', label: '₦0', value: 0.00, weight: 40, color: '#111111' }
];

const getReferenceMysteryPrizes = (boostRate = 0) => {
    const baseWeights = [
        { label: '₦50', value: 50.00, weight: 50 * (1 - boostRate * 0.5) },
        { label: '₦100', value: 100.00, weight: 30 * (1 - boostRate * 0.5) },
        { label: '₦200', value: 200.00, weight: 10 * (1 + boostRate) },
        { label: '₦300', value: 300.00, weight: 5 * (1 + boostRate) },
        { label: '₦500', value: 500.00, weight: 3 * (1 + boostRate) },
        { label: '₦1000', value: 1000.00, weight: 1.5 * (1 + boostRate) },
        { label: '₦5000', value: 5000.00, weight: 0.5 * (1 + boostRate) }
    ];
    const total = baseWeights.reduce((sum, item) => sum + item.weight, 0);
    return baseWeights.map(item => ({
        label: item.label,
        value: item.value,
        odds: `${Math.round((item.weight / total) * 100)}%`
    }));
};

const getDefaultPrizeWindows = () => ({
    p5000: { spinsSinceLast: 0, isActive: false, windowRemaining: 0, hasWonBefore: false },
    p1000: { spinsSinceLast: 0, isActive: false, windowRemaining: 0, hasWonBefore: false },
    p500: { spinsSinceLast: 0, isActive: false, windowRemaining: 0, hasWonBefore: false }
});

const getDefaultSpinState = () => ({
    outcomeDeck: [],
    prizes: getDefaultPrizeWindows()
});

const getDefaultSlotState = () => ({
    outcomeDeck: [],
    prizes: getDefaultPrizeWindows()
});

const getDefaultMysteryState = () => ({
    prizes: getDefaultPrizeWindows(),
    tiers: {
        'BOX-CLASSIC': getDefaultPrizeWindows(),
        'BOX-ROYAL': getDefaultPrizeWindows(),
        'BOX-DIAMOND': getDefaultPrizeWindows()
    }
});

function sanitizePrizeEntry(entry) {
    return {
        spinsSinceLast: Number.isFinite(Number(entry?.spinsSinceLast)) ? Number(entry.spinsSinceLast) : 0,
        isActive: Boolean(entry?.isActive),
        windowRemaining: Number.isFinite(Number(entry?.windowRemaining)) ? Number(entry.windowRemaining) : 0,
        hasWonBefore: Boolean(entry?.hasWonBefore)
    };
}

function sanitizePrizeGroup(group) {
    let modified = false;
    if (!group) return { group: getDefaultPrizeWindows(), modified: true };
    ['p5000', 'p1000', 'p500'].forEach(key => {
        const cur = group[key];
        if (
            !cur ||
            !Number.isFinite(cur.spinsSinceLast) ||
            typeof cur.isActive !== 'boolean' ||
            !Number.isFinite(cur.windowRemaining) ||
            typeof cur.hasWonBefore !== 'boolean'
        ) {
            group[key] = sanitizePrizeEntry(cur);
            modified = true;
        }
    });
    return { group, modified };
}

function ensureValidSpinState(configDoc) {
    let modified = false;
    if (!configDoc.spinState) {
        configDoc.spinState = getDefaultSpinState();
        return true;
    }
    if (!Array.isArray(configDoc.spinState.outcomeDeck)) {
        configDoc.spinState.outcomeDeck = [];
        modified = true;
    }
    const res = sanitizePrizeGroup(configDoc.spinState.prizes);
    configDoc.spinState.prizes = res.group;
    if (res.modified) modified = true;
    return modified;
}

function ensureValidSlotState(configDoc) {
    let modified = false;
    if (!configDoc.slotState) {
        configDoc.slotState = getDefaultSlotState();
        return true;
    }
    if (!Array.isArray(configDoc.slotState.outcomeDeck)) {
        configDoc.slotState.outcomeDeck = [];
        modified = true;
    }
    const res = sanitizePrizeGroup(configDoc.slotState.prizes);
    configDoc.slotState.prizes = res.group;
    if (res.modified) modified = true;
    return modified;
}

function ensureValidMysteryState(configDoc) {
    let modified = false;
    if (!configDoc.mysteryState) {
        configDoc.mysteryState = getDefaultMysteryState();
        return true;
    }

    const baseRes = sanitizePrizeGroup(configDoc.mysteryState.prizes);
    configDoc.mysteryState.prizes = baseRes.group;
    if (baseRes.modified) modified = true;

    if (!configDoc.mysteryState.tiers) {
        configDoc.mysteryState.tiers = {
            'BOX-CLASSIC': getDefaultPrizeWindows(),
            'BOX-ROYAL': getDefaultPrizeWindows(),
            'BOX-DIAMOND': getDefaultPrizeWindows()
        };
        modified = true;
    } else {
        ['BOX-CLASSIC', 'BOX-ROYAL', 'BOX-DIAMOND'].forEach(tierId => {
            const tierRes = sanitizePrizeGroup(configDoc.mysteryState.tiers[tierId]);
            configDoc.mysteryState.tiers[tierId] = tierRes.group;
            if (tierRes.modified) modified = true;
        });
    }

    return modified;
}

function advanceAndSelectPrize(p, boostRate = 0, isMysteryBox = false) {
    const threshold5000 = Math.max(1, Math.round(300 * (1 - boostRate)));
    const threshold1000 = Math.max(1, Math.round(150 * (1 - boostRate)));
    const threshold500 = Math.max(1, Math.round(50 * (1 - boostRate)));

    const winLen5000 = Math.round(10 * (1 + boostRate));
    const winLen1000 = Math.round(5 * (1 + boostRate));
    const winLen500First = Math.round(10 * (1 + boostRate));
    const winLen500Next = Math.round(5 * (1 + boostRate));

    if (p.p5000.isActive) {
        p.p5000.windowRemaining--;
        p.p5000.spinsSinceLast++;
    } else {
        p.p5000.spinsSinceLast++;
        if (p.p5000.spinsSinceLast >= threshold5000) {
            p.p5000.isActive = true;
            p.p5000.windowRemaining = winLen5000;
        }
    }

    if (p.p1000.isActive) {
        p.p1000.windowRemaining--;
        p.p1000.spinsSinceLast++;
    } else {
        p.p1000.spinsSinceLast++;
        if (p.p1000.spinsSinceLast >= threshold1000) {
            p.p1000.isActive = true;
            p.p1000.windowRemaining = winLen1000;
        }
    }

    if (p.p500.isActive) {
        p.p500.windowRemaining--;
        p.p500.spinsSinceLast++;
    } else {
        p.p500.spinsSinceLast++;
        if (p.p500.spinsSinceLast >= threshold500) {
            p.p500.isActive = true;
            p.p500.windowRemaining = p.p500.hasWonBefore ? winLen500Next : winLen500First;
        }
    }

    let selected = null;
    if (p.p5000.isActive && p.p5000.windowRemaining <= 1) {
        selected = { value: 5000, weight: 1, id: 'p5000' };
    } else if (p.p1000.isActive && p.p1000.windowRemaining <= 1) {
        selected = { value: 1000, weight: 3, id: 'p1000' };
    } else if (p.p500.isActive && p.p500.windowRemaining <= 1) {
        selected = { value: 500, weight: 5, id: 'p500' };
    } else {
        const highMultiplier = 1 + boostRate;
        const lowMultiplier = Math.max(0.5, 1 - boostRate * 0.5);

        const eligiblePrizes = [];
        if (p.p5000.isActive) eligiblePrizes.push({ value: 5000, weight: 1 * highMultiplier, id: 'p5000' });
        if (p.p1000.isActive) eligiblePrizes.push({ value: 1000, weight: 3 * highMultiplier, id: 'p1000' });
        if (p.p500.isActive) eligiblePrizes.push({ value: 500, weight: 5 * highMultiplier, id: 'p500' });

        if (isMysteryBox) {
            eligiblePrizes.push({ value: 300, weight: 30 * highMultiplier, id: 'base' });
            eligiblePrizes.push({ value: 200, weight: 40 * highMultiplier, id: 'base' });
            eligiblePrizes.push({ value: 100, weight: 60 * lowMultiplier, id: 'base' });
            eligiblePrizes.push({ value: 50, weight: 50 * lowMultiplier, id: 'base' });
        } else {
            eligiblePrizes.push({ value: 300, weight: 60 * highMultiplier, id: 'base' });
            eligiblePrizes.push({ value: 200, weight: 60 * highMultiplier, id: 'base' });
            eligiblePrizes.push({ value: 100, weight: 50 * lowMultiplier, id: 'base' });
            eligiblePrizes.push({ value: 50, weight: 30 * lowMultiplier, id: 'base' });
        }

        const totalWeight = eligiblePrizes.reduce((s, pr) => s + pr.weight, 0);
        let rand = Math.random() * totalWeight;
        selected = eligiblePrizes[0];
        for (const pr of eligiblePrizes) {
            rand -= pr.weight;
            if (rand <= 0) {
                selected = pr;
                break;
            }
        }
    }

    if (selected.id === 'p5000') {
        p.p5000.isActive = false;
        p.p5000.spinsSinceLast = 0;
        p.p5000.windowRemaining = 0;
        p.p5000.hasWonBefore = true;
    } else if (selected.id === 'p1000') {
        p.p1000.isActive = false;
        p.p1000.spinsSinceLast = 0;
        p.p1000.windowRemaining = 0;
        p.p1000.hasWonBefore = true;
    } else if (selected.id === 'p500') {
        p.p500.isActive = false;
        p.p500.spinsSinceLast = 0;
        p.p500.windowRemaining = 0;
        p.p500.hasWonBefore = true;
    }

    return selected;
}

const getBoxBoostRate = (box) => {
    if (!box) return 0;
    if (box.id === 'BOX-DIAMOND' || (box.name && box.name.toLowerCase().includes('obsidian'))) return 0.20;
    if (box.id === 'BOX-ROYAL' || (box.name && box.name.toLowerCase().includes('golden'))) return 0.10;
    return 0;
};

const getDefaultBoxes = () => [
    {
        id: 'BOX-CLASSIC',
        name: 'Classic Pink Box',
        badge: 'POPULAR',
        cost: 200.00,
        primaryColor: '#f02e6e',
        secondaryColor: '#b0174b',
        prizes: getReferenceMysteryPrizes(0)
    },
    {
        id: 'BOX-ROYAL',
        name: 'Golden Royal Box',
        badge: 'HIGH ODDS',
        cost: 250.00,
        primaryColor: '#d97706',
        secondaryColor: '#78350f',
        prizes: getReferenceMysteryPrizes(0.10)
    },
    {
        id: 'BOX-DIAMOND',
        name: 'Obsidian VIP Box',
        badge: 'VIP MAX',
        cost: 300.00,
        primaryColor: '#7c3aed',
        secondaryColor: '#3b0764',
        prizes: getReferenceMysteryPrizes(0.20)
    }
];

function generateId(prefix) {
    return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

async function initializeInvestments() {
    const count = await InvestmentPlan.countDocuments();
    if (count === 0) {
        await InvestmentPlan.create([
            { planId: generateId('PLN'), name: 'Basic Plan', cost: 1000, payoutFrequency: 'Maturity', dailyRoiPercentage: 0, returnAmount: 2000, durationDays: 3, isActive: true },
            { planId: generateId('PLN'), name: 'Standard Plan', cost: 2000, payoutFrequency: 'Maturity', dailyRoiPercentage: 0, returnAmount: 3500, durationDays: 5, isActive: true },
            { planId: generateId('PLN'), name: 'Premium Plan', cost: 3000, payoutFrequency: 'Maturity', dailyRoiPercentage: 0, returnAmount: 5000, durationDays: 7, isActive: true }
        ]);
        console.log('✅ Initialized default Synthetic Plans.');
    }
}

async function initializePlatform() {
    let config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' });

    if (!config) {
        await PlatformConfig.create({
            singletonKey: 'GLOBAL_CONFIG',
            settings: {
                currency: '₦',
                minRecharge: 1000,
                maxRecharge: 3000,
                minWithdrawal: 1000,
                regBonus: 0,
                instantRechargeApproval: false,
                maintenanceMode: false,
                enableConfetti: true,
                soundEnabled: true,
                bankDetails: { bankName: 'Moniepoint MFB', accountNumber: '1234567890', accountName: 'LuckyVault Gaming' }
            },
            referralConfig: { available: true, level1Percent: 10, level2Percent: 3, level3Percent: 1 },
            wheelConfig: { available: true, spinCost: 250.00, segments: getReferenceWheelSegments() },
            spinState: getDefaultSpinState(),
            slotConfig: { available: true, spinCost: 250.00, payouts: getReferenceSlotPayouts() },
            slotState: getDefaultSlotState(),
            mysteryState: getDefaultMysteryState(),
            mysteryConfig: { available: true, activeBoxId: 'BOX-CLASSIC', boxes: getDefaultBoxes() }
        });
        console.log('✅ Initialized default PlatformConfig with NGN (₦) currency.');
        // Reload so downstream migration block sees the freshly created config
        config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' });
    } else {
        let needsMigration = false;

        // Only initialize missing settings fields — never overwrite existing admin values
        if (!config.settings) {
            config.settings = {
                currency: '₦',
                minRecharge: 1000,
                maxRecharge: 3000,
                minWithdrawal: 1000,
                regBonus: 0,
                instantRechargeApproval: false,
                maintenanceMode: false,
                enableConfetti: true,
                soundEnabled: true,
                bankDetails: { bankName: 'Moniepoint MFB', accountNumber: '1234567890', accountName: 'LuckyVault Gaming' }
            };
            config.markModified('settings');
            needsMigration = true;
        } else {
            let settingsUpdated = false;
            if (config.settings.currency === undefined || config.settings.currency === null || config.settings.currency === '') {
                config.settings.currency = '₦';
                settingsUpdated = true;
            }
            if (config.settings.minRecharge === undefined || config.settings.minRecharge === null) {
                config.settings.minRecharge = 1000;
                settingsUpdated = true;
            }
            if (config.settings.maxRecharge === undefined || config.settings.maxRecharge === null) {
                config.settings.maxRecharge = 3000;
                settingsUpdated = true;
            }
            if (config.settings.minWithdrawal === undefined || config.settings.minWithdrawal === null) {
                config.settings.minWithdrawal = 1000;
                settingsUpdated = true;
                console.log('✅ Migrated settings with minWithdrawal default (₦1000).');
            }
            if (config.settings.regBonus === undefined || config.settings.regBonus === null) {
                config.settings.regBonus = 0;
                settingsUpdated = true;
            }
            if (!config.settings.bankDetails) {
                config.settings.bankDetails = { bankName: 'Moniepoint MFB', accountNumber: '1234567890', accountName: 'LuckyVault Gaming' };
                settingsUpdated = true;
            }
            if (settingsUpdated) {
                config.markModified('settings');
                needsMigration = true;
            }
        }

        if (!config.referralConfig) {
            config.referralConfig = { available: true, level1Percent: 10, level2Percent: 3, level3Percent: 1 };
            config.markModified('referralConfig');
            needsMigration = true;
            console.log('✅ Initialized default Referral configuration.');
        }

        if (ensureValidSpinState(config)) {
            config.markModified('spinState');
            needsMigration = true;
            console.log('✅ Sanitized & migrated spinState configuration.');
        }

        if (ensureValidSlotState(config)) {
            config.markModified('slotState');
            needsMigration = true;
            console.log('✅ Sanitized & migrated slotState configuration.');
        }

        if (!config.slotConfig || !Array.isArray(config.slotConfig.payouts) || config.slotConfig.payouts.length === 0) {
            config.slotConfig = {
                available: true,
                spinCost: 250.00,
                payouts: getReferenceSlotPayouts()
            };
            config.markModified('slotConfig');
            needsMigration = true;
            console.log('✅ Initialized default 777 Jackpot Slot configuration.');
        }

        if (ensureValidMysteryState(config)) {
            config.markModified('mysteryState');
            needsMigration = true;
            console.log('✅ Sanitized & migrated mysteryState configuration.');
        }

        if (!config.wheelConfig || !Array.isArray(config.wheelConfig.segments) || config.wheelConfig.segments.length === 0) {
            config.wheelConfig = { available: true, spinCost: 250.00, segments: getReferenceWheelSegments() };
            config.markModified('wheelConfig');
            needsMigration = true;
            console.log('✅ Initialized default Wheel configuration.');
        }

        if (!config.mysteryConfig || !Array.isArray(config.mysteryConfig.boxes) || config.mysteryConfig.boxes.length === 0) {
            config.mysteryConfig = { available: true, activeBoxId: 'BOX-CLASSIC', boxes: getDefaultBoxes() };
            config.markModified('mysteryConfig');
            needsMigration = true;
            console.log('✅ Initialized default Mystery Boxes configuration.');
        }

        if (needsMigration) {
            await config.save();
            console.log('✅ Saved database configuration updates.');
        }
    }

    // ------------------------------------------------------------------
    // One-time migration: mark pre-deploy Completed recharges as credited.
    // This protects against double-crediting pre-existing transactions
    // when the crash-recovery fallback in creditRechargeTransaction runs.
    // ------------------------------------------------------------------
    if (!config.rechargeMigrationV1Done) {
        const migrationResult = await Transaction.updateMany(
            { type: 'RECHARGE', status: 'Completed', balanceCredited: { $ne: true } },
            { $set: { balanceCredited: true } }
        );
        config.rechargeMigrationV1Done = true;
        await config.save();
        if (migrationResult.modifiedCount > 0) {
            console.log(`✅ Migration: marked ${migrationResult.modifiedCount} pre-existing Completed recharge(s) as balanceCredited=true.`);
        } else {
            console.log('✅ Migration: no pre-existing Completed recharges required backfill.');
        }
    }

    await initializeInvestments();

    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
        const adminEmail = (process.env.ADMIN_EMAIL || 'admin@luckyvault.io').toLowerCase().trim();
        const adminPass = process.env.ADMIN_PASSWORD || 'AdminSecret99!';
        const adminPhone = process.env.ADMIN_PHONE || '+234 (800) 555-0199';
        const passwordHash = await bcrypt.hash(adminPass, 12);

        await User.create({
            userId: generateId('USR'),
            name: 'Admin Operator',
            email: adminEmail,
            phone: adminPhone,
            passwordHash,
            role: 'admin',
            status: 'Active',
            balance: 0
        });
        console.log(`✅ Default Admin account created (${adminEmail}).`);
    }
}

// ====================================================================
// 3. AUTHENTICATION & SECURITY MIDDLEWARE
// ====================================================================

const requireAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Authentication required. Please sign in.' });
        }
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, ACTIVE_JWT_SECRET);

        const user = await User.findOne({ userId: decoded.userId });
        if (!user) {
            return res.status(401).json({ message: 'Session invalid. User account not found.' });
        }
        if (user.status === 'Suspended') {
            return res.status(403).json({ message: 'Your account has been suspended. Please contact support.' });
        }

        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Session expired or invalid. Please sign in again.' });
    }
};

const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden: Administrator privileges required.' });
    }
    next();
};

// Accepts either a registered-user JWT or a guest JWT
const requireChatAccess = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Authentication required.' });
        }
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, ACTIVE_JWT_SECRET);

        if (decoded.type === 'guest') {
            req.guest = {
                guestChatId: decoded.guestChatId,
                guestName: decoded.guestName,
                guestEmail: decoded.guestEmail
            };
            req.chatUserId = decoded.guestChatId;
            req.chatRole = 'guest';
            return next();
        }

        const user = await User.findOne({ userId: decoded.userId });
        if (!user) return res.status(401).json({ message: 'Session invalid. User not found.' });
        if (user.status === 'Suspended') return res.status(403).json({ message: 'Account suspended.' });

        req.user = user;
        req.chatUserId = user.userId;
        req.chatRole = user.role;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid or expired chat token.' });
    }
};

// ====================================================================
// 4. HELPER FUNCTIONS (Weighted Server RNG, State Formatter & Referral Engine)
// ====================================================================

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function formatRelativeTime(date) {
    if (!date) return 'Just now';
    const diffSec = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} mins ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hrs ago`;
    return new Date(date).toLocaleDateString();
}

function formatTransaction(t) {
    if (!t) return null;
    return {
        id: t.txId,
        txId: t.txId,
        userId: t.userId,
        user: t.user,
        type: t.type,
        desc: t.desc,
        cost: Number(t.cost || 0),
        credit: Number(t.credit || 0),
        status: t.status,
        time: formatRelativeTime(t.createdAt)
    };
}

async function distributeReferralCommission(userId, amount) {
    const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' }).lean();
    if (!config || !config.referralConfig || !config.referralConfig.available) return;

    const user = await User.findOne({ userId });
    if (!user || !user.referredBy) return;

    const levels = [
        config.referralConfig.level1Percent || 0,
        config.referralConfig.level2Percent || 0,
        config.referralConfig.level3Percent || 0
    ];

    let currentUser = user;
    for (let i = 0; i < 3; i++) {
        if (!currentUser.referredBy) break;

        const referrer = await User.findOne({ userId: currentUser.referredBy });
        if (!referrer) break;

        const percent = levels[i];
        if (percent > 0) {
            const commission = Number((amount * (percent / 100)).toFixed(2));
            if (commission > 0) {
                referrer.balance = Number((referrer.balance + commission).toFixed(2));
                referrer.referralEarnings = Number(((referrer.referralEarnings || 0) + commission).toFixed(2));
                await referrer.save();

                await Transaction.create({
                    txId: generateId('TX'),
                    userId: referrer.userId,
                    user: referrer.name,
                    type: 'REFERRAL_COMMISSION',
                    desc: `Level ${i + 1} Referral Commission (${percent}%) from ${user.name}`,
                    cost: 0,
                    credit: commission,
                    status: 'Completed'
                });
            }
        }
        currentUser = referrer;
    }
}

// --------------------------------------------------------------------
// Helper: Atomic, Idempotent Recharge Crediting
//
// Two-phase lock prevents the classic "marked Completed but balance
// never incremented" crash window. Also rescues transactions that a
// prior process flipped to Rejected via processExpiredRecharges, and
// recovers Completed-but-uncredited orphans from mid-write crashes.
// --------------------------------------------------------------------
async function creditRechargeTransaction(txRef) {
    try {
        // Phase 1: transition Pending/Rejected -> Completed (atomic)
        let txDoc = await Transaction.findOneAndUpdate(
            { txId: txRef, type: 'RECHARGE', status: { $in: ['Pending', 'Rejected'] } },
            { $set: { status: 'Completed' } },
            { new: true }
        );

        // Crash-recovery: if no Pending/Rejected row matched, look for a
        // Completed transaction whose credit flag was never committed.
        if (!txDoc) {
            txDoc = await Transaction.findOne({
                txId: txRef,
                type: 'RECHARGE',
                status: 'Completed',
                balanceCredited: { $ne: true }
            });
        }

        if (!txDoc) return null;

        // Phase 2: atomically claim the credit flag — only one caller wins
        const creditLocked = await Transaction.findOneAndUpdate(
            { _id: txDoc._id, balanceCredited: { $ne: true } },
            { $set: { balanceCredited: true } },
            { new: true }
        );

        if (!creditLocked) return txDoc;

        await User.findOneAndUpdate(
            { userId: creditLocked.userId },
            { $inc: { balance: Number(Number(creditLocked.credit).toFixed(2)) } }
        );

        console.log(`✅ Credited recharge ${txRef} (+${creditLocked.credit}) to user ${creditLocked.userId}`);
        return creditLocked;
    } catch (err) {
        console.error(`creditRechargeTransaction error for ${txRef}:`, err);
        return null;
    }
}

async function buildUserState(userDoc) {
    const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' }).lean();
    const isAdmin = userDoc.role === 'admin';

    const txQuery = isAdmin ? {} : { userId: userDoc.userId };
    const transactions = await Transaction.find(txQuery).sort({ createdAt: -1 }).limit(150).lean();

    const allPlans = await InvestmentPlan.find().sort({ cost: 1 }).lean();
    const userInvestments = await UserInvestment.find(txQuery).sort({ createdAt: -1 }).limit(150).lean();

    let usersList = [];
    if (isAdmin) {
        const allUsers = await User.find({}).sort({ createdAt: -1 }).lean();
        usersList = allUsers.map(u => ({
            id: u.userId,
            name: u.name,
            email: u.email,
            phone: u.phone,
            role: u.role,
            status: u.status,
            balance: u.balance,
            games: u.games
        }));
    }

    return {
        settings: config.settings,
        referralConfig: config.referralConfig || { available: true, level1Percent: 10, level2Percent: 3, level3Percent: 1 },
        currentUser: {
            id: userDoc.userId,
            name: userDoc.name,
            email: userDoc.email,
            phone: userDoc.phone,
            role: userDoc.role,
            status: userDoc.status,
            balance: userDoc.balance,
            spinsCount: userDoc.spinsCount || 0,
            boxesCount: userDoc.boxesCount || 0,
            slotsCount: userDoc.slotsCount || 0,
            totalWon: userDoc.totalWon || 0,
            referralEarnings: userDoc.referralEarnings || 0,
            referralCode: userDoc.userId,
            referralsCount: await User.countDocuments({ referredBy: userDoc.userId }),
            bankDetails: {
                bankName: userDoc.bankDetails?.bankName || '',
                accountNumber: userDoc.bankDetails?.accountNumber || '',
                accountName: userDoc.bankDetails?.accountName || ''
            }
        },
        users: usersList,
        wheelConfig: config.wheelConfig,
        slotConfig: config.slotConfig || { available: true, spinCost: 250.00, payouts: getReferenceSlotPayouts() },
        mysteryConfig: config.mysteryConfig,
        transactions: transactions.map(formatTransaction),
        investmentPlans: allPlans.map(p => ({
            id: p.planId,
            name: p.name,
            cost: p.cost,
            payoutFrequency: p.payoutFrequency || 'Maturity',
            dailyRoiPercentage: p.dailyRoiPercentage || 0,
            returnAmount: p.returnAmount,
            durationDays: p.durationDays,
            isActive: p.isActive
        })),
        investments: userInvestments.map(inv => ({
            id: inv.invId,
            userId: inv.userId,
            user: inv.user,
            planId: inv.planId,
            planName: inv.planName,
            cost: inv.cost,
            payoutFrequency: inv.payoutFrequency || 'Maturity',
            dailyRoiPercentage: inv.dailyRoiPercentage || 0,
            dailyPayoutAmount: inv.dailyPayoutAmount || 0,
            returnAmount: inv.returnAmount,
            completedPayouts: inv.completedPayouts || 0,
            durationDays: inv.durationDays || 1,
            nextPayoutDate: inv.nextPayoutDate,
            maturityDate: inv.maturityDate,
            status: inv.status,
            time: formatRelativeTime(inv.createdAt)
        }))
    };
}

// ====================================================================
// 5. REST API ROUTES
// ====================================================================

app.get('/api/public/config', async (req, res) => {
    try {
        const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' }).lean();
        const activePlans = await InvestmentPlan.find({ isActive: true }).sort({ cost: 1 }).lean();
        res.json({
            settings: config.settings,
            referralConfig: config.referralConfig || { available: true, level1Percent: 10, level2Percent: 3, level3Percent: 1 },
            wheelConfig: config.wheelConfig,
            slotConfig: config.slotConfig || { available: true, spinCost: 250.00, payouts: getReferenceSlotPayouts() },
            mysteryConfig: config.mysteryConfig,
            investmentPlans: activePlans.map(p => ({
                id: p.planId,
                name: p.name,
                cost: p.cost,
                payoutFrequency: p.payoutFrequency || 'Maturity',
                dailyRoiPercentage: p.dailyRoiPercentage || 0,
                returnAmount: p.returnAmount,
                durationDays: p.durationDays,
                isActive: p.isActive
            }))
        });
    } catch (err) {
        res.status(500).json({ message: 'Failed to load platform configuration.' });
    }
});

app.get('/api/bootstrap', requireAuth, async (req, res) => {
    try {
        const state = await buildUserState(req.user);
        res.json(state);
    } catch (err) {
        res.status(500).json({ message: 'Failed to load account state.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        if (!identifier || !password) {
            return res.status(400).json({ message: 'Please enter your email/phone and password.' });
        }

        const cleanId = String(identifier).trim();

        let query = {};
        if (cleanId.includes('@')) {
            query = { email: cleanId.toLowerCase() };
        } else {
            const digits = cleanId.replace(/\D/g, '');
            if (digits.length >= 7) {
                const coreDigits = digits.slice(-7);
                const regexPattern = coreDigits.split('').join('\\D*');
                query = {
                    $or: [
                        { phone: cleanId },
                        { phone: { $regex: regexPattern } }
                    ]
                };
            } else {
                query = { phone: cleanId };
            }
        }

        const user = await User.findOne(query);

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials. Account not found.' });
        }

        const validPass = await bcrypt.compare(String(password), user.passwordHash);
        if (!validPass) {
            return res.status(401).json({ message: 'Invalid credentials. Incorrect password.' });
        }

        if (user.status === 'Suspended') {
            return res.status(403).json({ message: 'Your account is currently suspended. Contact support.' });
        }

        const token = jwt.sign({ userId: user.userId, role: user.role }, ACTIVE_JWT_SECRET, { expiresIn: '24h' });
        const state = await buildUserState(user);

        res.json({
            token,
            user: state.currentUser,
            redirectRole: user.role,
            state
        });
    } catch (err) {
        res.status(500).json({ message: 'An error occurred during sign in.' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, phone, password, referredBy } = req.body;
        const cleanEmail = String(email || '').toLowerCase().trim();
        const cleanPhone = String(phone || '').trim();

        if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return res.status(400).json({ message: 'Please provide a valid email address.' });
        }
        if (cleanPhone.replace(/\D/g, '').length < 7) {
            return res.status(400).json({ message: 'Please provide a valid phone number.' });
        }
        if (!password || String(password).length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
        }

        const digits = cleanPhone.replace(/\D/g, '');
        const coreDigits = digits.length >= 7 ? digits.slice(-7) : digits;
        const regexPattern = coreDigits.split('').join('\\D*');

        const existing = await User.findOne({
            $or: [
                { email: cleanEmail },
                { phone: cleanPhone },
                { phone: { $regex: regexPattern } }
            ]
        });

        if (existing) {
            return res.status(409).json({ message: 'An account with this email or phone number already exists.' });
        }

        const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' });
        const bonus = Math.max(0, Number(config?.settings?.regBonus ?? 0));
        const passwordHash = await bcrypt.hash(String(password), 12);
        const newUserId = generateId('USR');

        const rawName = String(name || cleanEmail.split('@')[0]).replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
        const displayName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : 'Player';

        let validReferrer = null;
        if (referredBy) {
            validReferrer = await User.findOne({ userId: String(referredBy).trim() });
        }

        const newUser = await User.create({
            userId: newUserId,
            name: displayName,
            email: cleanEmail,
            phone: cleanPhone,
            passwordHash,
            role: 'player',
            status: 'Active',
            balance: bonus,
            referredBy: validReferrer ? validReferrer.userId : null
        });

        if (bonus > 0) {
            await Transaction.create({
                txId: generateId('TX'),
                userId: newUser.userId,
                user: newUser.name,
                type: 'RECHARGE',
                desc: 'Welcome Registration Bonus',
                cost: 0,
                credit: bonus,
                status: 'Completed',
                balanceCredited: true
            });
        }

        const token = jwt.sign({ userId: newUser.userId, role: newUser.role }, ACTIVE_JWT_SECRET, { expiresIn: '24h' });
        const state = await buildUserState(newUser);

        res.status(201).json({ token, user: state.currentUser, state });
    } catch (err) {
        res.status(500).json({ message: 'Registration failed. Please try again.' });
    }
});

// --------------------------------------------------------------------
// Korapay: Initialize Deposit Checkout (returns checkout URL)
// --------------------------------------------------------------------
app.post('/api/wallet/recharge', requireAuth, async (req, res) => {
    try {
        const { amount } = req.body;
        const num = Number(amount);
        const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' });

        if (!Number.isFinite(num) || num < config.settings.minRecharge || num > config.settings.maxRecharge) {
            return res.status(400).json({
                message: `Recharge amount must be between ${config.settings.currency}${config.settings.minRecharge} and ${config.settings.currency}${config.settings.maxRecharge}.`
            });
        }

        const txRef = generateId('TX');

        const koraResponse = await fetch('https://api.korapay.com/merchant/api/v1/charges/initialize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${KORAPAY_SECRET_KEY}`
            },
            body: JSON.stringify({
                reference: txRef,
                amount: num,
                currency: 'NGN',
                customer: {
                    name: req.user.name,
                    email: req.user.email
                },
                notification_url: `${req.protocol}://${req.get('host')}/api/wallet/korapay-webhook`,
                redirect_url: req.headers.referer || `${req.protocol}://${req.get('host')}/`
            })
        });

        const koraData = await koraResponse.json();
        if (!koraResponse.ok || !koraData.status) {
            return res.status(400).json({ message: 'Failed to initialize payment with Korapay.' });
        }

        const txDoc = await Transaction.create({
            txId: txRef,
            userId: req.user.userId,
            user: req.user.name,
            type: 'RECHARGE',
            desc: `Korapay Deposit - ${txRef}`,
            cost: 0,
            credit: Number(num.toFixed(2)),
            status: 'Pending',
            balanceCredited: false
        });

        const state = await buildUserState(req.user);
        res.json({ tx: formatTransaction(txDoc), state, checkoutUrl: koraData.data.checkout_url });
    } catch (err) {
        console.error('Korapay Recharge Init Error:', err);
        res.status(500).json({ message: 'Failed to submit wallet recharge.' });
    }
});

// --------------------------------------------------------------------
// Korapay: Webhook for Deposit Confirmation
// Korapay signs ONLY the `data` object (JSON.stringify(req.body.data)),
// NOT the full raw body. We verify against the data-hash primarily and
// fall back to the raw-body hash for compatibility with any future
// payload shape change. Comparison uses timingSafeEqual.
// --------------------------------------------------------------------
app.post('/api/wallet/korapay-webhook', async (req, res) => {
    try {
        if (!KORAPAY_SECRET_KEY) {
            console.error('[WEBHOOK] KORAPAY_SECRET_KEY missing — cannot verify signature.');
            return res.status(500).send('Server misconfigured');
        }

        const signature = req.headers['x-korapay-signature'];
        if (!signature || !req.body || !req.body.data) {
            return res.status(400).send('Invalid payload');
        }

        const dataHash = crypto
            .createHmac('sha256', KORAPAY_SECRET_KEY)
            .update(JSON.stringify(req.body.data))
            .digest('hex');

        const rawBody = req.rawBody || JSON.stringify(req.body);
        const fullHash = crypto
            .createHmac('sha256', KORAPAY_SECRET_KEY)
            .update(rawBody)
            .digest('hex');

        const safeEqualHex = (a, b) => {
            if (typeof a !== 'string' || typeof b !== 'string') return false;
            if (a.length !== b.length) return false;
            try {
                return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
            } catch (_) {
                return false;
            }
        };

        if (!safeEqualHex(signature, dataHash) && !safeEqualHex(signature, fullHash)) {
            console.warn(`⚠️ Korapay webhook signature mismatch for ref: ${req.body?.data?.reference}`);
            return res.status(401).send('Invalid signature');
        }

        const { event, data } = req.body;
        if (event === 'charge.success' && (data.status === 'success' || !data.status)) {
            // Persist payload for audit (only if not yet Completed, so the
            // payload that actually triggered crediting is retained).
            await Transaction.updateOne(
                { txId: data.reference, type: 'RECHARGE', status: { $ne: 'Completed' } },
                {
                    $set: {
                        korapayReference: data.payment_reference || data.reference,
                        korapayPayload: data
                    }
                }
            );

            // Amount sanity check — log mismatches, still credit the owed amount.
            const existingTx = await Transaction.findOne({ txId: data.reference, type: 'RECHARGE' });
            if (existingTx) {
                const paid = Number(data.amount || 0);
                const owed = Number(existingTx.credit || 0);
                if (Number.isFinite(paid) && paid > 0 && Math.abs(paid - owed) > 0.5) {
                    console.warn(`[WEBHOOK] Amount mismatch ref=${data.reference} paid=${paid} expected=${owed} — crediting expected.`);
                }
            }

            await creditRechargeTransaction(data.reference);
        }

        res.status(200).send('Webhook received');
    } catch (err) {
        console.error('Korapay Webhook Error:', err);
        res.status(500).send('Webhook error');
    }
});

// --------------------------------------------------------------------
// Korapay: Active Verification Endpoint (User-scoped)
// Called on redirect back from Korapay (?reference=TX-...) or manually.
// --------------------------------------------------------------------
app.post('/api/wallet/verify-recharge', requireAuth, async (req, res) => {
    try {
        const { reference } = req.body;
        const txRef = String(reference || '').trim();
        if (!txRef) {
            return res.status(400).json({ message: 'Transaction reference is required.' });
        }

        const existingTx = await Transaction.findOne({
            txId: txRef,
            type: 'RECHARGE',
            userId: req.user.userId
        });
        if (!existingTx) {
            return res.status(404).json({ message: 'Recharge transaction not found.' });
        }

        if (existingTx.status === 'Completed' && existingTx.balanceCredited) {
            const freshUser = await User.findOne({ userId: req.user.userId });
            const state = await buildUserState(freshUser);
            return res.json({
                verified: true,
                alreadyCredited: true,
                tx: formatTransaction(existingTx),
                state
            });
        }

        // Crash recovery: status Completed but credit flag never committed
        if (existingTx.status === 'Completed' && !existingTx.balanceCredited) {
            const creditedTx = await creditRechargeTransaction(txRef);
            const freshUser = await User.findOne({ userId: req.user.userId });
            const state = await buildUserState(freshUser);
            return res.json({
                verified: true,
                recovered: true,
                tx: formatTransaction(creditedTx || existingTx),
                state
            });
        }

        const koraRes = await fetch(
            `https://api.korapay.com/merchant/api/v1/charges/${encodeURIComponent(txRef)}`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${KORAPAY_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const koraData = await koraRes.json().catch(() => ({}));
        const chargeStatus = koraData?.data?.status;

        if (koraRes.ok && koraData.status && chargeStatus === 'success') {
            const creditedTx = await creditRechargeTransaction(txRef);
            const freshUser = await User.findOne({ userId: req.user.userId });
            const state = await buildUserState(freshUser);
            return res.json({
                verified: true,
                tx: formatTransaction(creditedTx || existingTx),
                state
            });
        }

        const freshUser = await User.findOne({ userId: req.user.userId });
        const state = await buildUserState(freshUser);
        return res.json({
            verified: false,
            chargeStatus: chargeStatus || 'pending',
            message: `Payment status is currently '${chargeStatus || 'pending'}'.`,
            state
        });
    } catch (err) {
        console.error('Verify Recharge Error:', err);
        res.status(500).json({ message: 'Failed to verify recharge status with Korapay.' });
    }
});

app.put('/api/user/bank-details', requireAuth, async (req, res) => {
    try {
        const { bankName, accountNumber, accountName } = req.body;
        const cleanBank = String(bankName || '').trim();
        const cleanAcct = String(accountNumber || '').trim();
        const cleanName = String(accountName || '').trim();

        if (!cleanBank || !cleanAcct || !cleanName) {
            return res.status(400).json({ message: 'Bank name, account number, and account name are required.' });
        }
        if (cleanAcct.replace(/\D/g, '').length < 6) {
            return res.status(400).json({ message: 'Please enter a valid account number.' });
        }

        const user = await User.findOneAndUpdate(
            { userId: req.user.userId },
            {
                $set: {
                    'bankDetails.bankName': cleanBank,
                    'bankDetails.accountNumber': cleanAcct,
                    'bankDetails.accountName': cleanName
                }
            },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ message: 'User account not found.' });
        }

        const state = await buildUserState(user);
        res.json({ state });
    } catch (err) {
        res.status(500).json({ message: 'Failed to save bank details.' });
    }
});

app.post('/api/wallet/withdraw', requireAuth, async (req, res) => {
    try {
        const amount = Number(req.body.amount);
        const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' });
        const minWithdrawal = Number(config.settings.minWithdrawal ?? 1000);

        if (!Number.isFinite(amount) || amount < minWithdrawal) {
            return res.status(400).json({ message: `Minimum withdrawal is ${config.settings.currency}${minWithdrawal.toFixed(2)}.` });
        }
        if (Number(req.user.balance) < amount) {
            return res.status(400).json({ message: 'Insufficient wallet balance for this withdrawal.' });
        }

        const bank = req.user.bankDetails || {};
        if (!bank.bankName || !bank.accountNumber || !bank.accountName) {
            return res.status(400).json({ message: 'Please set up your bank account before requesting a withdrawal.' });
        }

        const updatedUser = await User.findOneAndUpdate(
            { userId: req.user.userId, status: 'Active', balance: { $gte: amount } },
            { $inc: { balance: -Number(amount.toFixed(2)) } },
            { new: true }
        );
        if (!updatedUser) {
            return res.status(400).json({ message: 'Insufficient wallet balance for this withdrawal.' });
        }

        let txDoc;
        try {
            txDoc = await Transaction.create({
                txId: generateId('TX'),
                userId: req.user.userId,
                user: req.user.name,
                type: 'WITHDRAWAL',
                desc: `Withdrawal to ${bank.bankName} - ${bank.accountNumber} (${bank.accountName})`,
                cost: Number(amount.toFixed(2)),
                credit: 0,
                status: 'Pending',
                balanceCredited: false
            });
        } catch (txErr) {
            await User.findOneAndUpdate(
                { userId: req.user.userId },
                { $inc: { balance: Number(amount.toFixed(2)) } }
            );
            throw txErr;
        }

        const state = await buildUserState(updatedUser);
        res.json({ tx: formatTransaction(txDoc), state });
    } catch (err) {
        res.status(500).json({ message: 'Failed to submit withdrawal request.' });
    }
});

// INVESTMENT PLAYER ROUTE
app.post('/api/investments/purchase', requireAuth, async (req, res) => {
    try {
        const { planId } = req.body;
        const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' }).lean();

        if (config.settings.maintenanceMode) {
            return res.status(403).json({ message: 'Platform is currently paused for maintenance.' });
        }

        const plan = await InvestmentPlan.findOne({ planId, isActive: true });
        if (!plan) {
            return res.status(404).json({ message: 'Synthetic plan not found or no longer active.' });
        }

        if (Number(req.user.balance) < plan.cost) {
            return res.status(400).json({ message: `Insufficient wallet balance. Plan requires ${config.settings.currency}${plan.cost.toFixed(2)}.` });
        }

        const updatedUser = await User.findOneAndUpdate(
            { userId: req.user.userId, status: 'Active', balance: { $gte: plan.cost } },
            { $inc: { balance: -plan.cost } },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(400).json({ message: `Insufficient wallet balance. Plan requires ${config.settings.currency}${plan.cost.toFixed(2)}.` });
        }

        const maturityDate = new Date();
        maturityDate.setDate(maturityDate.getDate() + plan.durationDays);

        const freq = plan.payoutFrequency || 'Maturity';
        let dailyPayoutAmount = 0;
        let nextPayoutDate = null;

        if (freq === 'Daily') {
            dailyPayoutAmount = Number((plan.cost * ((plan.dailyRoiPercentage || 0) / 100)).toFixed(2));
            nextPayoutDate = new Date();
            nextPayoutDate.setDate(nextPayoutDate.getDate() + 1);
        }

        const newInv = await UserInvestment.create({
            invId: generateId('INV'),
            userId: updatedUser.userId,
            user: updatedUser.name,
            planId: plan.planId,
            planName: plan.name,
            cost: plan.cost,
            payoutFrequency: freq,
            dailyRoiPercentage: plan.dailyRoiPercentage || 0,
            dailyPayoutAmount: dailyPayoutAmount,
            returnAmount: plan.returnAmount,
            durationDays: plan.durationDays,
            nextPayoutDate: nextPayoutDate,
            maturityDate: maturityDate,
            status: 'Active'
        });

        await Transaction.create({
            txId: generateId('TX'),
            userId: updatedUser.userId,
            user: updatedUser.name,
            type: 'INVEST_BUY',
            desc: `Purchased Synthetic Plan: ${plan.name}`,
            cost: plan.cost,
            credit: 0,
            status: 'Completed',
            balanceCredited: true
        });

        await distributeReferralCommission(updatedUser.userId, plan.cost);

        const state = await buildUserState(updatedUser);
        res.json({ investment: newInv, state });
    } catch (err) {
        res.status(500).json({ message: 'Failed to purchase synthetic plan. Please try again.' });
    }
});

app.post('/api/games/wheel/spin', requireAuth, async (req, res) => {
    try {
        const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' });
        if (config.settings.maintenanceMode || !config.wheelConfig.available) {
            return res.status(403).json({ message: 'Spin the Wheel is currently paused for maintenance.' });
        }

        const cost = Number(config.wheelConfig.spinCost);
        const segments = config.wheelConfig.segments;
        if (!Array.isArray(segments) || segments.length === 0) {
            return res.status(500).json({ message: 'Wheel segments are not configured.' });
        }

        if (Number(req.user.balance) < cost) {
            return res.status(400).json({
                message: `Insufficient wallet balance. Spin requires ${config.settings.currency}${cost.toFixed(2)}.`
            });
        }

        ensureValidSpinState(config);
        const spinState = config.spinState;
        const p = spinState.prizes;

        if (spinState.outcomeDeck.length === 0) {
            spinState.outcomeDeck = [true, true, true, true, true, true, true, true, false, false];
            shuffleArray(spinState.outcomeDeck);
        }
        const isWin = Boolean(spinState.outcomeDeck.pop());

        const hasMustDropPrize =
            (p.p5000.isActive && p.p5000.windowRemaining <= 1) ||
            (p.p1000.isActive && p.p1000.windowRemaining <= 1) ||
            (p.p500.isActive && p.p500.windowRemaining <= 1);

        let winningSegment = null;
        let prizeVal = 0;

        if (isWin || hasMustDropPrize) {
            const selected = advanceAndSelectPrize(p, 0, false);
            const nonZeroSegments = segments.filter(s => Number(s.value) > 0);
            winningSegment = nonZeroSegments.find(s => Number(s.value) === selected.value) || nonZeroSegments[0] || segments[0];
            prizeVal = Number(winningSegment.value);
        } else {
            if (p.p5000.isActive) {
                p.p5000.windowRemaining--;
                p.p5000.spinsSinceLast++;
            } else {
                p.p5000.spinsSinceLast++;
                if (p.p5000.spinsSinceLast >= 300) { p.p5000.isActive = true; p.p5000.windowRemaining = 10; }
            }

            if (p.p1000.isActive) {
                p.p1000.windowRemaining--;
                p.p1000.spinsSinceLast++;
            } else {
                p.p1000.spinsSinceLast++;
                if (p.p1000.spinsSinceLast >= 150) { p.p1000.isActive = true; p.p1000.windowRemaining = 5; }
            }

            if (p.p500.isActive) {
                p.p500.windowRemaining--;
                p.p500.spinsSinceLast++;
            } else {
                p.p500.spinsSinceLast++;
                if (p.p500.spinsSinceLast >= 50) { p.p500.isActive = true; p.p500.windowRemaining = p.p500.hasWonBefore ? 5 : 10; }
            }

            winningSegment = segments.find(s => Number(s.value) === 0) || segments[segments.length - 1];
            prizeVal = Number(winningSegment.value);
        }

        const winningIndex = segments.findIndex(s => s.id === winningSegment.id);
        const netDelta = Number((prizeVal - cost).toFixed(2));

        const updatedUser = await User.findOneAndUpdate(
            { userId: req.user.userId, status: 'Active', balance: { $gte: cost } },
            {
                $inc: {
                    balance: netDelta,
                    spinsCount: 1,
                    games: 1,
                    totalWon: prizeVal
                }
            },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(400).json({
                message: `Insufficient wallet balance. Spin requires ${config.settings.currency}${cost.toFixed(2)}.`
            });
        }

        config.markModified('spinState');
        await config.save();

        const balanceAfterWager = Number((updatedUser.balance - prizeVal).toFixed(2));

        await Transaction.create({
            txId: generateId('TX'),
            userId: updatedUser.userId,
            user: updatedUser.name,
            type: 'SPIN',
            desc: `Spin the Wheel (${winningSegment.label} Segment)`,
            cost,
            credit: prizeVal,
            status: 'Credited',
            balanceCredited: true
        });

        const state = await buildUserState(updatedUser);
        res.json({
            outcome: { winningIndex, segment: winningSegment, cost, balanceAfterWager },
            state
        });
    } catch (err) {
        res.status(500).json({ message: 'Spin request failed. Please try again.' });
    }
});

app.post('/api/games/slot/spin', requireAuth, async (req, res) => {
    try {
        const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' });
        if (!config.slotConfig || !Array.isArray(config.slotConfig.payouts) || config.slotConfig.payouts.length === 0) {
            config.slotConfig = { available: true, spinCost: 250.00, payouts: getReferenceSlotPayouts() };
            config.markModified('slotConfig');
        }

        if (config.settings.maintenanceMode || !config.slotConfig.available) {
            return res.status(403).json({ message: '777 Jackpot Slot is currently paused for maintenance.' });
        }

        const cost = Number(config.slotConfig.spinCost || 250);
        const payouts = config.slotConfig.payouts;

        if (Number(req.user.balance) < cost) {
            return res.status(400).json({
                message: `Insufficient wallet balance. Slot spin requires ${config.settings.currency}${cost.toFixed(2)}.`
            });
        }

        ensureValidSlotState(config);
        const slotState = config.slotState;
        const p = slotState.prizes;

        if (slotState.outcomeDeck.length === 0) {
            slotState.outcomeDeck = [true, true, true, true, true, true, true, true, false, false];
            shuffleArray(slotState.outcomeDeck);
        }
        const isWin = Boolean(slotState.outcomeDeck.pop());

        const hasMustDropPrize =
            (p.p5000.isActive && p.p5000.windowRemaining <= 1) ||
            (p.p1000.isActive && p.p1000.windowRemaining <= 1) ||
            (p.p500.isActive && p.p500.windowRemaining <= 1);

        const ALL_REEL_SYMBOLS = ['7', 'DIAMOND', 'BELL', 'MELON', 'GRAPE', 'LEMON', 'CHERRY'];
        const VALUE_TO_SYMBOL = {
            5000: '7',
            1000: 'DIAMOND',
            500: 'BELL',
            300: 'MELON',
            200: 'GRAPE',
            100: 'LEMON',
            50: 'CHERRY'
        };

        let winningPayout = null;
        let prizeVal = 0;
        let reels = ['CHERRY', 'LEMON', 'GRAPE'];

        if (isWin || hasMustDropPrize) {
            const selected = advanceAndSelectPrize(p, 0, false);
            const nonZeroPayouts = payouts.filter(item => Number(item.value) > 0);
            winningPayout = nonZeroPayouts.find(item => Number(item.value) === selected.value)
                || nonZeroPayouts[nonZeroPayouts.length - 1]
                || payouts[0];
            prizeVal = Number(winningPayout.value);

            const sym = (winningPayout.symbol && winningPayout.symbol !== 'MISS')
                ? winningPayout.symbol
                : (VALUE_TO_SYMBOL[prizeVal] || 'CHERRY');
            reels = [sym, sym, sym];
        } else {
            if (p.p5000.isActive) {
                p.p5000.windowRemaining--;
                p.p5000.spinsSinceLast++;
            } else {
                p.p5000.spinsSinceLast++;
                if (p.p5000.spinsSinceLast >= 300) { p.p5000.isActive = true; p.p5000.windowRemaining = 10; }
            }

            if (p.p1000.isActive) {
                p.p1000.windowRemaining--;
                p.p1000.spinsSinceLast++;
            } else {
                p.p1000.spinsSinceLast++;
                if (p.p1000.spinsSinceLast >= 150) { p.p1000.isActive = true; p.p1000.windowRemaining = 5; }
            }

            if (p.p500.isActive) {
                p.p500.windowRemaining--;
                p.p500.spinsSinceLast++;
            } else {
                p.p500.spinsSinceLast++;
                if (p.p500.spinsSinceLast >= 50) { p.p500.isActive = true; p.p500.windowRemaining = p.p500.hasWonBefore ? 5 : 10; }
            }

            winningPayout = payouts.find(item => Number(item.value) === 0) || {
                id: 8,
                combo: '🍒 🍋 🍇',
                symbol: 'MISS',
                name: 'No Match',
                label: '₦0',
                value: 0,
                weight: 40
            };
            prizeVal = 0;

            const s1 = ALL_REEL_SYMBOLS[Math.floor(Math.random() * ALL_REEL_SYMBOLS.length)];
            const s2 = ALL_REEL_SYMBOLS[Math.floor(Math.random() * ALL_REEL_SYMBOLS.length)];
            let s3 = ALL_REEL_SYMBOLS[Math.floor(Math.random() * ALL_REEL_SYMBOLS.length)];
            if (s1 === s2 && s2 === s3) {
                s3 = ALL_REEL_SYMBOLS[(ALL_REEL_SYMBOLS.indexOf(s3) + 1) % ALL_REEL_SYMBOLS.length];
            }
            reels = [s1, s2, s3];
        }

        const netDelta = Number((prizeVal - cost).toFixed(2));

        const updatedUser = await User.findOneAndUpdate(
            { userId: req.user.userId, status: 'Active', balance: { $gte: cost } },
            {
                $inc: {
                    balance: netDelta,
                    slotsCount: 1,
                    games: 1,
                    totalWon: prizeVal
                }
            },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(400).json({
                message: `Insufficient wallet balance. Slot spin requires ${config.settings.currency}${cost.toFixed(2)}.`
            });
        }

        config.markModified('slotState');
        await config.save();

        const balanceAfterWager = Number((updatedUser.balance - prizeVal).toFixed(2));

        await Transaction.create({
            txId: generateId('TX'),
            userId: updatedUser.userId,
            user: updatedUser.name,
            type: 'SLOT',
            desc: prizeVal > 0
                ? `777 Jackpot Slot (${winningPayout.name} - ${winningPayout.label})`
                : `777 Jackpot Slot (No Match - ${winningPayout.label})`,
            cost,
            credit: prizeVal,
            status: 'Credited',
            balanceCredited: true
        });

        const state = await buildUserState(updatedUser);
        res.json({
            outcome: {
                reels,
                payout: winningPayout,
                cost,
                balanceAfterWager
            },
            state
        });
    } catch (err) {
        res.status(500).json({ message: 'Slot spin request failed. Please try again.' });
    }
});

app.post('/api/games/mystery-box/open', requireAuth, async (req, res) => {
    try {
        const { boxId } = req.body;
        const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' });
        if (config.settings.maintenanceMode || !config.mysteryConfig.available) {
            return res.status(403).json({ message: 'Mystery Box game is currently paused for maintenance.' });
        }

        const targetBoxId = boxId || config.mysteryConfig.activeBoxId;
        const box = config.mysteryConfig.boxes.find(b => b.id === targetBoxId) || config.mysteryConfig.boxes[0];
        if (!box) {
            return res.status(404).json({ message: 'Selected Mystery Box tier not found.' });
        }

        const cost = Number(box.cost);
        if (Number(req.user.balance) < cost) {
            return res.status(400).json({
                message: `Insufficient wallet balance. Opening ${box.name} costs ${config.settings.currency}${cost.toFixed(2)}.`
            });
        }

        ensureValidMysteryState(config);
        const boostRate = getBoxBoostRate(box);
        const tierState = config.mysteryState.tiers?.[box.id] || config.mysteryState.prizes;
        const selected = advanceAndSelectPrize(tierState, boostRate, true);

        const nonZeroPrizes = (box.prizes || []).filter(pr => Number(pr.value) > 0);
        const prizeObj = nonZeroPrizes.find(pr => Number(pr.value) === selected.value)
            || nonZeroPrizes[0]
            || { label: `₦${selected.value}`, value: selected.value, odds: '27%' };

        const prizeVal = Number(prizeObj.value);
        const netDelta = Number((prizeVal - cost).toFixed(2));

        const updatedUser = await User.findOneAndUpdate(
            { userId: req.user.userId, status: 'Active', balance: { $gte: cost } },
            {
                $inc: {
                    balance: netDelta,
                    boxesCount: 1,
                    games: 1,
                    totalWon: prizeVal
                }
            },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(400).json({
                message: `Insufficient wallet balance. Opening ${box.name} costs ${config.settings.currency}${cost.toFixed(2)}.`
            });
        }

        config.markModified('mysteryState');
        await config.save();

        const balanceAfterWager = Number((updatedUser.balance - prizeVal).toFixed(2));

        await Transaction.create({
            txId: generateId('TX'),
            userId: updatedUser.userId,
            user: updatedUser.name,
            type: 'BOX',
            desc: `${box.name} (${prizeObj.label})`,
            cost,
            credit: prizeVal,
            status: 'Credited',
            balanceCredited: true
        });

        const state = await buildUserState(updatedUser);
        res.json({
            outcome: { box, prizeObj, cost, balanceAfterWager },
            state
        });
    } catch (err) {
        res.status(500).json({ message: 'Mystery Box request failed. Please try again.' });
    }
});

// ====================================================================
// 6. PROTECTED ADMIN PORTAL ENDPOINTS
// ====================================================================

// Admin Investment Plan Routes
app.post('/api/admin/investments', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { name, cost, returnAmount, durationDays, isActive, payoutFrequency, dailyRoiPercentage } = req.body;

        if (!name || Number(cost) <= 0 || Number(returnAmount) <= 0 || Number(durationDays) < 1) {
            return res.status(400).json({ message: 'Please provide valid configuration data for the synthetic plan.' });
        }

        const newPlan = await InvestmentPlan.create({
            planId: generateId('PLN'),
            name: String(name).trim(),
            cost: Number(cost),
            payoutFrequency: payoutFrequency === 'Daily' ? 'Daily' : 'Maturity',
            dailyRoiPercentage: Number(dailyRoiPercentage || 0),
            returnAmount: Number(returnAmount),
            durationDays: Number(durationDays),
            isActive: Boolean(isActive ?? true)
        });

        const state = await buildUserState(req.user);
        res.json({ plan: newPlan, state });
    } catch (err) {
        res.status(500).json({ message: 'Failed to create new synthetic plan.' });
    }
});

app.put('/api/admin/investments/:planId', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { name, cost, returnAmount, durationDays, isActive, payoutFrequency, dailyRoiPercentage } = req.body;

        const plan = await InvestmentPlan.findOne({ planId: req.params.planId });
        if (!plan) {
            return res.status(404).json({ message: 'Synthetic plan not found.' });
        }

        if (name) plan.name = String(name).trim();
        if (cost !== undefined && Number(cost) >= 0) plan.cost = Number(cost);
        if (returnAmount !== undefined && Number(returnAmount) >= 0) plan.returnAmount = Number(returnAmount);
        if (durationDays !== undefined && Number(durationDays) >= 1) plan.durationDays = Number(durationDays);
        if (isActive !== undefined) plan.isActive = Boolean(isActive);
        if (payoutFrequency !== undefined) plan.payoutFrequency = payoutFrequency === 'Daily' ? 'Daily' : 'Maturity';
        if (dailyRoiPercentage !== undefined && Number(dailyRoiPercentage) >= 0) plan.dailyRoiPercentage = Number(dailyRoiPercentage);

        await plan.save();
        const state = await buildUserState(req.user);
        res.json({ plan, state });
    } catch (err) {
        res.status(500).json({ message: 'Failed to update synthetic plan.' });
    }
});

app.delete('/api/admin/investments/:planId', requireAuth, requireAdmin, async (req, res) => {
    try {
        const planId = req.params.planId;
        const activeInvestments = await UserInvestment.countDocuments({ planId, status: 'Active' });

        if (activeInvestments > 0) {
            return res.status(400).json({ message: 'Cannot delete plan. There are active synthetic plans tied to it. Please deactivate it instead.' });
        }

        await InvestmentPlan.findOneAndDelete({ planId });
        const state = await buildUserState(req.user);
        res.json({ message: 'Synthetic plan deleted successfully.', state });
    } catch (err) {
        res.status(500).json({ message: 'Failed to delete synthetic plan.' });
    }
});

app.patch('/api/admin/users/:userId/status', requireAuth, requireAdmin, async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId });
        if (!user) return res.status(404).json({ message: 'User not found.' });
        if (user.userId === req.user.userId) {
            return res.status(400).json({ message: 'You cannot suspend your own administrator account.' });
        }

        user.status = user.status === 'Active' ? 'Suspended' : 'Active';
        await user.save();

        const state = await buildUserState(req.user);
        res.json({ userStatus: user.status, userName: user.name, state });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// --------------------------------------------------------------------
// Admin: Reset a user's password → returns a one-time temp password
// --------------------------------------------------------------------
app.post('/api/admin/users/:userId/reset-password', requireAuth, requireAdmin, async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId });
        if (!user) {
            return res.status(404).json({ message: 'User account not found.' });
        }

        // Generate a 10-char temp password (mixed case + digits, avoids ambiguous chars)
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
        const generateTemp = () => {
            let pw = '';
            for (let i = 0; i < 10; i++) {
                pw += alphabet[crypto.randomInt(0, alphabet.length)];
            }
            return pw;
        };
        let tempPassword = generateTemp();
        let attempts = 0;
        while ((!/[A-Z]/.test(tempPassword) || !/[a-z]/.test(tempPassword) || !/[0-9]/.test(tempPassword)) && attempts < 25) {
            tempPassword = generateTemp();
            attempts++;
        }
        if (!/[A-Z]/.test(tempPassword)) tempPassword = 'A' + tempPassword.slice(1);
        if (!/[a-z]/.test(tempPassword)) tempPassword = tempPassword.slice(0, 1) + 'a' + tempPassword.slice(2);
        if (!/[0-9]/.test(tempPassword)) tempPassword = tempPassword.slice(0, 2) + '7' + tempPassword.slice(3);

        const passwordHash = await bcrypt.hash(tempPassword, 12);
        user.passwordHash = passwordHash;
        await user.save();

        console.log(`🔐 Admin ${req.user.email} reset password for ${user.email} (${user.userId}).`);

        res.json({
            userId: user.userId,
            userName: user.name,
            userEmail: user.email,
            userPhone: user.phone,
            tempPassword
        });
    } catch (err) {
        console.error('Admin Reset Password Error:', err);
        res.status(500).json({ message: 'Failed to reset user password.' });
    }
});

// --------------------------------------------------------------------
// Withdrawal Approval → Manual Update Workflow
// --------------------------------------------------------------------
app.post('/api/admin/withdrawals/:txId/approve', requireAuth, requireAdmin, async (req, res) => {
    try {
        const txDoc = await Transaction.findOne({ txId: req.params.txId, type: 'WITHDRAWAL', status: 'Pending' });

        if (!txDoc) {
            return res.status(400).json({ message: 'Withdrawal request not found or already processed.' });
        }

        // Manually mark as Completed. Funds were previously deducted during the initial request.
        txDoc.status = 'Completed';
        await txDoc.save();

        const state = await buildUserState(req.user);
        res.json({ tx: formatTransaction(txDoc), state });
    } catch (err) {
        console.error('Manual Withdrawal Approval Error:', err);
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/admin/withdrawals/:txId/reject', requireAuth, requireAdmin, async (req, res) => {
    try {
        const txDoc = await Transaction.findOneAndUpdate(
            { txId: req.params.txId, type: 'WITHDRAWAL', status: 'Pending' },
            { $set: { status: 'Rejected' } },
            { new: true }
        );

        if (!txDoc) {
            return res.status(400).json({ message: 'Withdrawal request not found or already processed.' });
        }

        await User.findOneAndUpdate(
            { userId: txDoc.userId },
            { $inc: { balance: Number(txDoc.cost.toFixed(2)) } }
        );

        const state = await buildUserState(req.user);
        res.json({ tx: formatTransaction(txDoc), state });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// --------------------------------------------------------------------
// Admin: Approve / Re-Verify a Stuck or Pending Recharge
// --------------------------------------------------------------------
app.post('/api/admin/recharges/:txId/approve', requireAuth, requireAdmin, async (req, res) => {
    try {
        const txRef = req.params.txId;
        const txDoc = await Transaction.findOne({ txId: txRef, type: 'RECHARGE' });

        if (!txDoc) {
            return res.status(404).json({ message: 'Recharge transaction not found.' });
        }
        if (txDoc.status === 'Completed' && txDoc.balanceCredited) {
            return res.status(400).json({ message: 'This recharge has already been credited.' });
        }

        const creditedTx = await creditRechargeTransaction(txRef);
        const state = await buildUserState(req.user);
        res.json({ tx: formatTransaction(creditedTx || txDoc), state });
    } catch (err) {
        console.error('Admin Approve Recharge Error:', err);
        res.status(500).json({ message: 'Failed to approve recharge.' });
    }
});

app.put('/api/admin/wheel', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { spinCost, segments, available, restoreReference } = req.body;
        const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' });

        if (restoreReference) {
            config.wheelConfig.segments = getReferenceWheelSegments();
            config.wheelConfig.spinCost = 250.00;
            config.spinState = getDefaultSpinState();
            config.markModified('spinState');
        } else {
            if (spinCost !== undefined && Number(spinCost) >= 250) {
                config.wheelConfig.spinCost = Number(spinCost);
            }
            if (Array.isArray(segments) && segments.length > 0) {
                config.wheelConfig.segments = segments.map((s, idx) => ({
                    id: Number(s.id || idx + 1),
                    label: String(s.label || '').trim(),
                    value: Math.max(0, Number(s.value ?? 0)),
                    color: String(s.color || '#c91429').trim(),
                    weight: Math.max(1, Number(s.weight ?? 1))
                }));
            }
            if (available !== undefined) {
                config.wheelConfig.available = Boolean(available);
            }
        }

        config.markModified('wheelConfig');
        ensureValidSpinState(config);
        ensureValidSlotState(config);
        ensureValidMysteryState(config);
        await config.save();
        const state = await buildUserState(req.user);
        res.json({ state });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/admin/slots', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { spinCost, payouts, available, restoreReference } = req.body;
        const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' });

        if (!config.slotConfig) {
            config.slotConfig = { available: true, spinCost: 250.00, payouts: getReferenceSlotPayouts() };
        }

        if (restoreReference) {
            config.slotConfig.payouts = getReferenceSlotPayouts();
            config.slotConfig.spinCost = 250.00;
            config.slotState = getDefaultSlotState();
            config.markModified('slotState');
        } else {
            if (spinCost !== undefined && Number(spinCost) >= 200) {
                config.slotConfig.spinCost = Number(spinCost);
            }
            if (Array.isArray(payouts) && payouts.length > 0) {
                const refPayouts = getReferenceSlotPayouts();
                config.slotConfig.payouts = payouts.map((p, idx) => ({
                    id: Number(p.id || idx + 1),
                    combo: String(p.combo || refPayouts[idx]?.combo || '🍒 🍒 🍒'),
                    symbol: String(p.symbol || refPayouts[idx]?.symbol || 'CHERRY'),
                    name: String(p.name || refPayouts[idx]?.name || `Tier #${idx + 1}`).trim(),
                    label: String(p.label || '').trim(),
                    value: Math.max(0, Number(p.value ?? 0)),
                    weight: Math.max(1, Number(p.weight ?? 1)),
                    color: String(p.color || refPayouts[idx]?.color || '#c91429').trim()
                }));
            }
            if (available !== undefined) {
                config.slotConfig.available = Boolean(available);
            }
        }

        config.markModified('slotConfig');
        ensureValidSpinState(config);
        ensureValidSlotState(config);
        ensureValidMysteryState(config);
        await config.save();
        const state = await buildUserState(req.user);
        res.json({ state });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/admin/mystery-boxes', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { boxIndex, updatedBox, available } = req.body;
        const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' });

        if (available !== undefined) {
            config.mysteryConfig.available = Boolean(available);
        }
        if (boxIndex !== undefined && updatedBox && config.mysteryConfig.boxes[boxIndex]) {
            config.mysteryConfig.boxes[boxIndex].name = String(updatedBox.name || config.mysteryConfig.boxes[boxIndex].name).trim();
            config.mysteryConfig.boxes[boxIndex].cost = Math.max(200, Number(updatedBox.cost || config.mysteryConfig.boxes[boxIndex].cost));
            if (Array.isArray(updatedBox.prizes) && updatedBox.prizes.length > 0) {
                config.mysteryConfig.boxes[boxIndex].prizes = updatedBox.prizes
                    .filter(p => Number(p.value) > 0)
                    .map(p => ({
                        label: String(p.label || `₦${Number(p.value)}`).trim(),
                        value: Math.max(50, Number(p.value ?? 50)),
                        odds: String(p.odds || '15%').trim()
                    }));
            }
        }

        config.markModified('mysteryConfig');
        ensureValidSpinState(config);
        ensureValidSlotState(config);
        ensureValidMysteryState(config);
        await config.save();
        const state = await buildUserState(req.user);
        res.json({ state });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.patch('/api/admin/prizes/:txId/status', requireAuth, requireAdmin, async (req, res) => {
    try {
        const tx = await Transaction.findOne({ txId: req.params.txId });
        if (!tx) return res.status(404).json({ message: 'Transaction not found.' });

        tx.status = tx.status === 'Flagged' ? 'Credited' : 'Flagged';
        await tx.save();

        const state = await buildUserState(req.user);
        res.json({ txStatus: tx.status, state });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { settings, referralConfig } = req.body;
        const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' });

        if (settings) {
            const currentSettings = config.settings
                ? (typeof config.settings.toObject === 'function' ? config.settings.toObject() : config.settings)
                : {};
            const currentBank = currentSettings.bankDetails || {};

            config.settings = {
                ...currentSettings,
                currency: settings.currency !== undefined && String(settings.currency).trim() !== ''
                    ? String(settings.currency).trim()
                    : (currentSettings.currency || '₦'),
                minRecharge: settings.minRecharge !== undefined && Number.isFinite(Number(settings.minRecharge))
                    ? Math.max(0, Number(settings.minRecharge))
                    : (currentSettings.minRecharge ?? 1000),
                maxRecharge: settings.maxRecharge !== undefined && Number.isFinite(Number(settings.maxRecharge))
                    ? Math.max(0, Number(settings.maxRecharge))
                    : (currentSettings.maxRecharge ?? 3000),
                minWithdrawal: settings.minWithdrawal !== undefined && Number.isFinite(Number(settings.minWithdrawal))
                    ? Math.max(0, Number(settings.minWithdrawal))
                    : (currentSettings.minWithdrawal ?? 1000),
                regBonus: settings.regBonus !== undefined && Number.isFinite(Number(settings.regBonus))
                    ? Math.max(0, Number(settings.regBonus))
                    : (currentSettings.regBonus ?? 0),
                instantRechargeApproval: settings.instantRechargeApproval !== undefined
                    ? Boolean(settings.instantRechargeApproval)
                    : Boolean(currentSettings.instantRechargeApproval),
                maintenanceMode: settings.maintenanceMode !== undefined
                    ? Boolean(settings.maintenanceMode)
                    : Boolean(currentSettings.maintenanceMode),
                enableConfetti: settings.enableConfetti !== undefined
                    ? Boolean(settings.enableConfetti)
                    : Boolean(currentSettings.enableConfetti),
                soundEnabled: settings.soundEnabled !== undefined
                    ? Boolean(settings.soundEnabled)
                    : Boolean(currentSettings.soundEnabled ?? true),
                bankDetails: {
                    bankName: settings.bankDetails?.bankName !== undefined
                        ? String(settings.bankDetails.bankName).trim()
                        : (currentBank.bankName || ''),
                    accountNumber: settings.bankDetails?.accountNumber !== undefined
                        ? String(settings.bankDetails.accountNumber).trim()
                        : (currentBank.accountNumber || ''),
                    accountName: settings.bankDetails?.accountName !== undefined
                        ? String(settings.bankDetails.accountName).trim()
                        : (currentBank.accountName || '')
                }
            };
            config.markModified('settings');
        }

        if (referralConfig) {
            config.referralConfig = {
                available: Boolean(referralConfig.available),
                level1Percent: Number.isFinite(Number(referralConfig.level1Percent)) ? Number(referralConfig.level1Percent) : 0,
                level2Percent: Number.isFinite(Number(referralConfig.level2Percent)) ? Number(referralConfig.level2Percent) : 0,
                level3Percent: Number.isFinite(Number(referralConfig.level3Percent)) ? Number(referralConfig.level3Percent) : 0
            };
            config.markModified('referralConfig');
        }

        ensureValidSpinState(config);
        ensureValidSlotState(config);
        ensureValidMysteryState(config);
        await config.save();

        const state = await buildUserState(req.user);
        res.json({ state });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ====================================================================
// 6.5 CUSTOMER SUPPORT CHAT ENDPOINTS
// ====================================================================

app.get('/api/chat/messages', requireAuth, async (req, res) => {
    try {
        const targetUserId = req.user.role === 'admin' && req.query.userId ? req.query.userId : req.user.userId;
        const messages = await ChatMessage.find({ userId: targetUserId }).sort({ createdAt: 1 }).lean();
        res.json({ messages });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch messages.' });
    }
});

app.post('/api/chat/send', requireAuth, async (req, res) => {
    try {
        const { message, targetUserId } = req.body;
        if (!message || !String(message).trim()) {
            return res.status(400).json({ message: 'Message cannot be empty.' });
        }
        const chatRoomUserId = req.user.role === 'admin' ? targetUserId : req.user.userId;
        if (req.user.role === 'admin' && !chatRoomUserId) {
            return res.status(400).json({ message: 'Admin must specify a user to reply to.' });
        }

        let isGuest = false, guestName = '', guestEmail = '';
        if (chatRoomUserId.startsWith('GUEST-')) {
            const guestMsg = await ChatMessage.findOne({ userId: chatRoomUserId, isGuest: true }).lean();
            if (!guestMsg) {
                return res.status(400).json({ message: 'Guest session not found.' });
            }
            isGuest = true;
            guestName = guestMsg.guestName;
            guestEmail = guestMsg.guestEmail;
        }

        const newMsg = await ChatMessage.create({
            messageId: generateId('MSG'),
            userId: chatRoomUserId,
            isGuest, guestName, guestEmail,
            senderId: req.user.userId,
            senderName: req.user.name,
            senderRole: req.user.role,
            message: String(message).trim(),
            isRead: false
        });
        res.status(201).json({ message: newMsg });
    } catch (err) {
        res.status(500).json({ message: 'Failed to send message.' });
    }
});

app.post('/api/chat/mark-read', requireAuth, async (req, res) => {
    try {
        const { targetUserId } = req.body;
        const chatRoomUserId = req.user.role === 'admin' ? targetUserId : req.user.userId;
        const senderRolesToMark = req.user.role === 'admin' ? ['player', 'guest'] : ['admin'];
        await ChatMessage.updateMany(
            { userId: chatRoomUserId, senderRole: { $in: senderRolesToMark }, isRead: false },
            { $set: { isRead: true } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Failed to mark read.' });
    }
});

// ============ GUEST CHAT ENDPOINTS ============

app.post('/api/chat/guest/init', async (req, res) => {
    try {
        const { name, email } = req.body;
        const cleanName = String(name || '').trim().slice(0, 100);
        const cleanEmail = String(email || '').trim().toLowerCase().slice(0, 200);
        if (!cleanName) return res.status(400).json({ message: 'Please provide your full name.' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return res.status(400).json({ message: 'Please provide a valid email address.' });
        }

        const guestChatId = `GUEST-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
        const guestToken = jwt.sign(
            { guestChatId, guestName: cleanName, guestEmail: cleanEmail, type: 'guest' },
            ACTIVE_JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Seed the session with a welcome message so the admin sees the guest
        await ChatMessage.create({
            messageId: generateId('MSG'),
            userId: guestChatId,
            isGuest: true,
            guestName: cleanName,
            guestEmail: cleanEmail,
            senderId: 'system',
            senderName: 'LuckyVault Support',
            senderRole: 'admin',
            message: `Hi ${cleanName}! 👋 Welcome to LuckyVault. Our support team will be with you shortly — feel free to describe your question.`,
            isRead: false
        });

        res.json({ guestToken, guestChatId, guestName: cleanName, guestEmail: cleanEmail });
    } catch (err) {
        res.status(500).json({ message: 'Failed to initialize guest chat.' });
    }
});

app.get('/api/chat/guest/messages', requireChatAccess, async (req, res) => {
    try {
        if (req.chatRole !== 'guest') return res.status(403).json({ message: 'Guest access required.' });
        const messages = await ChatMessage.find({ userId: req.chatUserId }).sort({ createdAt: 1 }).lean();
        res.json({ messages });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch messages.' });
    }
});

app.post('/api/chat/guest/send', requireChatAccess, async (req, res) => {
    try {
        if (req.chatRole !== 'guest') return res.status(403).json({ message: 'Guest access required.' });
        const { message } = req.body;
        if (!message || !String(message).trim()) {
            return res.status(400).json({ message: 'Message cannot be empty.' });
        }
        const newMsg = await ChatMessage.create({
            messageId: generateId('MSG'),
            userId: req.chatUserId,
            isGuest: true,
            guestName: req.guest.guestName,
            guestEmail: req.guest.guestEmail,
            senderId: req.chatUserId,
            senderName: req.guest.guestName,
            senderRole: 'guest',
            message: String(message).trim(),
            isRead: false
        });
        res.status(201).json({ message: newMsg });
    } catch (err) {
        res.status(500).json({ message: 'Failed to send message.' });
    }
});

app.post('/api/chat/guest/mark-read', requireChatAccess, async (req, res) => {
    try {
        if (req.chatRole !== 'guest') return res.status(403).json({ message: 'Guest access required.' });
        await ChatMessage.updateMany(
            { userId: req.chatUserId, senderRole: 'admin', isRead: false },
            { $set: { isRead: true } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Failed to mark read.' });
    }
});

app.get('/api/admin/chat/sessions', requireAuth, requireAdmin, async (req, res) => {
    try {
        const sessions = await ChatMessage.aggregate([
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: "$userId",
                    lastMessage: { $first: "$message" },
                    lastMessageDate: { $first: "$createdAt" },
                    isGuest: { $first: "$isGuest" },
                    guestName: { $first: "$guestName" },
                    guestEmail: { $first: "$guestEmail" },
                    unreadCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [{ $eq: ["$isRead", false] },
                                    { $in: ["$senderRole", ["player", "guest"]] }]
                                },
                                1, 0
                            ]
                        }
                    }
                }
            },
            { $sort: { lastMessageDate: -1 } }
        ]);

        const populated = [];
        for (const s of sessions) {
            if (s.isGuest) {
                populated.push({
                    userId: s._id,
                    userName: s.guestName || 'Guest Visitor',
                    userEmail: s.guestEmail || '',
                    isGuest: true,
                    lastMessage: s.lastMessage,
                    lastMessageDate: s.lastMessageDate,
                    unreadCount: s.unreadCount
                });
            } else {
                const u = await User.findOne({ userId: s._id }).lean();
                if (u) {
                    populated.push({
                        userId: u.userId,
                        userName: u.name,
                        userEmail: u.email,
                        isGuest: false,
                        lastMessage: s.lastMessage,
                        lastMessageDate: s.lastMessageDate,
                        unreadCount: s.unreadCount
                    });
                }
            }
        }
        res.json({ sessions: populated });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch chat sessions.' });
    }
});

// ====================================================================
// 7. SECURE STATIC ASSET & SMART AUDIO ROUTING
// ====================================================================

app.get('/api/sound/:key', (req, res) => {
    try {
        const key = String(req.params.key || '').toLowerCase();
        const soundDirs = [
            path.join(__dirname, 'public', 'sound'),
            path.join(__dirname, 'sound')
        ];

        for (const dir of soundDirs) {
            if (!fs.existsSync(dir)) continue;
            const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.mp3'));
            let matchedFile = null;

            if (key === 'wheel') {
                matchedFile = files.find(f => f.toLowerCase().includes('wheel') || f.toLowerCase().includes('spin'));
            } else if (key === 'mystery') {
                matchedFile = files.find(f => f.toLowerCase().includes('mystery') || f.toLowerCase().includes('zombies') || f.toLowerCase().includes('box') || f.toLowerCase().includes('black'));
            } else if (key === 'undertaker') {
                matchedFile = files.find(f => f.toLowerCase().includes('undertaker'));
            } else if (key === 'slot') {
                matchedFile =
                    files.find(f => f.toLowerCase() === 'slots.mp3' || f.toLowerCase() === 'slot.mp3') ||
                    files.find(f =>
                        f.toLowerCase().includes('slot') ||
                        f.toLowerCase().includes('casino') ||
                        f.toLowerCase().includes('reaper')
                    );
            }

            if (matchedFile) {
                res.setHeader('Content-Type', 'audio/mpeg');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                return res.sendFile(path.join(dir, matchedFile));
            }
        }

        return res.status(404).json({ message: `Audio track '${key}' not found in public/sound.` });
    } catch (err) {
        return res.status(500).json({ message: 'Failed to resolve audio file.' });
    }
});

app.use(express.static(path.join(__dirname, 'public')));

const resolveAsset = (filename) => {
    const publicFile = path.join(__dirname, 'public', filename);
    if (fs.existsSync(publicFile)) return publicFile;
    return path.join(__dirname, filename);
};

app.get(['/', '/index.html'], (req, res) => {
    res.sendFile(resolveAsset('index.html'));
});
app.get('/style.css', (req, res) => {
    res.sendFile(resolveAsset('style.css'));
});
app.get('/tailwind.css', (req, res) => {
    res.sendFile(resolveAsset('tailwind.css'));
});
app.get('/app.js', (req, res) => {
    res.sendFile(resolveAsset('app.js'));
});

// ====================================================================
// 8. BACKGROUND MATURITY PROCESSING JOB
// ====================================================================

async function processMaturedInvestments() {
    try {
        const now = new Date();
        const matured = await UserInvestment.find({
            status: 'Active',
            maturityDate: { $lte: now },
            $or: [{ payoutFrequency: 'Maturity' }, { payoutFrequency: { $exists: false } }]
        });

        for (const inv of matured) {
            const updatedInv = await UserInvestment.findOneAndUpdate(
                { _id: inv._id, status: 'Active' },
                { $set: { status: 'Completed' } },
                { new: true }
            );

            if (updatedInv) {
                await User.findOneAndUpdate(
                    { userId: inv.userId },
                    { $inc: { balance: inv.returnAmount } }
                );

                await Transaction.create({
                    txId: generateId('TX'),
                    userId: inv.userId,
                    user: inv.user,
                    type: 'INVEST_PAYOUT',
                    desc: `Synthetic Plan Maturity Payout: ${inv.planName}`,
                    cost: 0,
                    credit: inv.returnAmount,
                    status: 'Completed',
                    balanceCredited: true
                });
            }
        }
    } catch (err) {
        console.error('Error processing matured synthetic plans:', err.message);
    }
}

async function processDailyPayouts() {
    try {
        const now = new Date();
        const dueInvestments = await UserInvestment.find({
            status: 'Active',
            payoutFrequency: 'Daily',
            nextPayoutDate: { $lte: now }
        });

        for (const inv of dueInvestments) {
            const nextDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);

            const lockedInv = await UserInvestment.findOneAndUpdate(
                { _id: inv._id, status: 'Active', nextPayoutDate: { $lte: now } },
                {
                    $set: { nextPayoutDate: nextDate, lastPayoutDate: now },
                    $inc: { completedPayouts: 1 }
                },
                { new: true }
            );

            if (lockedInv) {
                await User.findOneAndUpdate(
                    { userId: lockedInv.userId },
                    { $inc: { balance: lockedInv.dailyPayoutAmount } }
                );

                await Transaction.create({
                    txId: generateId('TX'),
                    userId: lockedInv.userId,
                    user: lockedInv.user,
                    type: 'INVEST_PAYOUT',
                    desc: `Daily ROI Payout (${lockedInv.completedPayouts}/${lockedInv.durationDays}) - ${lockedInv.planName}`,
                    cost: 0,
                    credit: lockedInv.dailyPayoutAmount,
                    status: 'Completed',
                    balanceCredited: true
                });

                if (lockedInv.completedPayouts >= lockedInv.durationDays || lockedInv.nextPayoutDate >= lockedInv.maturityDate) {
                    await UserInvestment.updateOne(
                        { _id: lockedInv._id },
                        { $set: { status: 'Completed' } }
                    );
                }
            }
        }
    } catch (err) {
        console.error('Error processing daily payouts:', err.message);
    }
}

async function processExpiredRecharges() {
    try {
        // Find pending recharges older than 60 minutes (Korapay default expiry)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        const result = await Transaction.updateMany(
            {
                type: 'RECHARGE',
                status: 'Pending',
                balanceCredited: { $ne: true },
                createdAt: { $lte: oneHourAgo }
            },
            { $set: { status: 'Rejected' } }
        );

        if (result.modifiedCount > 0) {
            console.log(`🧹 Expired ${result.modifiedCount} pending recharge requests.`);
        }
    } catch (err) {
        console.error('Error processing expired recharges:', err.message);
    }
}

// --------------------------------------------------------------------
// Korapay Reconciliation: rescues paid-but-stuck recharges without
// requiring the user to return or the admin to click anything.
//   Case 1 — Completed but uncredited (crash mid-write): credit now.
//   Case 2 — Pending/Rejected: ask Korapay; credit if paid.
// --------------------------------------------------------------------
async function reconcileStaleRecharges() {
    try {
        if (!KORAPAY_SECRET_KEY) return;

        // Case 1: crash-recovery (Completed + uncredited)
        const uncredited = await Transaction.find({
            type: 'RECHARGE',
            status: 'Completed',
            balanceCredited: false
        }).limit(10);

        for (const tx of uncredited) {
            await creditRechargeTransaction(tx.txId);
        }

        // Case 2: stale Pending/Rejected — check Korapay directly
        const stale = await Transaction.find({
            type: 'RECHARGE',
            status: { $in: ['Pending', 'Rejected'] },
            balanceCredited: { $ne: true },
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        }).limit(20);

        for (const tx of stale) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);
                let koraData;
                try {
                    const r = await fetch(
                        `https://api.korapay.com/merchant/api/v1/charges/${encodeURIComponent(tx.txId)}`,
                        {
                            headers: { 'Authorization': `Bearer ${KORAPAY_SECRET_KEY}` },
                            signal: controller.signal
                        }
                    );
                    koraData = await r.json().catch(() => ({}));
                } finally {
                    clearTimeout(timeoutId);
                }

                if (koraData?.data?.status === 'success') {
                    await creditRechargeTransaction(tx.txId);
                    console.log(`[RECONCILE] Rescued paid recharge ${tx.txId}`);
                }

                // Throttle to avoid hitting Korapay rate limits
                await new Promise(resolve => setTimeout(resolve, 250));
            } catch (e) {
                // Network blip — retry next cycle, do not mark as failed
            }
        }
    } catch (err) {
        console.error('reconcileStaleRecharges error:', err.message);
    }
}

// Check for matured synthetic plans every 60 seconds
setInterval(processMaturedInvestments, 60 * 1000);
// Check for daily ROI payouts every 60 seconds
setInterval(processDailyPayouts, 60 * 1000);
// Check for expired pending recharges every 5 minutes
setInterval(processExpiredRecharges, 5 * 60 * 1000);
// Reconcile stuck Korapay recharges every 5 minutes
setInterval(reconcileStaleRecharges, 5 * 60 * 1000);

// ====================================================================
// 9. MONGODB ATLAS CONNECTION & SERVER STARTUP
// ====================================================================

mongoose.connect(MONGODB_URI)
    .then(async () => {
        console.log('✅ Connected to MongoDB Atlas.');
        await initializePlatform();
        app.listen(PORT, () => {
            console.log(`🚀 LuckyVault Production Server listening on port ${PORT}`);
        });
    })
    .catch(err => {
        console.error('❌ MongoDB Atlas Connection Error:', err.message);
        process.exit(1);
    });