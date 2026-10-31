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
    type: { type: String, enum: ['SPIN', 'BOX', 'SLOT', 'RECHARGE', 'WITHDRAWAL', 'INVEST_BUY', 'INVEST_PAYOUT'], required: true },
    desc: { type: String, required: true },
    cost: { type: Number, default: 0 },
    credit: { type: Number, default: 0 },
    status: { type: String, enum: ['Credited', 'Completed', 'Pending', 'Flagged', 'Rejected'], default: 'Credited' }
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

// New Chat Message Schema (supports registered users + guests)
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
    settings: {
        currency: { type: String, default: '₦' },
        minRecharge: { type: Number, default: 100 },
        maxRecharge: { type: Number, default: 3000 },
        minWithdrawal: { type: Number, default: 50 },
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
            weight: Number
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
    { id: 8, label: '₦0', value: 0.00, color: '#111111', weight: 40 }
];

const getReferenceSlotPayouts = () => [
    { id: 1, combo: '7️⃣ 7️⃣ 7️⃣', symbol: '7', name: 'Triple Lucky 7s', label: '₦5000', value: 5000.00, weight: 1 },
    { id: 2, combo: '💎 💎 💎', symbol: 'DIAMOND', name: 'Triple Diamonds', label: '₦1000', value: 1000.00, weight: 2 },
    { id: 3, combo: '🔔 🔔 🔔', symbol: 'BELL', name: 'Triple Golden Bells', label: '₦500', value: 500.00, weight: 3 },
    { id: 4, combo: '🍉 🍉 🍉', symbol: 'MELON', name: 'Triple Melons', label: '₦300', value: 300.00, weight: 5 },
    { id: 5, combo: '🍇 🍇 🍇', symbol: 'GRAPE', name: 'Triple Grapes', label: '₦200', value: 200.00, weight: 10 },
    { id: 6, combo: '🍋 🍋 🍋', symbol: 'LEMON', name: 'Triple Lemons', label: '₦100', value: 100.00, weight: 15 },
    { id: 7, combo: '🍒 🍒 🍒', symbol: 'CHERRY', name: 'Triple Cherries', label: '₦50', value: 50.00, weight: 20 },
    { id: 8, combo: '🍒 🍋 🍇', symbol: 'MISS', name: 'No Match', label: '₦0', value: 0.00, weight: 40 }
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
        console.log('✅ Initialized default Investment Plans.');
    }
}

async function initializePlatform() {
    let config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' });

    if (!config) {
        await PlatformConfig.create({
            singletonKey: 'GLOBAL_CONFIG',
            settings: {
                currency: '₦',
                minRecharge: 100,
                maxRecharge: 3000,
                minWithdrawal: 50,
                regBonus: 0,
                instantRechargeApproval: false,
                maintenanceMode: false,
                enableConfetti: true,
                soundEnabled: true,
                bankDetails: { bankName: 'Moniepoint MFB', accountNumber: '1234567890', accountName: 'LuckyVault Gaming' }
            },
            wheelConfig: { available: true, spinCost: 250.00, segments: getReferenceWheelSegments() },
            spinState: getDefaultSpinState(),
            slotConfig: { available: true, spinCost: 250.00, payouts: getReferenceSlotPayouts() },
            slotState: getDefaultSlotState(),
            mysteryState: getDefaultMysteryState(),
            mysteryConfig: { available: true, activeBoxId: 'BOX-CLASSIC', boxes: getDefaultBoxes() }
        });
        console.log('✅ Initialized default PlatformConfig with NGN (₦) currency.');
    } else {
        let needsMigration = false;

        if (config.settings) {
            if (config.settings.currency === '$') {
                config.settings.currency = '₦';
                needsMigration = true;
            }
            if (config.settings.minRecharge !== 100 || config.settings.maxRecharge !== 3000) {
                config.settings.minRecharge = 100;
                config.settings.maxRecharge = 3000;
                needsMigration = true;
            }
            if (config.settings.minWithdrawal === undefined || config.settings.minWithdrawal === null) {
                config.settings.minWithdrawal = 50;
                needsMigration = true;
                console.log('✅ Migrated settings with minWithdrawal default (₦50).');
            }
            if (!config.settings.bankDetails) {
                config.settings.bankDetails = { bankName: 'Moniepoint MFB', accountNumber: '1234567890', accountName: 'LuckyVault Gaming' };
                needsMigration = true;
            }
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

        if (config.wheelConfig) {
            if (config.wheelConfig.spinCost < 250) {
                config.wheelConfig.spinCost = 250.00;
                needsMigration = true;
                console.log('✅ Migrated wheel spin cost to new minimum ₦250.');
            }
            const hasOldSegments = config.wheelConfig.segments.some(seg =>
                seg.label === '₦2000' || seg.label === '₦3000' ||
                seg.value === 2000 || seg.value === 3000 ||
                (seg.label && seg.label.startsWith('$'))
            );

            if (hasOldSegments) {
                config.wheelConfig.segments = getReferenceWheelSegments();
                needsMigration = true;
                console.log('✅ Migrated wheel segments to update ₦2000 and ₦3000.');
            }
        }

        if (!config.mysteryConfig || !Array.isArray(config.mysteryConfig.boxes) || config.mysteryConfig.boxes.length === 0) {
            config.mysteryConfig = { available: true, activeBoxId: 'BOX-CLASSIC', boxes: getDefaultBoxes() };
            config.markModified('mysteryConfig');
            needsMigration = true;
            console.log('✅ Initialized default Mystery Boxes configuration.');
        } else {
            const expectedCosts = [200, 250, 300];
            const expectedValues = [50, 100, 200, 300, 500, 1000, 5000];
            const needsBoxMigration = config.mysteryConfig.boxes.some((box, idx) => {
                if (Number(box.cost) !== expectedCosts[idx]) return true;
                if (!Array.isArray(box.prizes) || box.prizes.length !== expectedValues.length) return true;
                const boxVals = box.prizes.map(p => Number(p.value)).sort((a, b) => a - b);
                return expectedValues.some((val, vIdx) => boxVals[vIdx] !== val) || box.prizes.some(p => Number(p.value) <= 0);
            });

            if (needsBoxMigration) {
                config.mysteryConfig.boxes = getDefaultBoxes();
                config.markModified('mysteryConfig');
                needsMigration = true;
                console.log('✅ Migrated Mystery Boxes to ₦200, ₦250, ₦300 costs and tiered rules.');
            }
        }

        if (needsMigration) {
            await config.save();
            console.log('✅ Saved database configuration updates.');
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
// 4. HELPER FUNCTIONS (Weighted Server RNG & State Formatter)
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
        const { name, email, phone, password } = req.body;
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

        const newUser = await User.create({
            userId: newUserId,
            name: displayName,
            email: cleanEmail,
            phone: cleanPhone,
            passwordHash,
            role: 'player',
            status: 'Active',
            balance: bonus
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
                status: 'Completed'
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
            status: 'Pending'
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
// --------------------------------------------------------------------
app.post('/api/wallet/korapay-webhook', async (req, res) => {
    try {
        const signature = req.headers['x-korapay-signature'];
        const rawBody = req.rawBody || JSON.stringify(req.body);
        const hash = crypto.createHmac('sha256', KORAPAY_SECRET_KEY).update(rawBody).digest('hex');

        if (hash !== signature) {
            return res.status(401).send('Invalid signature');
        }

        const { event, data } = req.body;
        if (event === 'charge.success') {
            const txRef = data.reference;
            const txDoc = await Transaction.findOneAndUpdate(
                { txId: txRef, type: 'RECHARGE', status: 'Pending' },
                { $set: { status: 'Completed' } },
                { new: true }
            );

            if (txDoc) {
                await User.findOneAndUpdate(
                    { userId: txDoc.userId },
                    { $inc: { balance: Number(txDoc.credit.toFixed(2)) } }
                );
            }
        }
        res.status(200).send('Webhook received');
    } catch (err) {
        console.error('Korapay Webhook Error:', err);
        res.status(500).send('Webhook error');
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
        const minWithdrawal = Number(config.settings.minWithdrawal ?? 50);

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
                status: 'Pending'
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
            return res.status(404).json({ message: 'Investment plan not found or no longer active.' });
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
            desc: `Purchased Investment Plan: ${plan.name}`,
            cost: plan.cost,
            credit: 0,
            status: 'Completed'
        });

        const state = await buildUserState(updatedUser);
        res.json({ investment: newInv, state });
    } catch (err) {
        res.status(500).json({ message: 'Failed to purchase investment plan. Please try again.' });
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
            status: 'Credited'
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
            status: 'Credited'
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
            status: 'Credited'
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
            return res.status(400).json({ message: 'Please provide valid configuration data for the investment plan.' });
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
        res.status(500).json({ message: 'Failed to create new investment plan.' });
    }
});

app.put('/api/admin/investments/:planId', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { name, cost, returnAmount, durationDays, isActive, payoutFrequency, dailyRoiPercentage } = req.body;

        const plan = await InvestmentPlan.findOne({ planId: req.params.planId });
        if (!plan) {
            return res.status(404).json({ message: 'Investment plan not found.' });
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
        res.status(500).json({ message: 'Failed to update investment plan.' });
    }
});

app.delete('/api/admin/investments/:planId', requireAuth, requireAdmin, async (req, res) => {
    try {
        const planId = req.params.planId;
        const activeInvestments = await UserInvestment.countDocuments({ planId, status: 'Active' });

        if (activeInvestments > 0) {
            return res.status(400).json({ message: 'Cannot delete plan. There are active user investments tied to it. Please deactivate it instead.' });
        }

        await InvestmentPlan.findOneAndDelete({ planId });
        const state = await buildUserState(req.user);
        res.json({ message: 'Investment plan deleted successfully.', state });
    } catch (err) {
        res.status(500).json({ message: 'Failed to delete investment plan.' });
    }
});

app.post('/api/admin/users/:userId/credit', requireAuth, requireAdmin, async (req, res) => {
    try {
        const num = Number(req.body.amount);
        if (!Number.isFinite(num) || num <= 0) {
            return res.status(400).json({ message: 'Please provide a valid positive credit amount.' });
        }

        const user = await User.findOneAndUpdate(
            { userId: req.params.userId },
            { $inc: { balance: Number(num.toFixed(2)) } },
            { new: true }
        );
        if (!user) return res.status(404).json({ message: 'Target user not found.' });

        await Transaction.create({
            txId: generateId('TX'),
            userId: user.userId,
            user: user.name,
            type: 'RECHARGE',
            desc: 'Admin Manual Wallet Credit',
            cost: 0,
            credit: Number(num.toFixed(2)),
            status: 'Completed'
        });

        const state = await buildUserState(req.user);
        res.json({ state });
    } catch (err) {
        res.status(500).json({ message: err.message });
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

app.post('/api/admin/recharges/:txId/approve', requireAuth, requireAdmin, async (req, res) => {
    try {
        const txDoc = await Transaction.findOneAndUpdate(
            { txId: req.params.txId, type: 'RECHARGE', status: 'Pending' },
            { $set: { status: 'Completed' } },
            { new: true }
        );

        if (!txDoc) {
            return res.status(400).json({ message: 'Transaction not found or already approved.' });
        }

        await User.findOneAndUpdate(
            { userId: txDoc.userId },
            { $inc: { balance: Number(txDoc.credit.toFixed(2)) } }
        );

        const state = await buildUserState(req.user);
        res.json({ tx: formatTransaction(txDoc), state });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// --------------------------------------------------------------------
// Korapay: Admin Withdrawal Approval → Automated Disbursement
// --------------------------------------------------------------------
app.post('/api/admin/withdrawals/:txId/approve', requireAuth, requireAdmin, async (req, res) => {
    try {
        const txDoc = await Transaction.findOne({ txId: req.params.txId, type: 'WITHDRAWAL', status: 'Pending' });

        if (!txDoc) {
            return res.status(400).json({ message: 'Withdrawal request not found or already processed.' });
        }

        const user = await User.findOne({ userId: txDoc.userId });
        if (!user) {
            return res.status(404).json({ message: 'Associated user account not found.' });
        }

        if (!user.bankDetails || !user.bankDetails.bankName || !user.bankDetails.accountNumber) {
            return res.status(400).json({ message: 'User does not have bank details on file. Cannot disburse.' });
        }

        // NOTE: Korapay requires the 3-digit CBN bank code in the `bank` field
        // (e.g. "033" for UBA, "058" for GTBank). Ensure users enter a valid
        // bank code in the Bank Name field, or maintain a name→code mapping.
        const koraResponse = await fetch('https://api.korapay.com/merchant/api/v1/transactions/disburse', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${KORAPAY_SECRET_KEY}`
            },
            body: JSON.stringify({
                reference: `PAY-${txDoc.txId}`,
                destination: {
                    type: 'bank_account',
                    amount: txDoc.cost,
                    currency: 'NGN',
                    bank_account: {
                        bank: user.bankDetails.bankName,
                        account_number: user.bankDetails.accountNumber
                    }
                },
                customer: {
                    email: user.email
                }
            })
        });

        const koraData = await koraResponse.json();
        if (!koraResponse.ok || !koraData.status) {
            const koraMsg = koraData && koraData.message ? koraData.message : 'Check bank details/bank code.';
            return res.status(400).json({ message: 'Korapay Disbursement Failed: ' + koraMsg });
        }

        txDoc.status = 'Completed';
        await txDoc.save();

        const state = await buildUserState(req.user);
        res.json({ tx: formatTransaction(txDoc), state });
    } catch (err) {
        console.error('Korapay Disbursement Error:', err);
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
                    weight: Math.max(1, Number(p.weight ?? 1))
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
        const { settings } = req.body;
        const config = await PlatformConfig.findOne({ singletonKey: 'GLOBAL_CONFIG' });

        config.settings = {
            ...config.settings.toObject(),
            ...settings,
            bankDetails: {
                ...config.settings.bankDetails,
                ...(settings.bankDetails || {})
            }
        };
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
                    desc: `Investment Maturity Payout: ${inv.planName}`,
                    cost: 0,
                    credit: inv.returnAmount,
                    status: 'Completed'
                });
            }
        }
    } catch (err) {
        console.error('Error processing matured investments:', err.message);
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
                    status: 'Completed'
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

// Check for matured investments every 60 seconds
setInterval(processMaturedInvestments, 60 * 1000);
// Check for daily ROI payouts every 60 seconds
setInterval(processDailyPayouts, 60 * 1000);

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