/**
 * ====================================================================
 * LuckyVault — app.js (Production Release)
 * ====================================================================
 * Layer 0: ToneLoader          (Lazy-loads Tone.js on user gesture)
 * Layer 1: ApiClient           (Authenticated REST Client + Investment Plans)
 * Layer 2: SoundFX             (MP3 Game & Background Audio Manager + Tone.js fanfare)
 * Layer 3: ConfettiEngine      (Celebration particles)
 * Layer 4: AppController       (UI renderer + controller: Wheel, Mystery Box, 777 Slots & Investments)
 */

/**
 * ====================================================================
 * LAYER 0: ToneLoader (lazy loads Tone.js to prevent AudioContext
 * autoplay warnings — the library only loads on first user gesture)
 * ====================================================================
 */
const ToneLoader = (() => {
    let loadPromise = null;
    const TONE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js';

    const load = () => {
        if (typeof window.Tone !== 'undefined') return Promise.resolve(window.Tone);
        if (loadPromise) return loadPromise;

        loadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = TONE_CDN;
            script.async = true;
            script.onload = () => {
                if (typeof window.Tone !== 'undefined') {
                    resolve(window.Tone);
                } else {
                    loadPromise = null;
                    reject(new Error('Tone.js loaded but not attached to window'));
                }
            };
            script.onerror = () => {
                loadPromise = null;
                reject(new Error('Failed to load Tone.js from CDN'));
            };
            document.head.appendChild(script);
        });

        return loadPromise;
    };

    return { load };
})();

const ApiClient = (() => {
    const API_BASE = '/api';
    let authToken = localStorage.getItem('lv_jwt_token') || null;
    let guestToken = localStorage.getItem('lv_guest_token') || null;

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

    const getReferenceSlotPrizes = () => [
        { id: 1, label: '₦5000', value: 5000.00, combo: ['7', '7', '7'], name: 'TRIPLE 777 JACKPOT', color: '#c91429', weight: 1 },
        { id: 2, label: '₦1000', value: 1000.00, combo: ['DIAMOND', 'DIAMOND', 'DIAMOND'], name: '3x Royal Diamonds', color: '#623aa2', weight: 2 },
        { id: 3, label: '₦500', value: 500.00, combo: ['BELL', 'BELL', 'BELL'], name: '3x Golden Bells', color: '#1b6b6b', weight: 3 },
        { id: 4, label: '₦300', value: 300.00, combo: ['CHERRY', 'CHERRY', 'CHERRY'], name: '3x Ruby Cherries', color: '#1565c0', weight: 5 },
        { id: 5, label: '₦200', value: 200.00, combo: ['BERRY', 'BERRY', 'BERRY'], name: '3x Wild Strawberries', color: '#ea691c', weight: 10 },
        { id: 6, label: '₦100', value: 100.00, combo: ['CHERRY', 'CHERRY', '7'], name: '2x Cherries + Lucky 7', color: '#f0c330', weight: 15 },
        { id: 7, label: '₦50', value: 50.00, combo: ['BERRY', 'BERRY', 'CHERRY'], name: '2x Berries + Cherry', color: '#278a3f', weight: 20 },
        { id: 8, label: '₦0', value: 0.00, combo: ['CHERRY', '7', 'BERRY'], name: 'No Match', color: '#111111', weight: 40 }
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

    let state = {
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
            bankDetails: { bankName: 'Loading...', accountNumber: 'Loading...', accountName: 'Loading...' }
        },
        currentUser: null,
        users: [],
        investmentPlans: [],
        investments: [],
        chatMessages: [],
        adminChatSessions: [],
        activeAdminChatUserId: null,
        wheelConfig: {
            available: true,
            spinCost: 250.00,
            segments: getReferenceWheelSegments()
        },
        slotConfig: {
            available: true,
            spinCost: 250.00,
            prizes: getReferenceSlotPrizes()
        },
        mysteryConfig: {
            available: true,
            activeBoxId: localStorage.getItem('lv_active_box_id') || 'BOX-CLASSIC',
            boxes: [
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
            ]
        },
        transactions: []
    };

    let deferredServerState = null;

    const clearSession = () => {
        authToken = null;
        localStorage.removeItem('lv_jwt_token');
        // Guest token intentionally preserved — the visitor may still be chatting
        state.currentUser = null;
        state.users = [];
        state.transactions = [];
        state.investments = [];
        state.chatMessages = [];
        state.adminChatSessions = [];
        state.activeAdminChatUserId = null;
    };

    const clearGuestSession = () => {
        guestToken = null;
        localStorage.removeItem('lv_guest_token');
    };

    const apiRequest = async (endpoint, options = {}) => {
        const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
        const isGuestEndpoint = endpoint.startsWith('/chat/guest/');
        const tokenToUse = authToken || (isGuestEndpoint ? guestToken : null);

        if (tokenToUse) headers['Authorization'] = `Bearer ${tokenToUse}`;

        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            if (response.status === 401 &&
                endpoint !== '/auth/login' && endpoint !== '/chat/guest/init') {
                if (isGuestEndpoint) clearGuestSession();
                else clearSession();
            }
            throw new Error(data.message || `Request failed (${response.status})`);
        }
        return data;
    };

    const applyServerState = (newState) => {
        if (!newState) return;
        const currentActiveBox = state.mysteryConfig?.activeBoxId || 'BOX-CLASSIC';
        const soundPref = state.settings?.soundEnabled ?? true;
        const currentSlotConfig = state.slotConfig || {
            available: true,
            spinCost: state.wheelConfig?.spinCost || 250.00,
            prizes: getReferenceSlotPrizes()
        };

        state = {
            ...state,
            ...newState
        };

        const savedBoxId = localStorage.getItem('lv_active_box_id');
        if (state.mysteryConfig && state.mysteryConfig.boxes) {
            const boxExists = state.mysteryConfig.boxes.some(b => b.id === savedBoxId);
            if (savedBoxId && boxExists) {
                state.mysteryConfig.activeBoxId = savedBoxId;
            } else if (!state.mysteryConfig.activeBoxId) {
                state.mysteryConfig.activeBoxId = currentActiveBox;
            }
        }

        if (!state.slotConfig) {
            state.slotConfig = {
                ...currentSlotConfig,
                spinCost: newState.wheelConfig?.spinCost || currentSlotConfig.spinCost || 250.00
            };
        } else {
            // Normalize backend `payouts` → frontend `prizes`
            if ((!Array.isArray(state.slotConfig.prizes) || state.slotConfig.prizes.length === 0)
                && Array.isArray(state.slotConfig.payouts) && state.slotConfig.payouts.length > 0) {
                const fallbackColors = {
                    5000: '#c91429', 1000: '#623aa2', 500: '#1b6b6b',
                    300: '#1565c0', 200: '#ea691c', 100: '#f0c330',
                    50: '#278a3f', 0: '#111111'
                };
                state.slotConfig.prizes = state.slotConfig.payouts.map(p => {
                    const sym = p.symbol && p.symbol !== 'MISS' ? p.symbol : null;
                    return {
                        id: Number(p.id),
                        label: p.label,
                        value: Number(p.value),
                        name: p.name,
                        weight: Number(p.weight),
                        symbol: p.symbol,
                        color: p.color || fallbackColors[Number(p.value)] || '#c91429',
                        combo: Array.isArray(p.combo)
                            ? p.combo
                            : (sym ? [sym, sym, sym] : ['CHERRY', 'LEMON', 'GRAPE'])
                    };
                });
            }
            if (!Array.isArray(state.slotConfig.prizes) || state.slotConfig.prizes.length === 0) {
                state.slotConfig.prizes = getReferenceSlotPrizes();
            }
        }

        if (state.mysteryConfig && !state.mysteryConfig.activeBoxId) state.mysteryConfig.activeBoxId = currentActiveBox;
        if (state.settings) state.settings.soundEnabled = soundPref;
    };

    return {
        getState: () => state,
        hasToken: () => Boolean(authToken),
        clearSession,

        fetchPublicConfig: async () => {
            const data = await apiRequest('/public/config');
            applyServerState(data);
            return state;
        },

        fetchInitialState: async () => {
            const data = await apiRequest('/bootstrap');
            applyServerState(data);
            return state;
        },

        authenticateUser: async (identifier, password) => {
            const data = await apiRequest('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ identifier, password })
            });
            if (data.token) {
                authToken = data.token;
                localStorage.setItem('lv_jwt_token', authToken);
            }
            applyServerState(data.state);
            return { user: state.currentUser, redirectRole: data.redirectRole };
        },

        registerUser: async ({ name, email, phone, password }) => {
            const data = await apiRequest('/auth/register', {
                method: 'POST',
                body: JSON.stringify({ name, email, phone, password })
            });
            if (data.token) {
                authToken = data.token;
                localStorage.setItem('lv_jwt_token', authToken);
            }
            applyServerState(data.state);
            return { user: state.currentUser };
        },

        rechargeWallet: async (amount, method) => {
            const data = await apiRequest('/wallet/recharge', {
                method: 'POST',
                body: JSON.stringify({ amount, method })
            });
            applyServerState(data.state);
            return data;
        },

        saveUserBankDetails: async (bankDetails) => {
            const data = await apiRequest('/user/bank-details', {
                method: 'PUT',
                body: JSON.stringify(bankDetails)
            });
            applyServerState(data.state);
            return data.state;
        },

        requestWithdrawal: async (amount) => {
            const data = await apiRequest('/wallet/withdraw', {
                method: 'POST',
                body: JSON.stringify({ amount })
            });
            applyServerState(data.state);
            return data.tx;
        },

        // Investment Plans API
        purchaseInvestmentPlan: async (planId) => {
            const data = await apiRequest('/investments/purchase', {
                method: 'POST',
                body: JSON.stringify({ planId })
            });
            applyServerState(data.state);
            return data.investment;
        },

        adminCreateInvestmentPlan: async (payload) => {
            const data = await apiRequest('/admin/investments', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            applyServerState(data.state);
        },

        adminUpdateInvestmentPlan: async (planId, payload) => {
            const data = await apiRequest(`/admin/investments/${encodeURIComponent(planId)}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            applyServerState(data.state);
        },

        adminDeleteInvestmentPlan: async (planId) => {
            const data = await apiRequest(`/admin/investments/${encodeURIComponent(planId)}`, {
                method: 'DELETE'
            });
            applyServerState(data.state);
        },

        adminApproveWithdrawal: async (txId) => {
            const data = await apiRequest(`/admin/withdrawals/${encodeURIComponent(txId)}/approve`, {
                method: 'POST'
            });
            applyServerState(data.state);
            return data.tx;
        },

        adminRejectWithdrawal: async (txId) => {
            const data = await apiRequest(`/admin/withdrawals/${encodeURIComponent(txId)}/reject`, {
                method: 'POST'
            });
            applyServerState(data.state);
            return data.tx;
        },

        // Live Chat Support API
        fetchChatMessages: async (targetUserId = null) => {
            const query = targetUserId ? `?userId=${encodeURIComponent(targetUserId)}` : '';
            const data = await apiRequest(`/chat/messages${query}`);
            state.chatMessages = data.messages || [];
            return state.chatMessages;
        },

        sendChatMessage: async (message, targetUserId = null) => {
            const data = await apiRequest('/chat/send', {
                method: 'POST',
                body: JSON.stringify({ message, targetUserId })
            });
            return data.message;
        },

        markChatRead: async (targetUserId = null) => {
            await apiRequest('/chat/mark-read', {
                method: 'POST',
                body: JSON.stringify({ targetUserId })
            });
        },

        hasGuestToken: () => Boolean(guestToken),

        initGuestChat: async (name, email) => {
            const data = await apiRequest('/chat/guest/init', {
                method: 'POST',
                body: JSON.stringify({ name, email })
            });
            if (data.guestToken) {
                guestToken = data.guestToken;
                localStorage.setItem('lv_guest_token', guestToken);
            }
            return data;
        },

        fetchGuestMessages: async () => {
            const data = await apiRequest('/chat/guest/messages');
            return data.messages || [];
        },

        sendGuestMessage: async (message) => {
            const data = await apiRequest('/chat/guest/send', {
                method: 'POST',
                body: JSON.stringify({ message })
            });
            return data.message;
        },

        markGuestRead: async () => {
            await apiRequest('/chat/guest/mark-read', { method: 'POST' });
        },

        clearGuestSession,

        fetchAdminChatSessions: async () => {
            const data = await apiRequest('/admin/chat/sessions');
            state.adminChatSessions = data.sessions || [];
            return state.adminChatSessions;
        },

        requestWheelSpin: async () => {
            const data = await apiRequest('/games/wheel/spin', {
                method: 'POST'
            });
            if (state.currentUser) {
                state.currentUser.balance = data.outcome.balanceAfterWager;
                state.currentUser.spinsCount += 1;
            }
            deferredServerState = data.state;
            return data.outcome;
        },

        finalizeWheelSpinPayout: () => {
            if (deferredServerState) {
                applyServerState(deferredServerState);
                deferredServerState = null;
            }
        },

        requestSlotSpin: async () => {
            let data;
            try {
                data = await apiRequest('/games/slot/spin', { method: 'POST' });
            } catch (err) {
                if (err.message && (err.message.includes('404') || err.message.toLowerCase().includes('not found'))) {
                    data = await apiRequest('/games/wheel/spin', { method: 'POST' });
                } else {
                    throw err;
                }
            }

            if (state.currentUser) {
                state.currentUser.balance = data.outcome.balanceAfterWager;
                state.currentUser.slotsCount = (state.currentUser.slotsCount || 0) + 1;
                state.currentUser.spinsCount = (state.currentUser.spinsCount || 0) + 1;
            }
            deferredServerState = data.state;

            const rawPrize = data.outcome.payout || { label: '₦0', value: 0 };
            const prizeValue = Number(rawPrize.value || 0);
            const matchedTier = state.slotConfig.prizes.find(p => Number(p.value) === prizeValue)
                || state.slotConfig.prizes[state.slotConfig.prizes.length - 1];

            return {
                ...data.outcome,
                prizeTier: {
                    ...matchedTier,
                    label: rawPrize.label || matchedTier.label,
                    value: prizeValue,
                    name: rawPrize.name || matchedTier.name,
                    combo: data.outcome.reels || ['CHERRY', '7', 'BERRY']
                }
            };
        },

        finalizeSlotSpinPayout: () => {
            if (deferredServerState) {
                applyServerState(deferredServerState);
                deferredServerState = null;
            }
        },

        requestMysteryBoxOpen: async () => {
            const boxId = state.mysteryConfig.activeBoxId;
            const data = await apiRequest('/games/mystery-box/open', {
                method: 'POST',
                body: JSON.stringify({ boxId })
            });
            if (state.currentUser) {
                state.currentUser.balance = data.outcome.balanceAfterWager;
                state.currentUser.boxesCount += 1;
            }
            deferredServerState = data.state;
            return data.outcome;
        },

        finalizeMysteryBoxPayout: () => {
            if (deferredServerState) {
                applyServerState(deferredServerState);
                deferredServerState = null;
            }
        },

        // Admin API calls
        adminCreditUser: async (userId, amount) => {
            const data = await apiRequest(`/admin/users/${encodeURIComponent(userId)}/credit`, {
                method: 'POST',
                body: JSON.stringify({ amount })
            });
            applyServerState(data.state);
        },

        adminToggleUserStatus: async (userId) => {
            const data = await apiRequest(`/admin/users/${encodeURIComponent(userId)}/status`, {
                method: 'PATCH'
            });
            applyServerState(data.state);
            return data;
        },

        adminApproveRecharge: async (txId) => {
            const data = await apiRequest(`/admin/recharges/${encodeURIComponent(txId)}/approve`, {
                method: 'POST'
            });
            applyServerState(data.state);
            return data.tx;
        },

        updateWheelConfig: async (payload) => {
            const data = await apiRequest('/admin/wheel', {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            applyServerState(data.state);
        },

        updateSlotConfig: async (payload) => {
            try {
                const data = await apiRequest('/admin/slots', {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                });
                applyServerState(data.state);
            } catch (err) {
                if (payload.available !== undefined) {
                    state.slotConfig.available = Boolean(payload.available);
                }
                if (payload.spinCost !== undefined && Number(payload.spinCost) >= 200) {
                    state.slotConfig.spinCost = Number(payload.spinCost);
                }
            }
        },

        updateMysteryBoxConfig: async (payload) => {
            const data = await apiRequest('/admin/mystery-boxes', {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            applyServerState(data.state);
        },

        adminTogglePrizeStatus: async (txId) => {
            const data = await apiRequest(`/admin/prizes/${encodeURIComponent(txId)}/status`, {
                method: 'PATCH'
            });
            applyServerState(data.state);
            return data.txStatus;
        },

        saveAppSettings: async (settings) => {
            const data = await apiRequest('/admin/settings', {
                method: 'PUT',
                body: JSON.stringify({ settings })
            });
            applyServerState(data.state);
        }
    };
})();

/**
 * ====================================================================
 * LAYER 2: SoundFX Audio Manager (MP3 Game & Background Audio + Tone.js)
 * ====================================================================
 */
const SoundFX = (() => {
    const WHEEL_CANDIDATES = ['/api/sound/wheel'];
    const MYSTERY_CANDIDATES = ['/api/sound/mystery'];
    const SLOT_CANDIDATES = ['/api/sound/slot', '/sound/Slots.mp3', '/Slots.mp3'];
    const BG_SECONDARY_CANDIDATES = ['/api/sound/undertaker'];

    const BG_VOLUME = 0.25;
    const GAME_VOLUME = 0.85;

    let wheelAudio = null;
    let mysteryAudio = null;
    let slotAudio = null;
    let bgSecondaryAudio = null;

    let userGestureUnlocked = false;
    let activeGamesCount = 0;
    let bgDesired = false;
    let synth = null;

    const isSoundEnabled = () => Boolean(ApiClient.getState().settings?.soundEnabled);

    const createAudioWithCandidates = (candidates, loop = false, volume = 1.0, shouldAutoResume = null) => {
        try {
            let idx = 0;
            const audio = new Audio();
            audio.preload = 'auto';
            audio.loop = loop;
            audio.volume = volume;
            audio.src = candidates[idx];

            audio.addEventListener('error', () => {
                if (idx < candidates.length - 1) {
                    idx++;
                    try {
                        audio.src = candidates[idx];
                        audio.loop = loop;
                        audio.volume = volume;
                        if (typeof shouldAutoResume === 'function' && shouldAutoResume()) {
                            const p = audio.play();
                            if (p && typeof p.catch === 'function') {
                                p.catch(() => { });
                            }
                        }
                    } catch (e) { }
                }
            });

            return audio;
        } catch (e) {
            return null;
        }
    };

    const ensureAudioElements = () => {
        if (!wheelAudio) {
            wheelAudio = createAudioWithCandidates(
                WHEEL_CANDIDATES,
                true,
                GAME_VOLUME,
                () => activeGamesCount > 0 && isSoundEnabled() && userGestureUnlocked
            );
        }
        if (!mysteryAudio) {
            mysteryAudio = createAudioWithCandidates(
                MYSTERY_CANDIDATES,
                false,
                GAME_VOLUME,
                () => activeGamesCount > 0 && isSoundEnabled() && userGestureUnlocked
            );
        }
        if (!slotAudio) {
            slotAudio = createAudioWithCandidates(
                SLOT_CANDIDATES,
                true,
                GAME_VOLUME,
                () => activeGamesCount > 0 && isSoundEnabled() && userGestureUnlocked
            );
        }
        if (!bgSecondaryAudio) {
            bgSecondaryAudio = createAudioWithCandidates(
                BG_SECONDARY_CANDIDATES,
                true,
                BG_VOLUME,
                () => bgDesired && activeGamesCount === 0 && isSoundEnabled() && userGestureUnlocked
            );
        }
    };

    const safePlay = (audioEl, volume = 1.0, resetTime = true) => {
        if (!audioEl || !isSoundEnabled()) return;
        try {
            audioEl.volume = volume;
            if (resetTime) {
                audioEl.currentTime = 0;
            }
            const p = audioEl.play();
            if (p && typeof p.catch === 'function') {
                p.catch(() => { });
            }
        } catch (e) { }
    };

    const safeStop = (audioEl, resetTime = true) => {
        if (!audioEl) return;
        try {
            if (!audioEl.paused) {
                audioEl.pause();
            }
            if (resetTime) {
                audioEl.currentTime = 0;
            }
        } catch (e) { }
    };

    const syncBackgroundPlayback = () => {
        ensureAudioElements();

        if (!isSoundEnabled() || !bgDesired || activeGamesCount > 0 || !userGestureUnlocked) {
            safeStop(bgSecondaryAudio, false);
            return;
        }

        if (bgSecondaryAudio && bgSecondaryAudio.paused) {
            safePlay(bgSecondaryAudio, BG_VOLUME, false);
        }
    };

    const ensureSynth = async () => {
        if (!isSoundEnabled()) return null;
        try {
            const ToneLib = await ToneLoader.load();
            if (!ToneLib) return null;
            if (ToneLib.context.state !== 'running') {
                await ToneLib.start();
            }
            if (!synth) {
                synth = new ToneLib.PolySynth(ToneLib.Synth, {
                    oscillator: { type: 'triangle' },
                    envelope: { attack: 0.01, decay: 0.12, sustain: 0.05, release: 0.2 }
                }).toDestination();
                synth.volume.value = -10;
            }
            return synth;
        } catch (e) {
            return null;
        }
    };

    return {
        unlockAndInit: () => {
            ensureAudioElements();
            if (!userGestureUnlocked) {
                userGestureUnlocked = true;
            }
            if (typeof window.Tone !== 'undefined' && window.Tone.context.state !== 'running') {
                window.Tone.start().catch(() => { });
            }
            syncBackgroundPlayback();
        },

        setBackgroundActive: (shouldBeActive) => {
            bgDesired = Boolean(shouldBeActive);
            syncBackgroundPlayback();
        },

        startWheelSpinAudio: (spinDurationMs = 4200) => {
            userGestureUnlocked = true;
            ensureAudioElements();
            activeGamesCount = Math.max(0, activeGamesCount) + 1;

            safeStop(bgSecondaryAudio, false);
            safeStop(mysteryAudio, true);
            safeStop(slotAudio, true);
            safeStop(wheelAudio, true);

            if (wheelAudio && isSoundEnabled()) {
                try {
                    if (Number.isFinite(wheelAudio.duration) && wheelAudio.duration > 0 && spinDurationMs > 0) {
                        const rate = wheelAudio.duration / (spinDurationMs / 1000);
                        wheelAudio.playbackRate = Math.min(2.0, Math.max(0.65, rate));
                        wheelAudio.loop = rate < 0.65;
                    } else {
                        wheelAudio.playbackRate = 1.0;
                        wheelAudio.loop = true;
                    }
                } catch (e) { }
                safePlay(wheelAudio, GAME_VOLUME, true);
            }
        },

        stopWheelSpinAudio: () => {
            safeStop(wheelAudio, true);
            activeGamesCount = Math.max(0, activeGamesCount - 1);
            syncBackgroundPlayback();
        },

        startMysteryBoxAudio: (openDurationMs = 1250) => {
            userGestureUnlocked = true;
            ensureAudioElements();
            activeGamesCount = Math.max(0, activeGamesCount) + 1;

            safeStop(bgSecondaryAudio, false);
            safeStop(wheelAudio, true);
            safeStop(slotAudio, true);
            safeStop(mysteryAudio, true);

            if (mysteryAudio && isSoundEnabled()) {
                try {
                    mysteryAudio.playbackRate = 1.0;
                    mysteryAudio.loop = false;
                } catch (e) { }
                safePlay(mysteryAudio, GAME_VOLUME, true);
            }
        },

        stopMysteryBoxAudio: () => {
            safeStop(mysteryAudio, true);
            activeGamesCount = Math.max(0, activeGamesCount - 1);
            syncBackgroundPlayback();
        },

        startSlotSpinAudio: (spinDurationMs = 2800) => {
            userGestureUnlocked = true;
            ensureAudioElements();
            activeGamesCount = Math.max(0, activeGamesCount) + 1;

            safeStop(bgSecondaryAudio, false);
            safeStop(wheelAudio, true);
            safeStop(mysteryAudio, true);
            safeStop(slotAudio, true);

            if (slotAudio && isSoundEnabled()) {
                try {
                    if (Number.isFinite(slotAudio.duration) && slotAudio.duration > 0 && spinDurationMs > 0) {
                        const rate = slotAudio.duration / (spinDurationMs / 1000);
                        slotAudio.playbackRate = Math.min(1.8, Math.max(0.75, rate));
                        slotAudio.loop = slotAudio.duration < (spinDurationMs / 1000);
                    } else {
                        slotAudio.playbackRate = 1.0;
                        slotAudio.loop = true;
                    }
                } catch (e) { }
                safePlay(slotAudio, GAME_VOLUME, true);
            }
        },

        stopSlotSpinAudio: () => {
            safeStop(slotAudio, true);
            activeGamesCount = Math.max(0, activeGamesCount - 1);
            syncBackgroundPlayback();
        },

        handleSoundToggle: () => {
            if (!isSoundEnabled()) {
                safeStop(wheelAudio, true);
                safeStop(mysteryAudio, true);
                safeStop(slotAudio, true);
                safeStop(bgSecondaryAudio, false);
            } else {
                userGestureUnlocked = true;
                syncBackgroundPlayback();
            }
        },

        playTick: async () => {
            if (wheelAudio && !wheelAudio.paused) return;
            const s = await ensureSynth();
            if (s) s.triggerAttackRelease('C6', '32n');
        },

        playWinFanfare: async (isBigWin = false) => {
            const s = await ensureSynth();
            if (!s) return;
            const ToneLib = window.Tone;
            if (!ToneLib) return;
            const now = ToneLib.now();
            if (isBigWin) {
                s.triggerAttackRelease(['C5', 'E5'], '16n', now);
                s.triggerAttackRelease(['G5', 'C6'], '8n', now + 0.12);
            } else {
                s.triggerAttackRelease('E5', '16n', now);
            }
        },

        playBoxShake: async () => {
            if (mysteryAudio && !mysteryAudio.paused) return;
            const s = await ensureSynth();
            if (s) s.triggerAttackRelease('G3', '16n');
        }
    };
})();

/**
 * ====================================================================
 * LAYER 3: Confetti Particle Engine
 * ====================================================================
 */
const ConfettiEngine = (() => {
    let particles = [];
    let animId = null;

    const launch = () => {
        if (!ApiClient.getState().settings.enableConfetti) return;
        const canvas = document.getElementById('confetti-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const colors = ['#f6d155', '#d92662', '#c91429', '#278a3f', '#1565c0', '#ffffff'];
        for (let i = 0; i < 85; i++) {
            particles.push({
                x: canvas.width / 2 + (Math.random() - 0.5) * 180,
                y: canvas.height / 2,
                vx: (Math.random() - 0.5) * 16,
                vy: -Math.random() * 15 - 5,
                size: Math.random() * 8 + 4,
                color: colors[Math.floor(Math.random() * colors.length)],
                rot: Math.random() * 360,
                vrot: (Math.random() - 0.5) * 12,
                life: 100
            });
        }

        const render = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles = particles.filter(p => p.life > 0);
            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.42;
                p.rot += p.vrot;
                p.life -= 1.3;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rot * Math.PI) / 180);
                ctx.fillStyle = p.color;
                ctx.globalAlpha = Math.max(0, p.life / 100);
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
                ctx.restore();
            });
            if (particles.length > 0) {
                animId = requestAnimationFrame(render);
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        };
        if (animId) cancelAnimationFrame(animId);
        render();
    };

    return { launch };
})();

/**
 * ====================================================================
 * LAYER 4: Main Application Controller & UI Renderer
 * ====================================================================
 */
const AppController = (() => {
    let currentMainView = 'auth';
    let currentPlayerHistoryFilter = 'ALL';
    let wheelRotationDeg = 0;
    let isWheelSpinning = false;
    let isBoxOpening = false;
    let isSlotSpinning = false;
    let isPurchasingInvestment = false;
    let chatPollInterval = null;

    // SVG Symbols for the 3-Reel 777 Jackpot Slot Machine
    const SLOT_SYMBOL_SVGS = {
        '7': `
            <svg viewBox="0 0 80 72" class="w-12 h-12 sm:w-14 sm:h-14 mx-auto drop-shadow">
                <defs>
                    <linearGradient id="slot7Grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#ff2a2a"/>
                        <stop offset="55%" stop-color="#cc0000"/>
                        <stop offset="100%" stop-color="#7a0000"/>
                    </linearGradient>
                </defs>
                <path d="M14 10 H66 L36 64 H20 L47 22 H14 Z" fill="url(#slot7Grad)" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
            </svg>`,
        'CHERRY': `
            <svg viewBox="0 0 80 56" class="w-11 h-9 sm:w-12 sm:h-10 mx-auto drop-shadow">
                <path d="M26 36 C 28 18, 40 12, 48 8" stroke="#4d7c0f" stroke-width="3.5" fill="none" stroke-linecap="round"/>
                <path d="M54 36 C 50 20, 44 14, 48 8" stroke="#4d7c0f" stroke-width="3.5" fill="none" stroke-linecap="round"/>
                <ellipse cx="42" cy="9" rx="9" ry="4.5" transform="rotate(-18 42 9)" fill="#65a30d"/>
                <circle cx="25" cy="39" r="11" fill="#dc2626"/>
                <circle cx="54" cy="39" r="11" fill="#b91c1c"/>
                <ellipse cx="21" cy="35" rx="3.5" ry="2" fill="#fca5a5" opacity="0.8"/>
                <ellipse cx="50" cy="35" rx="3.5" ry="2" fill="#fca5a5" opacity="0.8"/>
            </svg>`,
        'BERRY': `
            <svg viewBox="0 0 80 56" class="w-11 h-9 sm:w-12 sm:h-10 mx-auto drop-shadow">
                <path d="M40 48 C 22 46, 20 22, 34 18 C 40 16, 40 16, 46 18 C 60 22, 58 46, 40 48 Z" fill="#b91c1c"/>
                <path d="M28 17 L40 10 L52 17 L44 21 L40 16 L36 21 Z" fill="#4d7c0f"/>
                <circle cx="34" cy="28" r="1.4" fill="#fde047"/>
                <circle cx="44" cy="27" r="1.4" fill="#fde047"/>
                <circle cx="39" cy="35" r="1.4" fill="#fde047"/>
                <circle cx="32" cy="39" r="1.4" fill="#fde047"/>
                <circle cx="46" cy="38" r="1.4" fill="#fde047"/>
            </svg>`,
        'DIAMOND': `
            <svg viewBox="0 0 80 64" class="w-11 h-11 sm:w-12 sm:h-12 mx-auto drop-shadow">
                <polygon points="24,10 56,10 68,26 40,56 12,26" fill="#38bdf8" stroke="#e0f2fe" stroke-width="2"/>
                <polygon points="24,10 56,10 48,26 32,26" fill="#bae6fd"/>
                <polygon points="32,26 48,26 40,56" fill="#0284c7"/>
            </svg>`,
        'BELL': `
            <svg viewBox="0 0 80 64" class="w-11 h-11 sm:w-12 sm:h-12 mx-auto drop-shadow">
                <path d="M40 8 C 25 8, 20 22, 18 42 L 12 48 H 68 L 62 42 C 60 22, 55 8, 40 8 Z" fill="#facc15" stroke="#fef08a" stroke-width="2"/>
                <circle cx="40" cy="52" r="6" fill="#ca8a04"/>
            </svg>`,
        'MELON': ` <svg viewBox="0 0 80 56" class="w-11 h-9 sm:w-12 sm:h-10 mx-auto drop-shadow"><circle cx="40" cy="28" r="20" fill="#22c55e"/></svg> `,
        'GRAPE': ` <svg viewBox="0 0 80 56" class="w-11 h-9 sm:w-12 sm:h-10 mx-auto drop-shadow"><circle cx="40" cy="28" r="20" fill="#a855f7"/></svg> `,
        'LEMON': ` <svg viewBox="0 0 80 56" class="w-11 h-9 sm:w-12 sm:h-10 mx-auto drop-shadow"><circle cx="40" cy="28" r="20" fill="#eab308"/></svg> `
    };

    const getReelNeighbors = (centerSymbol) => {
        if (centerSymbol === '7') return { top: 'CHERRY', bottom: 'BERRY' };
        if (centerSymbol === 'CHERRY') return { top: 'BERRY', bottom: '7' };
        if (centerSymbol === 'BERRY') return { top: '7', bottom: 'CHERRY' };
        if (centerSymbol === 'DIAMOND') return { top: 'CHERRY', bottom: '7' };
        if (centerSymbol === 'MELON') return { top: 'CHERRY', bottom: 'BERRY' };
        if (centerSymbol === 'GRAPE') return { top: 'BERRY', bottom: '7' };
        if (centerSymbol === 'LEMON') return { top: '7', bottom: 'CHERRY' };
        return { top: 'CHERRY', bottom: 'BERRY' };
    };

    const renderReelColumnHTML = (centerSym = '7') => {
        const { top, bottom } = getReelNeighbors(centerSym);
        return `
            <div class="slot-reel-item opacity-75 scale-75 -mb-2">${SLOT_SYMBOL_SVGS[top] || SLOT_SYMBOL_SVGS['CHERRY']}</div>
            <div class="slot-reel-item scale-105 my-0.5">${SLOT_SYMBOL_SVGS[centerSym] || SLOT_SYMBOL_SVGS['7']}</div>
            <div class="slot-reel-item opacity-75 scale-75 -mt-2">${SLOT_SYMBOL_SVGS[bottom] || SLOT_SYMBOL_SVGS['BERRY']}</div>
        `;
    };

    const calculateTotalROI = () => {
        const freq = document.getElementById('admin-invest-frequency')?.value;
        const cost = Number(document.getElementById('admin-invest-cost')?.value || 0);
        const roi = Number(document.getElementById('admin-invest-roi')?.value || 0);
        const days = Number(document.getElementById('admin-invest-duration')?.value || 0);
        const retInput = document.getElementById('admin-invest-return');

        if (freq === 'Daily' && retInput) {
            const total = cost * (roi / 100) * days;
            retInput.value = total.toFixed(2);
        }
    };

    /**
     * Dynamically injects the 777 Jackpot Slot Machine UI into the DOM
     */
    const ensureSlotMachineDOM = () => {
        if (!document.getElementById('lv-slot-machine-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'lv-slot-machine-styles';
            styleEl.textContent = `
                @keyframes slotReelBlurSpin {
                    0% { transform: translateY(-18px); filter: blur(1.5px); }
                    50% { transform: translateY(18px); filter: blur(2.5px); }
                    100% { transform: translateY(-18px); filter: blur(1.5px); }
                }
                .slot-reel-spinning {
                    animation: slotReelBlurSpin 0.14s linear infinite;
                }
                .slot-cabinet-stage {
                    background: repeating-conic-gradient(from 0deg at 50% 50%, #990d16 0deg 10deg, #b8141f 10deg 20deg);
                    box-shadow: inset 0 0 45px rgba(0, 0, 0, 0.75);
                }
                .slot-reel-drum {
                    background: linear-gradient(180deg, #cfcfcf 0%, #ffffff 22%, #ffffff 78%, #bcbcbc 100%);
                    box-shadow: inset 0 10px 14px rgba(0,0,0,0.38), inset 0 -10px 14px rgba(0,0,0,0.38), 0 2px 6px rgba(0,0,0,0.6);
                }
                .slot-lever-arm {
                    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
                    transform-origin: bottom center;
                }
                .slot-lever-pulled .slot-lever-arm {
                    transform: rotate(38deg) scaleY(0.82);
                }
                @keyframes slotBulbBlink {
                    0%, 100% { opacity: 1; filter: drop-shadow(0 0 6px #fde047); }
                    50% { opacity: 0.45; filter: none; }
                }
                .slot-bulb {
                    animation: slotBulbBlink 1.1s ease-in-out infinite;
                }
            `;
            document.head.appendChild(styleEl);
        }

        const mysteryNavBtn = document.getElementById('pnav-mystery');
        if (mysteryNavBtn && !document.getElementById('pnav-slot')) {
            const slotNavBtn = document.createElement('button');
            slotNavBtn.id = 'pnav-slot';
            slotNavBtn.setAttribute('onclick', "AppController.switchPlayerSection('slot')");
            slotNavBtn.className = 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition flex items-center gap-2 text-gray-400 hover:text-white whitespace-nowrap';
            slotNavBtn.innerHTML = `<i class="fa-solid fa-slot-machine fa-coins"></i> 777 Slots`;
            mysteryNavBtn.insertAdjacentElement('afterend', slotNavBtn);
        }

        const arenaGrid = document.getElementById('games-arena-grid');
        if (arenaGrid && !document.getElementById('player-sec-slot')) {
            const slotSec = document.createElement('section');
            slotSec.id = 'player-sec-slot';
            slotSec.className = 'vault-card rounded-3xl p-4 sm:p-6 xl:col-span-12 flex flex-col relative overflow-hidden';
            slotSec.innerHTML = `
                <div class="flex items-center justify-between mb-4">
                    <div>
                        <h2 class="font-display font-extrabold text-lg sm:text-xl text-white flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.9)]"></span>
                            777 JACKPOT SLOTS
                        </h2>
                        <p class="text-[11px] sm:text-xs text-gray-400 mt-0.5">3-Reel Classic Machine • Instant Jackpot</p>
                    </div>
                    <div id="slot-status-badge" class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        LIVE GAME
                    </div>
                </div>
                <div class="flex items-center justify-between mb-4 bg-black/60 p-3 rounded-2xl border border-white/10 shadow-inner">
                    <div>
                        <div class="text-[10px] text-gray-400 uppercase font-bold">Jackpot (7-7-7)</div>
                        <div id="slot-max-prize-text" class="font-display font-extrabold text-royal-gold text-sm sm:text-base text-glow-gold">₦5,000.00</div>
                    </div>
                    <div class="text-right">
                        <div class="text-[10px] text-gray-400 uppercase font-bold">Cost Per Spin</div>
                        <div id="slot-spin-cost-label" class="font-display font-extrabold text-white text-sm sm:text-base">₦250.00</div>
                    </div>
                </div>
                <div class="slot-cabinet-stage rounded-2xl p-4 sm:p-6 mb-4 border border-rose-500/30 flex flex-col items-center justify-center relative min-h-[290px] sm:min-h-[330px] overflow-hidden">
                    <div class="relative flex items-center justify-center">
                        <div class="w-[250px] sm:w-[300px] flex flex-col items-center select-none">
                            <div class="w-[92%] py-2 px-4 rounded-t-2xl bg-gradient-to-b from-red-700 via-red-800 to-red-950 border-2 border-red-400/50 shadow-[0_0_25px_rgba(220,38,38,0.7)] text-center relative">
                                <span class="font-display font-black text-2xl sm:text-3xl tracking-wider text-yellow-300 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">JACKPOT</span>
                            </div>
                            <div class="w-full rounded-2xl bg-gradient-to-b from-neutral-200 via-neutral-400 to-neutral-700 p-2.5 sm:p-3 shadow-2xl border-2 border-white/40 relative">
                                <div class="flex items-center justify-around px-2 pb-2">
                                    <span class="w-2.5 h-2.5 rounded-full bg-yellow-300 slot-bulb"></span>
                                    <span class="w-2.5 h-2.5 rounded-full bg-rose-500 slot-bulb" style="animation-delay:0.2s"></span>
                                    <span class="w-2.5 h-2.5 rounded-full bg-yellow-300 slot-bulb" style="animation-delay:0.4s"></span>
                                    <span class="w-2.5 h-2.5 rounded-full bg-rose-500 slot-bulb" style="animation-delay:0.6s"></span>
                                    <span class="w-2.5 h-2.5 rounded-full bg-yellow-300 slot-bulb" style="animation-delay:0.8s"></span>
                                    <span class="w-2.5 h-2.5 rounded-full bg-rose-500 slot-bulb" style="animation-delay:1.0s"></span>
                                    <span class="w-2.5 h-2.5 rounded-full bg-yellow-300 slot-bulb" style="animation-delay:0.3s"></span>
                                </div>
                                <div class="bg-neutral-950 rounded-xl p-2 border-4 border-neutral-800 relative shadow-inner">
                                    <div class="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-red-500/45 z-20 pointer-events-none"></div>
                                    <div class="grid grid-cols-3 gap-1.5 sm:gap-2 h-28 sm:h-32 overflow-hidden rounded-lg">
                                        <div class="slot-reel-drum rounded-md flex flex-col items-center justify-center overflow-hidden relative">
                                            <div id="slot-reel-col-0" class="flex flex-col items-center justify-center w-full h-full">${renderReelColumnHTML('7')}</div>
                                        </div>
                                        <div class="slot-reel-drum rounded-md flex flex-col items-center justify-center overflow-hidden relative">
                                            <div id="slot-reel-col-1" class="flex flex-col items-center justify-center w-full h-full">${renderReelColumnHTML('7')}</div>
                                        </div>
                                        <div class="slot-reel-drum rounded-md flex flex-col items-center justify-center overflow-hidden relative">
                                            <div id="slot-reel-col-2" class="flex flex-col items-center justify-center w-full h-full">${renderReelColumnHTML('7')}</div>
                                        </div>
                                    </div>
                                </div>
                                <div class="mt-2.5 bg-gradient-to-b from-neutral-600 via-neutral-700 to-neutral-900 rounded-xl p-2.5 border border-white/20 shadow-inner">
                                    <div class="flex items-center justify-around mb-2.5">
                                        <button type="button" onclick="AppController.spinSlotMachine()" class="w-10 h-4 sm:w-12 sm:h-5 rounded-full bg-gradient-to-b from-red-500 to-red-700 border border-red-300/60 shadow-[0_3px_0_#450a0a] active:translate-y-0.5"></button>
                                        <button type="button" onclick="AppController.spinSlotMachine()" class="w-11 h-4 sm:w-14 sm:h-5 rounded-full bg-gradient-to-b from-yellow-300 to-amber-500 border border-yellow-100/80 shadow-[0_3px_0_#713f12] active:translate-y-0.5"></button>
                                        <button type="button" onclick="AppController.spinSlotMachine()" class="w-10 h-4 sm:w-12 sm:h-5 rounded-full bg-gradient-to-b from-red-500 to-red-700 border border-red-300/60 shadow-[0_3px_0_#450a0a] active:translate-y-0.5"></button>
                                    </div>
                                    <div class="w-3/5 h-3.5 mx-auto rounded bg-neutral-950 border border-neutral-600 shadow-inner"></div>
                                </div>
                            </div>
                        </div>
                        <div id="slot-lever-wrapper" onclick="AppController.spinSlotMachine()" title="Pull Lever to Spin!" class="absolute -right-4 sm:-right-6 top-1/2 -translate-y-1/2 flex items-center cursor-pointer group z-20">
                            <div class="w-4 h-16 sm:w-5 sm:h-20 rounded-r-xl bg-gradient-to-b from-neutral-500 via-neutral-700 to-neutral-900 border-y border-r border-white/20 shadow-xl"></div>
                            <div class="slot-lever-arm relative h-24 sm:h-28 w-6 -ml-1.5 -mt-16 flex flex-col items-center">
                                <div class="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-yellow-200 via-yellow-400 to-amber-600 shadow-[0_0_16px_rgba(250,204,21,0.9)] border border-white/80 group-hover:scale-110 transition"></div>
                                <div class="w-1.5 flex-1 bg-gradient-to-r from-neutral-300 via-neutral-500 to-neutral-800 rounded-full -mt-1 shadow"></div>
                            </div>
                        </div>
                    </div>
                    <div id="slot-result-banner" class="mt-4 min-h-[24px] text-center text-xs sm:text-sm font-semibold text-white drop-shadow">Pull the golden lever or press Spin to hit 7-7-7!</div>
                </div>
                <div>
                    <div id="slot-prizes-pills" class="grid grid-cols-4 sm:grid-cols-8 gap-1.5 sm:gap-2 mb-4"></div>
                    <button onclick="AppController.spinSlotMachine()" id="btn-slot-spin" class="w-full py-3.5 sm:py-4 rounded-2xl btn-gold-gradient btn-glow-gold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                        <i class="fa-solid fa-bolt text-lg"></i>
                        <span id="btn-slot-spin-text" class="text-sm sm:text-base">PULL LEVER / SPIN (₦250.00)</span>
                    </button>
                </div>
            `;
            arenaGrid.appendChild(slotSec);
        }

        ['slot-reel-col-0', 'slot-reel-col-1', 'slot-reel-col-2'].forEach((id) => {
            const colEl = document.getElementById(id);
            if (colEl && colEl.children.length === 0) {
                colEl.innerHTML = renderReelColumnHTML('7');
            }
        });
    };

    /**
     * Dynamically injects the Investment Plan UI DOM for Players & Admins if missing
     */
    const ensureInvestmentDOM = () => {
        const historyNavBtn = document.getElementById('pnav-history');
        if (historyNavBtn && !document.getElementById('pnav-invest')) {
            const investBtn = document.createElement('button');
            investBtn.id = 'pnav-invest';
            investBtn.setAttribute('onclick', "AppController.switchPlayerSection('invest')");
            investBtn.className = 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition flex items-center gap-2 text-gray-400 hover:text-white whitespace-nowrap';
            investBtn.innerHTML = `<i class="fa-solid fa-chart-line"></i> Invest`;
            historyNavBtn.insertAdjacentElement('beforebegin', investBtn);
        }

        const arenaGrid = document.getElementById('games-arena-grid');
        if (arenaGrid && !document.getElementById('player-sec-invest')) {
            const investSec = document.createElement('section');
            investSec.id = 'player-sec-invest';
            investSec.className = 'vault-card rounded-3xl p-4 sm:p-6 flex flex-col relative hidden w-full mb-6';
            investSec.innerHTML = `
                <div class="flex items-center justify-between mb-4">
                    <div>
                        <h2 class="font-display font-extrabold text-lg sm:text-xl text-white flex items-center gap-2">
                            <i class="fa-solid fa-chart-line text-emerald-400"></i> INVESTMENT PLANS
                        </h2>
                        <p class="text-[11px] sm:text-xs text-gray-400 mt-0.5">Grow your balance with timed maturity packages.</p>
                    </div>
                </div>
                <div id="invest-plans-grid" class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8"></div>
                
                <div class="pt-4 border-t border-white/10">
                    <h3 class="font-display font-bold text-lg text-white mb-3 flex items-center gap-2">
                        <i class="fa-solid fa-briefcase text-royal-gold"></i> My Active Portfolio
                    </h3>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left border-collapse">
                            <thead>
                                <tr class="border-b border-white/10 text-[10px] uppercase tracking-wider text-gray-400">
                                    <th class="py-2 px-3 font-semibold">Plan Name</th>
                                    <th class="py-2 px-3 font-semibold">Invested</th>
                                    <th class="py-2 px-3 font-semibold">Expected Return</th>
                                    <th class="py-2 px-3 font-semibold">Maturity Date</th>
                                    <th class="py-2 px-3 font-semibold text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody id="invest-portfolio-tbody" class="text-sm divide-y divide-white/5"></tbody>
                        </table>
                    </div>
                </div>
            `;
            arenaGrid.parentNode.insertBefore(investSec, arenaGrid.nextSibling);
        }

        const anavSettings = document.getElementById('anav-settings');
        if (anavSettings && !document.getElementById('anav-investments')) {
            const adminInvestBtn = document.createElement('button');
            adminInvestBtn.id = 'anav-investments';
            adminInvestBtn.setAttribute('onclick', "AppController.switchAdminTab('investments')");
            adminInvestBtn.className = 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition text-gray-400 hover:bg-espresso-800 hover:text-white whitespace-nowrap';
            adminInvestBtn.textContent = 'Investments';
            anavSettings.insertAdjacentElement('beforebegin', adminInvestBtn);
        }

        const mainAdmin = document.getElementById('admin-tab-settings')?.parentNode;
        if (mainAdmin && !document.getElementById('admin-tab-investments')) {
            const adminInvestSec = document.createElement('section');
            adminInvestSec.id = 'admin-tab-investments';
            adminInvestSec.className = 'vault-card rounded-3xl p-4 sm:p-6 hidden';
            adminInvestSec.innerHTML = `
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                        <h2 class="font-display font-extrabold text-xl text-white">Investment Plans Configuration</h2>
                        <p class="text-xs text-gray-400 mt-1">Manage investment packages and maturity yields dynamically.</p>
                    </div>
                    <button onclick="AppController.showAdminInvestForm()" class="px-4 py-2 rounded-xl btn-gold-gradient text-xs font-bold shadow-inner">
                        <i class="fa-solid fa-plus mr-1"></i> Create New Plan
                    </button>
                </div>
                
                <div id="admin-invest-form-container" class="hidden mb-6 p-4 bg-black/40 border border-white/10 rounded-2xl shadow-inner">
                    <input type="hidden" id="admin-invest-id" value="">
                    <h3 id="admin-invest-form-title" class="font-display font-bold text-sm text-royal-gold mb-3">Create Investment Plan</h3>
                    
                    <div class="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end mb-3">
                        <div class="col-span-1 sm:col-span-3">
                            <label class="block text-[11px] uppercase font-semibold text-gray-400 mb-1">Plan Name</label>
                            <input type="text" id="admin-invest-name" placeholder="e.g. Basic Plan" class="w-full px-3 py-2 rounded-lg bg-black/60 border border-white/10 text-sm text-white focus:border-royal-gold/50 focus:outline-none">
                        </div>
                        <div class="col-span-1 sm:col-span-2">
                            <label class="block text-[11px] uppercase font-semibold text-gray-400 mb-1">Cost</label>
                            <input type="number" id="admin-invest-cost" oninput="AppController.calculateTotalROI()" placeholder="1000" class="w-full px-3 py-2 rounded-lg bg-black/60 border border-white/10 text-sm text-white font-mono focus:border-royal-gold/50 focus:outline-none">
                        </div>
                        <div class="col-span-1 sm:col-span-3">
                            <label class="block text-[11px] uppercase font-semibold text-gray-400 mb-1">Frequency</label>
                            <select id="admin-invest-frequency" onchange="AppController.calculateTotalROI()" class="w-full px-3 py-2 rounded-lg bg-black/60 border border-white/10 text-sm text-white focus:border-royal-gold/50 focus:outline-none">
                                <option value="Maturity">Maturity (Lump Sum)</option>
                                <option value="Daily">Daily Payout</option>
                            </select>
                        </div>
                        <div class="col-span-1 sm:col-span-2">
                            <label class="block text-[11px] uppercase font-semibold text-gray-400 mb-1">Daily ROI (%)</label>
                            <input type="number" step="0.1" id="admin-invest-roi" oninput="AppController.calculateTotalROI()" placeholder="3.0" class="w-full px-3 py-2 rounded-lg bg-black/60 border border-white/10 text-sm text-white font-mono focus:border-royal-gold/50 focus:outline-none">
                        </div>
                        <div class="col-span-1 sm:col-span-2">
                            <label class="block text-[11px] uppercase font-semibold text-gray-400 mb-1">Duration (Days)</label>
                            <input type="number" id="admin-invest-duration" oninput="AppController.calculateTotalROI()" placeholder="3" class="w-full px-3 py-2 rounded-lg bg-black/60 border border-white/10 text-sm text-white font-mono focus:border-royal-gold/50 focus:outline-none">
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                        <div class="col-span-1 sm:col-span-3">
                            <label class="block text-[11px] uppercase font-semibold text-gray-400 mb-1">Return Amount</label>
                            <input type="number" id="admin-invest-return" placeholder="2000" class="w-full px-3 py-2 rounded-lg bg-black/60 border border-white/10 text-sm text-white font-mono focus:border-royal-gold/50 focus:outline-none">
                        </div>
                        <div class="col-span-1 sm:col-span-9 flex gap-2">
                            <button onclick="AppController.saveAdminInvestPlan()" class="flex-1 py-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold hover:bg-emerald-500/30 transition">Save</button>
                            <button onclick="AppController.hideAdminInvestForm()" class="px-5 py-2 rounded-lg bg-espresso-800 text-stone-300 border border-white/10 text-xs font-bold hover:bg-espresso-700 transition">Cancel</button>
                        </div>
                    </div>
                </div>
                
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="border-b border-white/10 text-[10px] uppercase tracking-wider text-gray-400">
                                <th class="py-3 px-4 font-semibold">Plan Details</th>
                                <th class="py-3 px-4 font-semibold">Cost</th>
                                <th class="py-3 px-4 font-semibold">Total Return</th>
                                <th class="py-3 px-4 font-semibold">Duration</th>
                                <th class="py-3 px-4 font-semibold">Status</th>
                                <th class="py-3 px-4 font-semibold text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="admin-investments-tbody" class="text-sm divide-y divide-white/5"></tbody>
                    </table>
                </div>
            `;
            mainAdmin.appendChild(adminInvestSec);
        }
    };

    /**
     * Ensures the DOM for the Admin Chat Interface exists and binds events.
     */
    const ensureAdminChatDOM = () => {
        const anavSettings = document.getElementById('anav-settings');
        if (anavSettings && !document.getElementById('anav-chat')) {
            const adminChatBtn = document.createElement('button');
            adminChatBtn.id = 'anav-chat';
            adminChatBtn.setAttribute('onclick', "AppController.switchAdminTab('chat')");
            adminChatBtn.className = 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition text-gray-400 hover:bg-espresso-800 hover:text-white whitespace-nowrap';
            adminChatBtn.innerHTML = `<i class="fa-solid fa-headset mr-1"></i> Live Chat`;
            anavSettings.insertAdjacentElement('beforebegin', adminChatBtn);
        }

        const mainAdmin = document.getElementById('admin-tab-settings')?.parentNode;
        if (mainAdmin && !document.getElementById('admin-tab-chat')) {
            const adminChatSec = document.createElement('section');
            adminChatSec.id = 'admin-tab-chat';
            adminChatSec.className = 'vault-card rounded-3xl p-4 sm:p-6 hidden h-[600px] flex-col';
            adminChatSec.innerHTML = `
                <div class="flex items-center justify-between mb-4">
                    <div>
                        <h2 class="font-display font-extrabold text-xl text-white">Live Support</h2>
                        <p class="text-xs text-gray-400 mt-1">Manage user conversations.</p>
                    </div>
                </div>
                <div class="flex-1 flex flex-col sm:flex-row gap-4 h-full overflow-hidden">
                    <!-- Left: Sessions -->
                    <div class="w-full sm:w-1/3 bg-black/40 border border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-inner">
                        <div class="p-3 border-b border-white/10 bg-espresso-950">
                            <h3 class="font-bold text-sm text-gray-300">Active Chats</h3>
                        </div>
                        <div id="admin-chat-sessions-list" class="flex-1 overflow-y-auto p-2 space-y-2">
                            <!-- Sessions populated here -->
                        </div>
                    </div>
                    <!-- Right: Chat Window -->
                    <div class="w-full sm:w-2/3 bg-black/40 border border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-inner relative">
                        <div id="admin-chat-header" class="p-4 border-b border-white/10 bg-espresso-950 flex items-center justify-between">
                            <span class="font-bold text-sm text-gray-400">Select a chat to begin</span>
                        </div>
                        <div id="admin-chat-body" class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                            <!-- Messages here -->
                        </div>
                        <div class="p-3 bg-espresso-950 border-t border-white/10 flex items-center gap-2">
                            <input type="text" id="admin-chat-input" disabled placeholder="Type a reply..." class="flex-1 bg-[#111111] border border-white/20 rounded-xl px-3.5 py-2.5 text-xs text-white font-medium focus:outline-none focus:border-royal-gold transition shadow-inner disabled:opacity-50 placeholder-gray-500">
                            <button type="button" id="btn-admin-chat-send" disabled onclick="AppController.sendAdminChatMessage()" class="w-10 h-10 rounded-xl btn-gold-gradient flex items-center justify-center shrink-0 text-black shadow-md transition-transform disabled:opacity-50 hover:scale-105">
                                <i class="fa-solid fa-paper-plane text-xs"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
            mainAdmin.appendChild(adminChatSec);

            const adminInput = document.getElementById('admin-chat-input');
            if (adminInput) {
                adminInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') AppController.sendAdminChatMessage();
                });
            }
        }
    };

    /**
     * Binds events to the player chat widget.
     */
    const setupPlayerChatWidget = () => {
        const chatWin = document.getElementById('live-chat-window');
        if (!chatWin || chatWin.dataset.initialized === 'true') return;
        chatWin.dataset.initialized = 'true';

        const input = document.getElementById('player-chat-input');
        const btn = document.getElementById('btn-player-chat-send');

        if (btn) btn.addEventListener('click', () => sendPlayerChatMessage());
        if (input) input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendPlayerChatMessage(); });

        // Whenever the widget is opened, refresh the correct view
        const widget = document.getElementById('live-chat-widget');
        if (widget) {
            widget.querySelectorAll('button[onclick*="toggle"]').forEach((b) => {
                b.removeAttribute('onclick');
                b.addEventListener('click', () => {
                    chatWin.classList.toggle('hidden');
                    if (!chatWin.classList.contains('hidden')) loadPlayerChat();
                });
            });
            widget.querySelectorAll('button[onclick*="add(\'hidden\')"]').forEach((b) => {
                b.removeAttribute('onclick');
                b.addEventListener('click', () => chatWin.classList.add('hidden'));
            });
        }
    };

    const showToast = (message, type = 'success') => {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const colors = {
            success: 'bg-espresso-900 border-emerald-500/50 text-emerald-200',
            error: 'bg-espresso-900 border-rose-500/60 text-rose-200',
            info: 'bg-espresso-900 border-royal-gold/50 text-amber-100'
        };
        const icons = {
            success: 'fa-circle-check text-emerald-400',
            error: 'fa-circle-exclamation text-rose-400',
            info: 'fa-wand-magic-sparkles text-royal-gold'
        };

        const toast = document.createElement('div');
        toast.className = `pointer-events-auto p-4 rounded-2xl border shadow-2xl flex items-center gap-3 text-xs sm:text-sm font-medium transition-all duration-300 ${colors[type] || colors.info}`;
        toast.innerHTML = `
            <i class="fa-solid ${icons[type] || icons.info} text-lg"></i>
            <span class="flex-1">${message}</span>
        `;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(8px)';
            setTimeout(() => toast.remove(), 280);
        }, 3600);
    };

    const adjustColor = (hex, percent) => {
        if (!hex || hex.length !== 7) return hex;
        let R = parseInt(hex.substring(1, 3), 16);
        let G = parseInt(hex.substring(3, 5), 16);
        let B = parseInt(hex.substring(5, 7), 16);

        R = parseInt(R * (100 + percent) / 100);
        G = parseInt(G * (100 + percent) / 100);
        B = parseInt(B * (100 + percent) / 100);

        R = (R < 255) ? R : 255;
        G = (G < 255) ? G : 255;
        B = (B < 255) ? B : 255;

        R = (R > 0) ? R : 0;
        G = (G > 0) ? G : 0;
        B = (B > 0) ? B : 0;

        const rHex = R.toString(16).padStart(2, '0');
        const gHex = G.toString(16).padStart(2, '0');
        const bHex = B.toString(16).padStart(2, '0');

        return `#${rHex}${gHex}${bHex}`;
    };

    const drawFortuneWheel = () => {
        const canvas = document.getElementById('fortune-wheel-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const segments = ApiClient.getState().wheelConfig.segments;
        if (!segments || segments.length === 0) return;
        const count = segments.length;
        const arcRad = (2 * Math.PI) / count;
        const radius = canvas.width / 2;
        const centerX = radius;
        const centerY = radius;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const startOffset = -Math.PI / 2;

        segments.forEach((seg, index) => {
            const startAngle = startOffset + index * arcRad;
            const endAngle = startAngle + arcRad;

            const grad = ctx.createRadialGradient(centerX, centerY, radius * 0.15, centerX, centerY, radius);
            grad.addColorStop(0, seg.color);
            grad.addColorStop(1, adjustColor(seg.color, -35));

            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, endAngle);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();

            ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.lineWidth = 2;
            ctx.stroke();

            const midAngle = startAngle + arcRad / 2;
            const labelRadius = radius * 0.63;
            const textX = centerX + Math.cos(midAngle) * labelRadius;
            const textY = centerY + Math.sin(midAngle) * labelRadius;

            ctx.save();
            ctx.fillStyle = '#ffffff';
            const isLongLabel = seg.label.length >= 5;
            ctx.font = `800 ${isLongLabel ? '24px' : '30px'} "Outfit", "Inter", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
            ctx.shadowBlur = 4;
            ctx.fillText(seg.label, textX, textY);
            ctx.restore();
        });
    };

    const spinWheel = async () => {
        if (isWheelSpinning) return;
        let audioStarted = false;
        let fastSpinActive = false;
        let fastSpinAnimId = null;
        try {
            isWheelSpinning = true;
            const btn = document.getElementById('btn-spin-now');
            const btnText = document.getElementById('btn-spin-now-text');
            if (btn) btn.disabled = true;

            SoundFX.startWheelSpinAudio(4200);
            audioStarted = true;

            const canvas = document.getElementById('fortune-wheel-canvas');
            const pointer = document.getElementById('wheel-pointer');
            if (btnText) btnText.textContent = 'SPINNING WHEEL...';

            if (canvas) {
                canvas.style.transition = 'none';
                const baseAngle = wheelRotationDeg;
                const spinStart = performance.now();
                const fastSpinSpeed = 720;
                fastSpinActive = true;

                const fastSpinStep = () => {
                    if (!fastSpinActive) return;
                    const elapsed = (performance.now() - spinStart) / 1000;
                    wheelRotationDeg = baseAngle + elapsed * fastSpinSpeed;
                    canvas.style.transform = `rotate(${wheelRotationDeg}deg)`;
                    fastSpinAnimId = requestAnimationFrame(fastSpinStep);
                };
                fastSpinAnimId = requestAnimationFrame(fastSpinStep);
            }

            const outcome = await ApiClient.requestWheelSpin();

            fastSpinActive = false;
            if (fastSpinAnimId) {
                cancelAnimationFrame(fastSpinAnimId);
                fastSpinAnimId = null;
            }
            if (canvas) {
                canvas.style.transform = `rotate(${wheelRotationDeg}deg)`;
                void canvas.offsetWidth;
            }

            const sliceDeg = 360 / ApiClient.getState().wheelConfig.segments.length;
            const jitter = (Math.random() - 0.5) * (sliceDeg * 0.45);
            const targetModDeg = (360 - (outcome.winningIndex * sliceDeg + sliceDeg / 2) + jitter + 360) % 360;

            const currentMod = ((wheelRotationDeg % 360) + 360) % 360;
            let deltaDeg = targetModDeg - currentMod;
            if (deltaDeg < 0) deltaDeg += 360;

            const fullRotations = (3 + Math.floor(Math.random() * 2)) * 360;
            wheelRotationDeg = wheelRotationDeg + fullRotations + deltaDeg;

            if (canvas) {
                canvas.style.transition = 'transform 4.2s cubic-bezier(0.14, 0.88, 0.22, 1)';
                void canvas.offsetWidth;
                canvas.style.transform = `rotate(${wheelRotationDeg}deg)`;
            }

            syncAllViews();

            let ticks = 0;
            const tickInterval = setInterval(() => {
                ticks++;
                if (ticks > 16) {
                    clearInterval(tickInterval);
                    return;
                }
                if (pointer) {
                    pointer.classList.remove('wheel-pointer-tick');
                    void pointer.offsetWidth;
                    pointer.classList.add('wheel-pointer-tick');
                }
            }, 220);

            setTimeout(() => {
                clearInterval(tickInterval);
                SoundFX.stopWheelSpinAudio();
                ApiClient.finalizeWheelSpinPayout();
                isWheelSpinning = false;
                if (btn) btn.disabled = false;

                const curr = ApiClient.getState().settings.currency || '₦';
                const prizeVal = Number(outcome.segment.value);
                const banner = document.getElementById('wheel-result-banner');
                if (banner) {
                    banner.innerHTML = prizeVal > 0
                        ? `<span class="text-emerald-300 font-bold"><i class="fa-solid fa-trophy mr-1.5 text-royal-gold"></i>Landed on ${outcome.segment.label}! Credited +${curr}${prizeVal.toFixed(2)} to wallet.</span><span class="font-mono text-xs text-royal-gold">WINNER</span>`
                        : `<span class="text-stone-300"><i class="fa-solid fa-circle-xmark mr-1.5 text-rose-400"></i>Oops! Better luck next time!</span><span class="font-mono text-xs text-stone-400">TRY AGAIN</span>`;
                }

                if (prizeVal > 0) {
                    SoundFX.playWinFanfare(prizeVal >= 500);
                    ConfettiEngine.launch();
                    openPrizeModal('SPIN THE WHEEL RESULT', `YOU WON ${outcome.segment.label}!`, `The wheel stopped on the ${outcome.segment.label} segment. +${curr}${prizeVal.toFixed(2)} has been credited to your wallet.`);
                } else {
                    showToast('Oops! Better luck next time!', 'info');
                }
                syncAllViews();
            }, 4300);

        } catch (err) {
            fastSpinActive = false;
            if (fastSpinAnimId) {
                cancelAnimationFrame(fastSpinAnimId);
                fastSpinAnimId = null;
            }
            if (audioStarted) {
                SoundFX.stopWheelSpinAudio();
            }
            isWheelSpinning = false;
            const btn = document.getElementById('btn-spin-now');
            if (btn) btn.disabled = false;
            const canvas = document.getElementById('fortune-wheel-canvas');
            if (canvas) {
                canvas.style.transition = 'transform 0.4s ease-out';
                canvas.style.transform = `rotate(${wheelRotationDeg}deg)`;
            }
            showToast(err.message, 'error');
            if (err.message.toLowerCase().includes('insufficient')) {
                openRechargeModal();
            } else if (!ApiClient.hasToken()) {
                switchMainView('auth');
            }
        }
    };

    const spinSlotMachine = async () => {
        if (isSlotSpinning) return;
        const state = ApiClient.getState();
        if (state.settings.maintenanceMode || !state.slotConfig?.available) {
            showToast('777 Jackpot Slots is currently paused for maintenance.', 'error');
            return;
        }

        let audioStarted = false;
        let cyclingTimers = [];
        try {
            isSlotSpinning = true;
            const btn = document.getElementById('btn-slot-spin');
            const btnText = document.getElementById('btn-slot-spin-text');
            const lever = document.getElementById('slot-lever-wrapper');
            const banner = document.getElementById('slot-result-banner');

            if (btn) btn.disabled = true;
            if (btnText) btnText.textContent = 'SPINNING REELS...';
            if (banner) {
                banner.innerHTML = `<span class="text-yellow-300 font-bold animate-pulse"><i class="fa-solid fa-bolt mr-1"></i>Reels spinning... Good luck!</span>`;
            }

            if (lever) {
                lever.classList.add('slot-lever-pulled');
                setTimeout(() => lever.classList.remove('slot-lever-pulled'), 550);
            }

            SoundFX.startSlotSpinAudio(2700);
            audioStarted = true;

            const reelCols = [
                document.getElementById('slot-reel-col-0'),
                document.getElementById('slot-reel-col-1'),
                document.getElementById('slot-reel-col-2')
            ];
            const symbolPool = ['7', 'CHERRY', 'BERRY', 'DIAMOND', 'BELL', 'MELON', 'GRAPE', 'LEMON'];

            reelCols.forEach((col) => {
                if (!col) return;
                col.classList.add('slot-reel-spinning');
                const timer = setInterval(() => {
                    const randSym = symbolPool[Math.floor(Math.random() * symbolPool.length)];
                    col.innerHTML = renderReelColumnHTML(randSym);
                }, 90);
                cyclingTimers.push(timer);
            });

            const outcome = await ApiClient.requestSlotSpin();
            syncAllViews();

            const targetCombo = outcome.prizeTier?.combo || ['CHERRY', '7', 'BERRY'];
            const stopDelays = [1200, 1950, 2700];

            stopDelays.forEach((delay, idx) => {
                setTimeout(() => {
                    if (cyclingTimers[idx]) {
                        clearInterval(cyclingTimers[idx]);
                        cyclingTimers[idx] = null;
                    }
                    const col = reelCols[idx];
                    if (col) {
                        col.classList.remove('slot-reel-spinning');
                        col.innerHTML = renderReelColumnHTML(targetCombo[idx] || '7');
                    }
                }, delay);
            });

            setTimeout(() => {
                cyclingTimers.forEach(t => { if (t) clearInterval(t); });
                SoundFX.stopSlotSpinAudio();
                ApiClient.finalizeSlotSpinPayout();
                isSlotSpinning = false;
                if (btn) btn.disabled = false;

                const curr = ApiClient.getState().settings.currency || '₦';
                const prizeVal = Number(outcome.prizeTier?.value || 0);
                const prizeLabel = outcome.prizeTier?.label || `${curr}${prizeVal}`;
                const comboName = outcome.prizeTier?.name || 'Winning Line';

                if (banner) {
                    banner.innerHTML = prizeVal > 0
                        ? `<span class="text-emerald-300 font-bold"><i class="fa-solid fa-trophy mr-1.5 text-royal-gold"></i>${comboName}! Credited +${curr}${prizeVal.toFixed(2)}!</span>`
                        : `<span class="text-stone-200"><i class="fa-solid fa-circle-xmark mr-1.5 text-rose-300"></i>No match this round. Pull the lever to try again!</span>`;
                }

                if (prizeVal > 0) {
                    SoundFX.playWinFanfare(prizeVal >= 500);
                    ConfettiEngine.launch();
                    openPrizeModal(
                        '777 JACKPOT SLOTS RESULT',
                        `YOU WON ${prizeLabel}!`,
                        `You hit ${comboName} on the center payline! +${curr}${prizeVal.toFixed(2)} has been credited to your wallet.`
                    );
                } else {
                    showToast('No match this spin! Try your luck again!', 'info');
                }
                syncAllViews();
            }, 2700);

        } catch (err) {
            cyclingTimers.forEach(t => { if (t) clearInterval(t); });
            ['slot-reel-col-0', 'slot-reel-col-1', 'slot-reel-col-2'].forEach(id => {
                const col = document.getElementById(id);
                if (col) {
                    col.classList.remove('slot-reel-spinning');
                    col.innerHTML = renderReelColumnHTML('7');
                }
            });
            if (audioStarted) {
                SoundFX.stopSlotSpinAudio();
            }
            isSlotSpinning = false;
            const btn = document.getElementById('btn-slot-spin');
            if (btn) btn.disabled = false;
            showToast(err.message, 'error');
            if (err.message && err.message.toLowerCase().includes('insufficient')) {
                openRechargeModal();
            } else if (!ApiClient.hasToken()) {
                switchMainView('auth');
            }
            syncAllViews();
        }
    };

    const selectMysteryBoxTier = (boxId) => {
        if (isBoxOpening) return;
        ApiClient.getState().mysteryConfig.activeBoxId = boxId;
        localStorage.setItem('lv_active_box_id', boxId);

        const wrapper = document.getElementById('mystery-svg-wrapper');
        const pop = document.getElementById('mystery-prize-pop');
        if (wrapper) wrapper.classList.remove('opened', 'shaking');
        if (pop) pop.classList.add('hidden');
        syncAllViews();
    };

    const openMysteryBox = async () => {
        if (isBoxOpening) return;
        let audioStarted = false;
        try {
            isBoxOpening = true;
            const btn = document.getElementById('btn-open-box');
            if (btn) btn.disabled = true;

            SoundFX.startMysteryBoxAudio(1250);
            audioStarted = true;

            const outcome = await ApiClient.requestMysteryBoxOpen();
            syncAllViews();

            const wrapper = document.getElementById('mystery-svg-wrapper');
            const pop = document.getElementById('mystery-prize-pop');
            const caption = document.getElementById('mystery-stage-caption');

            if (pop) pop.classList.add('hidden');
            if (wrapper) {
                wrapper.classList.remove('opened');
                wrapper.classList.add('shaking');
            }
            if (caption) {
                caption.innerHTML = `<span class="text-royal-gold font-bold animate-pulse"><i class="fa-solid fa-sparkles mr-1"></i>Unboxing ${outcome.box.name}...</span>`;
            }

            setTimeout(() => {
                SoundFX.stopMysteryBoxAudio();
                if (wrapper) {
                    wrapper.classList.remove('shaking');
                    wrapper.classList.add('opened');
                }
                ApiClient.finalizeMysteryBoxPayout();
                const curr = ApiClient.getState().settings.currency || '₦';
                const prizeVal = Number(outcome.prizeObj.value);

                if (pop) {
                    pop.textContent = `+${curr}${prizeVal.toFixed(2)} WON!`;
                    pop.classList.remove('hidden');
                }
                if (caption) {
                    caption.innerHTML = `<span class="text-emerald-300 font-bold">Unboxed <strong>${outcome.prizeObj.label}</strong> (+${curr}${prizeVal.toFixed(2)})!</span>`;
                }

                SoundFX.playWinFanfare(prizeVal >= 500);
                ConfettiEngine.launch();
                openPrizeModal('MYSTERY BOX RESULT', `YOU WON ${outcome.prizeObj.label}!`, `You unboxed ${outcome.prizeObj.label} from ${outcome.box.name}. +${curr}${prizeVal.toFixed(2)} has been credited to your wallet.`);

                isBoxOpening = false;
                if (btn) btn.disabled = false;
                syncAllViews();
            }, 1250);

        } catch (err) {
            if (audioStarted) {
                SoundFX.stopMysteryBoxAudio();
            }
            isBoxOpening = false;
            const btn = document.getElementById('btn-open-box');
            if (btn) btn.disabled = false;
            showToast(err.message, 'error');
            if (err.message.toLowerCase().includes('insufficient')) {
                openRechargeModal();
            } else if (!ApiClient.hasToken()) {
                switchMainView('auth');
            }
        }
    };

    const purchaseInvestment = async (planId) => {
        if (isPurchasingInvestment) return;
        const btnId = `btn-invest-${planId}`;
        const btn = document.getElementById(btnId);

        try {
            isPurchasingInvestment = true;
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...`;
            }

            const investment = await ApiClient.purchaseInvestmentPlan(planId);

            ConfettiEngine.launch();
            showToast(`Successfully purchased ${investment.planName}!`, 'success');
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
            if (err.message.toLowerCase().includes('insufficient')) {
                openRechargeModal();
            } else if (!ApiClient.hasToken()) {
                switchMainView('auth');
            }
        } finally {
            isPurchasingInvestment = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `Purchase Plan`; // Will be synced anyway
                syncAllViews();
            }
        }
    };

    const syncAllViews = () => {
        ensureSlotMachineDOM();
        ensureInvestmentDOM();
        ensureAdminChatDOM();
        setupPlayerChatWidget();

        const state = ApiClient.getState();
        const curr = state.settings.currency || '₦';
        const user = state.currentUser;

        // Hide/Show Chat Widget Based on View
        const chatWidget = document.getElementById('live-chat-widget');
        if (chatWidget) {
            chatWidget.style.display = currentMainView === 'admin' ? 'none' : 'flex';
        }

        const maintBanner = document.getElementById('maintenance-banner');
        if (maintBanner) {
            maintBanner.classList.toggle('hidden', !state.settings.maintenanceMode);
        }

        const regBtnText = document.getElementById('btn-register-submit-text');
        if (regBtnText) {
            const bonus = Number(state.settings.regBonus || 0);
            regBtnText.textContent = bonus > 0
                ? `CREATE ACCOUNT & CLAIM ${curr}${bonus} BONUS`
                : 'CREATE ACCOUNT';
        }

        const presetValues = [1000, 1500, 2000, 2500, 3000];
        presetValues.forEach(v => {
            const el = document.getElementById(`recharge-preset-${v}`);
            if (el) el.textContent = `${curr}${v.toLocaleString()}`;
        });

        const rechargeCustomLbl = document.getElementById('recharge-custom-amount-label');
        if (rechargeCustomLbl) rechargeCustomLbl.textContent = `Custom Amount (${curr})`;

        const rechargeAmtInput = document.getElementById('recharge-amount-input');
        if (rechargeAmtInput) {
            rechargeAmtInput.min = String(state.settings.minRecharge);
            rechargeAmtInput.max = String(state.settings.maxRecharge);
        }

        if (user) {
            const fmtBal = `${curr}${Number(user.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const hBal = document.getElementById('header-wallet-balance');
            const heroBal = document.getElementById('hero-wallet-balance');
            if (hBal) hBal.textContent = fmtBal;
            if (heroBal) heroBal.textContent = fmtBal;

            const pName = document.getElementById('player-display-name');
            const pEmail = document.getElementById('player-display-email');
            const pInit = document.getElementById('player-avatar-initials');
            if (pName) pName.textContent = user.name;
            if (pEmail) pEmail.textContent = user.email;
            if (pInit) {
                const parts = (user.name || 'LV').split(' ');
                pInit.textContent = ((parts[0]?.[0] || 'L') + (parts[1]?.[0] || 'V')).toUpperCase();
            }

            const elSpins = document.getElementById('stat-player-spins');
            const elBoxes = document.getElementById('stat-player-boxes');
            const elWon = document.getElementById('stat-player-won');
            if (elSpins) elSpins.textContent = user.spinsCount || 0;
            if (elBoxes) elBoxes.textContent = user.boxesCount || 0;
            if (elWon) elWon.textContent = `${curr}${Number(user.totalWon || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

            const wBal = document.getElementById('withdraw-available-balance');
            if (wBal) wBal.textContent = fmtBal;

            const adminPortalBtn = document.getElementById('btn-open-admin-portal');
            if (adminPortalBtn) {
                adminPortalBtn.classList.toggle('hidden', user.role !== 'admin');
            }
        }

        const spinCost = Number(state.wheelConfig.spinCost || 250);
        const wCostLbl = document.getElementById('wheel-spin-cost-label');
        const wBtnText = document.getElementById('btn-spin-now-text');
        const wMaxText = document.getElementById('wheel-max-prize-text');
        const wBadge = document.getElementById('wheel-status-badge');

        if (wCostLbl) wCostLbl.textContent = `${curr}${spinCost.toFixed(2)}`;
        if (wBtnText && !isWheelSpinning) {
            wBtnText.textContent = state.wheelConfig.available && !state.settings.maintenanceMode
                ? `SPIN NOW (${curr}${spinCost.toFixed(2)})`
                : 'PAUSED FOR MAINTENANCE';
        }
        if (wBadge) {
            const isLive = state.wheelConfig.available && !state.settings.maintenanceMode;
            wBadge.textContent = isLive ? 'LIVE GAME' : 'MAINTENANCE';
            wBadge.className = isLive
                ? 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : 'px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40';
        }

        const maxWheelPrize = Math.max(...state.wheelConfig.segments.map(s => Number(s.value)));
        if (wMaxText) wMaxText.textContent = `${curr}${maxWheelPrize.toFixed(2)}`;

        const pillsContainer = document.getElementById('wheel-prizes-pills');
        if (pillsContainer) {
            pillsContainer.innerHTML = state.wheelConfig.segments.map(s => `
                <div class="rounded-xl p-2 text-center border border-white/10 flex flex-col items-center justify-center" style="background-color: ${s.color}22; border-color: ${s.color}66;">
                    <span class="w-2.5 h-2.5 rounded-full mb-1" style="background-color: ${s.color};"></span>
                    <span class="font-display font-bold text-xs text-white">${s.label}</span>
                </div>
            `).join('');
        }

        drawFortuneWheel();

        // Sync 777 Slot Machine UI
        const slotCost = Number(state.slotConfig?.spinCost || state.wheelConfig?.spinCost || 250);
        const sCostLbl = document.getElementById('slot-spin-cost-label');
        const sBtnText = document.getElementById('btn-slot-spin-text');
        const sMaxText = document.getElementById('slot-max-prize-text');
        const sBadge = document.getElementById('slot-status-badge');
        const sPills = document.getElementById('slot-prizes-pills');

        if (sCostLbl) sCostLbl.textContent = `${curr}${slotCost.toFixed(2)}`;
        if (sBtnText && !isSlotSpinning) {
            const isSlotLive = (state.slotConfig?.available ?? true) && !state.settings.maintenanceMode;
            sBtnText.textContent = isSlotLive
                ? `PULL LEVER / SPIN (${curr}${slotCost.toFixed(2)})`
                : 'PAUSED FOR MAINTENANCE';
        }
        if (sBadge) {
            const isSlotLive = (state.slotConfig?.available ?? true) && !state.settings.maintenanceMode;
            sBadge.textContent = isSlotLive ? 'LIVE GAME' : 'MAINTENANCE';
            sBadge.className = isSlotLive
                ? 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : 'px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40';
        }
        if (sMaxText && state.slotConfig?.prizes?.length) {
            const maxSlotPrize = Math.max(...state.slotConfig.prizes.map(p => Number(p.value)));
            sMaxText.textContent = `${curr}${maxSlotPrize.toFixed(2)}`;
        }
        if (sPills && state.slotConfig?.prizes) {
            sPills.innerHTML = state.slotConfig.prizes.map(p => `
                <div class="rounded-xl p-2 text-center border border-white/10 flex flex-col items-center justify-center" style="background-color: ${p.color}22; border-color: ${p.color}66;">
                    <span class="text-[9px] text-gray-300 font-mono truncate max-w-full">${p.combo.join('-')}</span>
                    <span class="font-display font-bold text-xs text-white mt-0.5">${p.label}</span>
                </div>
            `).join('');
        }

        const activeBox = state.mysteryConfig.boxes.find(b => b.id === state.mysteryConfig.activeBoxId) || state.mysteryConfig.boxes[0];
        if (activeBox) {
            const mBadge = document.getElementById('mystery-status-badge');
            const mCostLbl = document.getElementById('mystery-open-cost-label');
            const mBtnText = document.getElementById('btn-open-box-text');
            const mBoxName = document.getElementById('mystery-active-box-name');
            const mOddsTop = document.getElementById('mystery-odds-summary');

            if (mBadge) {
                const isLive = state.mysteryConfig.available && !state.settings.maintenanceMode;
                mBadge.textContent = isLive ? 'LIVE GAME' : 'MAINTENANCE';
                mBadge.className = isLive
                    ? 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40';
            }
            if (mCostLbl) mCostLbl.textContent = `${curr}${Number(activeBox.cost).toFixed(2)}`;
            if (mBtnText && !isBoxOpening) {
                mBtnText.textContent = state.mysteryConfig.available && !state.settings.maintenanceMode
                    ? `OPEN ${activeBox.name.toUpperCase()} (${curr}${Number(activeBox.cost).toFixed(2)})`
                    : 'PAUSED FOR MAINTENANCE';
            }
            if (mBoxName) mBoxName.textContent = activeBox.name;

            const stop1 = document.getElementById('svg-box-stop1');
            const stop2 = document.getElementById('svg-box-stop2');
            const lid1 = document.getElementById('svg-lid-stop1');
            const lid2 = document.getElementById('svg-lid-stop2');
            if (stop1 && stop2 && lid1 && lid2) {
                stop1.setAttribute('stop-color', activeBox.primaryColor);
                stop2.setAttribute('stop-color', activeBox.secondaryColor);
                lid1.setAttribute('stop-color', activeBox.primaryColor);
                lid2.setAttribute('stop-color', activeBox.secondaryColor);
            }

            const selectorEl = document.getElementById('mystery-box-selector');
            if (selectorEl) {
                selectorEl.innerHTML = state.mysteryConfig.boxes.map(box => {
                    const isSel = box.id === activeBox.id;
                    return `
                        <button type="button" onclick="AppController.selectMysteryBoxTier('${box.id}')"
                            class="mystery-tier-card min-w-0 overflow-hidden p-2 sm:p-3 rounded-xl sm:rounded-2xl border text-left transition flex flex-col justify-between ${isSel ? 'bg-royal-pink/20 border-royal-pink shadow-lg' : 'bg-espresso-950/70 border-white/10 hover:border-white/25'}">
                            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 w-full min-w-0">
                                <span class="self-start text-[8px] sm:text-[10px] font-extrabold uppercase px-1.5 sm:px-2 py-0.5 rounded bg-white/10 text-royal-gold leading-tight max-w-full truncate">${box.badge}</span>
                                <span class="font-display font-extrabold text-[11px] sm:text-xs text-white whitespace-nowrap leading-tight">${curr}${Number(box.cost).toFixed(2)}</span>
                            </div>
                            <div class="font-display font-bold text-[11px] sm:text-sm text-white mt-1.5 sm:mt-2 truncate w-full">${box.name}</div>
                        </button>
                    `;
                }).join('');
            }

            const nonZeroBoxPrizes = activeBox.prizes.filter(p => Number(p.value) > 0);
            const maxBoxPrize = nonZeroBoxPrizes.length > 0 ? Math.max(...nonZeroBoxPrizes.map(p => Number(p.value))) : 5000;
            if (mOddsTop) mOddsTop.textContent = `Top Drop: ${curr}${maxBoxPrize.toFixed(2)}`;
            const prizesGrid = document.getElementById('mystery-prizes-grid');
            if (prizesGrid) {
                prizesGrid.innerHTML = nonZeroBoxPrizes.map(p => `
                    <div class="p-2.5 rounded-xl bg-espresso-950/90 border border-white/10 flex items-center justify-center text-center">
                        <span class="font-display font-extrabold text-sm text-royal-gold">${p.label}</span>
                    </div>
                `).join('');
            }
        }

        renderInvestmentPlans();

        const bank = state.settings.bankDetails || { bankName: 'N/A', accountNumber: 'N/A', accountName: 'N/A' };
        const elBName = document.getElementById('bank-transfer-bankname');
        const elBAcc = document.getElementById('bank-transfer-accountno');
        const elBHold = document.getElementById('bank-transfer-accountname');
        if (elBName) elBName.textContent = bank.bankName;
        if (elBAcc) elBAcc.textContent = bank.accountNumber;
        if (elBHold) elBHold.textContent = bank.accountName;

        renderPlayerHistory();
        if (user && user.role === 'admin') {
            renderAdminPortal();
        }
    };

    let countdownInterval = null;

    const startInvestmentCountdowns = () => {
        if (countdownInterval) clearInterval(countdownInterval);

        const updateTimers = () => {
            const elements = document.querySelectorAll('.investment-countdown');
            if (elements.length === 0) {
                if (countdownInterval) clearInterval(countdownInterval);
                return;
            }

            const now = new Date().getTime();
            elements.forEach(el => {
                const maturity = new Date(el.getAttribute('data-maturity')).getTime();
                const distance = maturity - now;

                if (distance <= 0) {
                    el.innerHTML = '<span class="text-emerald-400">Processing...</span>';
                    el.classList.remove('investment-countdown');
                } else {
                    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

                    let display = '';
                    if (days > 0) display += `${days}d `;
                    display += `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;

                    el.textContent = display;
                }
            });
        };

        updateTimers();
        countdownInterval = setInterval(updateTimers, 1000);
    };

    const renderInvestmentPlans = () => {
        const state = ApiClient.getState();
        const curr = state.settings.currency || '₦';
        const isMaint = state.settings.maintenanceMode;

        const grid = document.getElementById('invest-plans-grid');
        if (grid) {
            const activePlans = (state.investmentPlans || []).filter(p => p.isActive);
            if (activePlans.length === 0) {
                grid.innerHTML = `<div class="col-span-full py-8 text-center text-stone-400 text-sm">No investment plans are available at the moment.</div>`;
            } else {
                grid.innerHTML = activePlans.map(plan => {
                    const profitPercentage = (((plan.returnAmount - plan.cost) / plan.cost) * 100).toFixed(0);
                    const roiBadge = plan.payoutFrequency === 'Daily'
                        ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 whitespace-nowrap">${plan.dailyRoiPercentage}% Daily ROI</span>`
                        : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 whitespace-nowrap">+${profitPercentage}% ROI</span>`;

                    return `
                        <div class="bg-black/40 border border-white/10 rounded-2xl p-5 flex flex-col justify-between shadow-inner">
                            <div class="mb-4">
                                <div class="flex items-center justify-between mb-2">
                                    <h3 class="font-display font-bold text-white text-base truncate pr-2">${plan.name}</h3>
                                    ${roiBadge}
                                </div>
                                <div class="flex flex-col gap-1.5">
                                    <div class="flex justify-between items-center text-xs">
                                        <span class="text-stone-400">Invest Amount:</span>
                                        <span class="font-mono font-bold text-white">${curr}${Number(plan.cost).toFixed(2)}</span>
                                    </div>
                                    <div class="flex justify-between items-center text-xs">
                                        <span class="text-stone-400">Total Return:</span>
                                        <span class="font-mono font-bold text-royal-gold">${curr}${Number(plan.returnAmount).toFixed(2)}</span>
                                    </div>
                                    <div class="flex justify-between items-center text-xs">
                                        <span class="text-stone-400">Duration:</span>
                                        <span class="font-bold text-white">${plan.durationDays} Days</span>
                                    </div>
                                </div>
                            </div>
                            <button id="btn-invest-${plan.id}" onclick="AppController.purchaseInvestment('${plan.id}')" 
                                class="w-full py-2.5 rounded-xl btn-gold-gradient text-xs font-bold transition ${isMaint ? 'opacity-50 cursor-not-allowed' : ''}" 
                                ${isMaint ? 'disabled' : ''}>
                                ${isMaint ? 'PAUSED' : 'Purchase Plan'}
                            </button>
                        </div>
                    `;
                }).join('');
            }
        }

        const portTbody = document.getElementById('invest-portfolio-tbody');
        if (portTbody) {
            const userInvests = (state.investments || []).filter(inv => inv.userId === state.currentUser?.id);
            if (userInvests.length === 0) {
                portTbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-stone-400 text-xs">You have no active investments.</td></tr>`;
            } else {
                portTbody.innerHTML = userInvests.map(inv => {
                    const isCompleted = inv.status === 'Completed';
                    let dateContent = '';
                    if (isCompleted) {
                        dateContent = `<span class="text-emerald-400 font-bold">Completed</span>`;
                    } else if (inv.payoutFrequency === 'Daily') {
                        dateContent = `<span class="text-amber-400 font-bold">${inv.completedPayouts}/${inv.durationDays} Payouts</span>`;
                    } else {
                        dateContent = `<span class="investment-countdown font-mono text-amber-400 font-bold" data-maturity="${inv.maturityDate}">Loading...</span>`;
                    }

                    return `
                        <tr class="hover:bg-white/[0.02] transition">
                            <td class="py-3 px-3 font-semibold text-white text-xs">${inv.planName}</td>
                            <td class="py-3 px-3 font-mono text-xs text-stone-300">${curr}${Number(inv.cost).toFixed(2)}</td>
                            <td class="py-3 px-3 font-mono text-xs font-bold text-royal-gold">${curr}${Number(inv.returnAmount).toFixed(2)}</td>
                            <td class="py-3 px-3 text-xs text-stone-300">${dateContent}</td>
                            <td class="py-3 px-3 text-right">
                                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isCompleted ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border-amber-500/30'} border">
                                    ${inv.status}
                                </span>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }

        startInvestmentCountdowns();
    };

    const renderPlayerHistory = () => {
        const tbody = document.getElementById('player-history-tbody');
        if (!tbody) return;
        const state = ApiClient.getState();
        const curr = state.settings.currency || '₦';

        const filtered = state.transactions.filter(tx => {
            if (currentPlayerHistoryFilter === 'ALL') return true;
            return tx.type === currentPlayerHistoryFilter;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-stone-400 text-xs">No activity records match the selected filter.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(tx => {
            const net = Number(tx.credit) - Number(tx.cost);
            const netStr = net >= 0 ? `+${curr}${net.toFixed(2)}` : `-${curr}${Math.abs(net).toFixed(2)}`;
            const netClass = net > 0 ? 'text-emerald-400 font-bold' : (net < 0 ? 'text-rose-400' : 'text-stone-300');

            const typeBadges = {
                SPIN: `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-royal-gold/15 text-royal-gold text-xs font-semibold"><i class="fa-solid fa-dharmachakra"></i>Spin</span>`,
                SLOT: `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-300 text-xs font-semibold"><i class="fa-solid fa-coins"></i>Slot</span>`,
                BOX: `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-royal-pink/15 text-pink-300 text-xs font-semibold"><i class="fa-solid fa-gift"></i>Box</span>`,
                RECHARGE: `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 text-xs font-semibold"><i class="fa-solid fa-wallet"></i>Recharge</span>`,
                WITHDRAWAL: `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-royal-pink/15 text-pink-300 text-xs font-semibold"><i class="fa-solid fa-money-bill-transfer"></i>Withdraw</span>`,
                INVEST_BUY: `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/15 text-sky-300 text-xs font-semibold"><i class="fa-solid fa-chart-line"></i>Invest</span>`,
                INVEST_PAYOUT: `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 text-xs font-semibold"><i class="fa-solid fa-hand-holding-dollar"></i>Payout</span>`
            };

            let statusBadge;
            if (tx.status === 'Pending') {
                statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">Pending</span>`;
            } else if (tx.status === 'Rejected') {
                statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">Rejected</span>`;
            } else {
                statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">${tx.status}</span>`;
            }

            return `
                <tr class="hover:bg-white/[0.02] transition">
                    <td class="py-3.5 px-4">
                        <div class="font-semibold text-white text-xs sm:text-sm truncate max-w-[200px]">${tx.desc}</div>
                        <div class="text-[11px] font-mono text-stone-400">${tx.id} • ${tx.user}</div>
                    </td>
                    <td class="py-3.5 px-4">${typeBadges[tx.type] || tx.type}</td>
                    <td class="py-3.5 px-4 font-mono text-xs text-stone-300">${tx.cost > 0 ? `${curr}${tx.cost.toFixed(2)}` : '—'}</td>
                    <td class="py-3.5 px-4 font-mono text-xs font-bold text-royal-gold">${curr}${tx.credit.toFixed(2)}</td>
                    <td class="py-3.5 px-4 font-mono text-xs ${netClass}">${netStr}</td>
                    <td class="py-3.5 px-4">${statusBadge}</td>
                    <td class="py-3.5 px-4 text-right text-xs text-stone-400">${tx.time}</td>
                </tr>
            `;
        }).join('');
    };

    const filterPlayerHistory = (filter) => {
        currentPlayerHistoryFilter = filter;
        ['ALL', 'SPIN', 'SLOT', 'BOX', 'RECHARGE', 'WITHDRAWAL'].forEach(f => {
            const btn = document.getElementById(`phist-${f}`);
            if (!btn) return;
            btn.className = f === filter
                ? 'px-3 py-1.5 rounded-lg text-xs font-bold bg-royal-gold text-espresso-950 transition'
                : 'px-3 py-1.5 rounded-lg text-xs font-semibold text-stone-300 hover:text-white transition';
        });
        renderPlayerHistory();
    };

    const renderAdminPortal = () => {
        const state = ApiClient.getState();
        const curr = state.settings.currency || '₦';

        const totalBalances = state.users.reduce((s, u) => s + Number(u.balance), 0);
        const totalRecharges = state.transactions.filter(t => t.type === 'RECHARGE' && t.status === 'Completed').reduce((s, t) => s + Number(t.credit), 0);
        const totalGames = state.transactions.filter(t => t.type === 'SPIN' || t.type === 'BOX' || t.type === 'SLOT').length;
        const totalPrizes = state.transactions.filter(t => t.type === 'SPIN' || t.type === 'BOX' || t.type === 'SLOT').reduce((s, t) => s + Number(t.credit), 0);

        const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setTxt('akpi-users', state.users.length);
        setTxt('akpi-balances', `${curr}${totalBalances.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        setTxt('akpi-recharges', `${curr}${totalRecharges.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        setTxt('akpi-games', totalGames);
        setTxt('akpi-prizes', `${curr}${totalPrizes.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

        const wheelBars = document.getElementById('admin-overview-wheel-bars');
        if (wheelBars) {
            wheelBars.innerHTML = state.wheelConfig.segments.map(seg => `
                <div class="flex items-center gap-3 text-xs">
                    <span class="w-14 font-display font-bold text-white">${seg.label}</span>
                    <div class="flex-1 h-2.5 rounded-full bg-espresso-950 overflow-hidden">
                        <div class="h-full rounded-full" style="width: ${Math.min(100, seg.weight * 3.5)}%; background-color: ${seg.color};"></div>
                    </div>
                    <span class="w-12 text-right font-mono text-stone-400">${seg.weight}%</span>
                </div>
            `).join('');
        }

        const boxCards = document.getElementById('admin-overview-box-cards');
        if (boxCards) {
            boxCards.innerHTML = state.mysteryConfig.boxes.map(b => `
                <div class="p-3 rounded-xl bg-espresso-950 border border-white/10 flex items-center justify-between">
                    <div>
                        <div class="font-bold text-sm text-white">${b.name} <span class="ml-1.5 text-[10px] px-2 py-0.5 rounded bg-royal-pink/20 text-pink-300">${b.badge}</span></div>
                        <div class="text-xs text-stone-400">${b.prizes.length} configured prize tiers</div>
                    </div>
                    <div class="text-right">
                        <span class="block font-display font-extrabold text-royal-gold">${curr}${Number(b.cost).toFixed(2)}</span>
                        <span class="text-[10px] text-emerald-400">Active</span>
                    </div>
                </div>
            `).join('');
        }

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el && document.activeElement !== el) el.value = val;
        };
        setVal('set-currency', state.settings.currency);
        setVal('set-min-recharge', state.settings.minRecharge);
        setVal('set-max-recharge', state.settings.maxRecharge);
        setVal('set-min-withdrawal', state.settings.minWithdrawal ?? 50);
        setVal('set-reg-bonus', state.settings.regBonus);

        const bank = state.settings.bankDetails || {};
        setVal('set-bank-name', bank.bankName || '');
        setVal('set-bank-account', bank.accountNumber || '');
        setVal('set-bank-holder', bank.accountName || '');

        const maintCheck = document.getElementById('set-maintenance');
        if (maintCheck) maintCheck.checked = Boolean(state.settings.maintenanceMode);
        const confettiCheck = document.getElementById('set-confetti');
        if (confettiCheck) confettiCheck.checked = Boolean(state.settings.enableConfetti);
        const instantCheck = document.getElementById('set-instant-recharge');
        if (instantCheck) instantCheck.checked = Boolean(state.settings.instantRechargeApproval);

        renderAdminUsers();
        renderAdminWallets();
        renderAdminWithdrawals();
        renderAdminWheelEditor();
        renderAdminMysteryEditor();
        renderAdminPrizes();
        renderAdminTransactions();
        renderAdminInvestments();
    };

    const renderAdminInvestments = () => {
        const tbody = document.getElementById('admin-investments-tbody');
        if (!tbody) return;
        const state = ApiClient.getState();
        const curr = state.settings.currency || '₦';
        const plans = state.investmentPlans || [];

        if (plans.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-stone-400 text-xs">No investment plans configured.</td></tr>`;
            return;
        }

        tbody.innerHTML = plans.map(plan => {
            const profit = plan.returnAmount - plan.cost;
            const profitStr = profit >= 0 ? `+${curr}${profit.toFixed(2)}` : `-${curr}${Math.abs(profit).toFixed(2)}`;
            const profitClass = profit > 0 ? 'text-emerald-400' : 'text-rose-400';
            const isAct = plan.isActive;

            return `
                <tr class="hover:bg-white/[0.02]">
                    <td class="py-3 px-4">
                        <div class="font-bold text-white text-sm">${plan.name}</div>
                        <div class="text-[10px] font-mono text-stone-500">${plan.id} &bull; ${plan.payoutFrequency || 'Maturity'}</div>
                    </td>
                    <td class="py-3 px-4 font-mono text-xs text-white">${curr}${Number(plan.cost).toFixed(2)}</td>
                    <td class="py-3 px-4">
                        <div class="font-mono text-xs font-bold text-royal-gold">${curr}${Number(plan.returnAmount).toFixed(2)}</div>
                        <div class="text-[10px] font-bold ${profitClass}">${profitStr}</div>
                    </td>
                    <td class="py-3 px-4 text-xs text-stone-300">${plan.durationDays} Days</td>
                    <td class="py-3 px-4">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isAct ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'}">
                            ${isAct ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td class="py-3 px-4 text-right space-x-1.5">
                        <button onclick="AppController.editAdminInvestPlan('${plan.id}')" class="px-2.5 py-1 rounded bg-espresso-800 hover:bg-espresso-700 text-royal-gold border border-royal-gold/30 text-xs font-semibold">Edit</button>
                        <button onclick="AppController.deleteAdminInvestPlan('${plan.id}')" class="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-semibold"><i class="fa-solid fa-trash-can"></i></button>
                    </td>
                </tr>
            `;
        }).join('');
    };

    const showAdminInvestForm = () => {
        const form = document.getElementById('admin-invest-form-container');
        if (form) form.classList.remove('hidden');
        document.getElementById('admin-invest-id').value = '';
        document.getElementById('admin-invest-name').value = '';
        document.getElementById('admin-invest-cost').value = '';
        document.getElementById('admin-invest-frequency').value = 'Maturity';
        document.getElementById('admin-invest-roi').value = '0';
        document.getElementById('admin-invest-return').value = '';
        document.getElementById('admin-invest-duration').value = '';
        document.getElementById('admin-invest-form-title').textContent = 'Create Investment Plan';
    };

    const hideAdminInvestForm = () => {
        const form = document.getElementById('admin-invest-form-container');
        if (form) form.classList.add('hidden');
    };

    const editAdminInvestPlan = (planId) => {
        const state = ApiClient.getState();
        const plan = (state.investmentPlans || []).find(p => p.id === planId);
        if (!plan) return;

        showAdminInvestForm();
        document.getElementById('admin-invest-form-title').textContent = 'Edit Investment Plan';
        document.getElementById('admin-invest-id').value = plan.id;
        document.getElementById('admin-invest-name').value = plan.name;
        document.getElementById('admin-invest-cost').value = plan.cost;
        document.getElementById('admin-invest-frequency').value = plan.payoutFrequency || 'Maturity';
        document.getElementById('admin-invest-roi').value = plan.dailyRoiPercentage || 0;
        document.getElementById('admin-invest-return').value = plan.returnAmount;
        document.getElementById('admin-invest-duration').value = plan.durationDays;
    };

    const saveAdminInvestPlan = async () => {
        const planId = document.getElementById('admin-invest-id').value;
        const name = document.getElementById('admin-invest-name').value;
        const cost = document.getElementById('admin-invest-cost').value;
        const payoutFrequency = document.getElementById('admin-invest-frequency').value;
        const dailyRoiPercentage = document.getElementById('admin-invest-roi').value;
        const returnAmount = document.getElementById('admin-invest-return').value;
        const durationDays = document.getElementById('admin-invest-duration').value;

        if (!name || !cost || !returnAmount || !durationDays) {
            showToast('Please fill out all fields.', 'error');
            return;
        }

        const payload = {
            name,
            cost: Number(cost),
            payoutFrequency,
            dailyRoiPercentage: Number(dailyRoiPercentage),
            returnAmount: Number(returnAmount),
            durationDays: Number(durationDays),
            isActive: true
        };

        try {
            if (planId) {
                await ApiClient.adminUpdateInvestmentPlan(planId, payload);
                showToast(`Plan ${name} updated successfully.`, 'success');
            } else {
                await ApiClient.adminCreateInvestmentPlan(payload);
                showToast(`Plan ${name} created successfully.`, 'success');
            }
            hideAdminInvestForm();
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const deleteAdminInvestPlan = async (planId) => {
        if (!confirm('Are you sure you want to delete this plan? Active investments will prevent deletion.')) return;
        try {
            await ApiClient.adminDeleteInvestmentPlan(planId);
            showToast('Investment plan deleted successfully.', 'success');
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };


    const renderAdminUsers = () => {
        const tbody = document.getElementById('admin-users-tbody');
        if (!tbody) return;
        const state = ApiClient.getState();
        const curr = state.settings.currency || '₦';
        const query = (document.getElementById('admin-user-search')?.value || '').toLowerCase();

        const list = state.users.filter(u =>
            u.name.toLowerCase().includes(query) ||
            u.email.toLowerCase().includes(query) ||
            u.phone.toLowerCase().includes(query)
        );

        tbody.innerHTML = list.map(u => {
            const isAct = u.status === 'Active';
            return `
                <tr class="hover:bg-white/[0.02]">
                    <td class="py-3.5 px-4">
                        <div class="font-bold text-white">${u.name} ${u.role === 'admin' ? '<span class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-royal-gold/20 text-royal-gold">ADMIN</span>' : ''}</div>
                        <div class="text-xs text-stone-400">${u.email} • <span class="font-mono">${u.id}</span></div>
                    </td>
                    <td class="py-3.5 px-4 text-xs text-stone-300 font-mono">${u.phone}</td>
                    <td class="py-3.5 px-4 font-display font-bold text-royal-gold">${curr}${Number(u.balance).toFixed(2)}</td>
                    <td class="py-3.5 px-4 text-xs text-stone-300">${u.games || 0} rounds</td>
                    <td class="py-3.5 px-4">
                        <span class="px-2.5 py-1 rounded-full text-xs font-bold ${isAct ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'}">
                            ${u.status}
                        </span>
                    </td>
                    <td class="py-3.5 px-4 text-right space-x-1.5">
                        <button onclick="AppController.adminCreditUser('${u.id}', 1000)" class="px-2.5 py-1 rounded-lg bg-espresso-800 hover:bg-espresso-700 text-royal-gold border border-royal-gold/30 text-xs font-semibold">+${curr}1000</button>
                        <button onclick="AppController.adminToggleUserStatus('${u.id}')" class="px-2.5 py-1 rounded-lg bg-espresso-800 hover:bg-espresso-700 text-stone-200 border border-white/10 text-xs font-semibold">
                            ${isAct ? 'Suspend' : 'Activate'}
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    };

    const renderAdminWallets = () => {
        const tbody = document.getElementById('admin-wallets-tbody');
        if (!tbody) return;
        const state = ApiClient.getState();
        const curr = state.settings.currency || '₦';
        const recharges = state.transactions.filter(t => t.type === 'RECHARGE');

        if (recharges.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-stone-400 text-xs">No recharge records found.</td></tr>`;
            return;
        }

        tbody.innerHTML = recharges.map(tx => {
            const isPending = tx.status === 'Pending';
            return `
                <tr class="hover:bg-white/[0.02]">
                    <td class="py-3.5 px-4 font-mono text-xs text-stone-300">${tx.id}</td>
                    <td class="py-3.5 px-4 font-semibold text-white">${tx.user}</td>
                    <td class="py-3.5 px-4 font-display font-bold text-emerald-400">+${curr}${tx.credit.toFixed(2)}</td>
                    <td class="py-3.5 px-4 text-xs text-stone-300">${tx.desc}</td>
                    <td class="py-3.5 px-4">
                        <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${isPending ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}">${tx.status}</span>
                    </td>
                    <td class="py-3.5 px-4 text-xs text-stone-400">${tx.time}</td>
                    <td class="py-3.5 px-4 text-right">
                        ${isPending
                    ? `<button onclick="AppController.adminApproveRecharge('${tx.id}')" class="px-3 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold">Approve &amp; Credit</button>`
                    : `<span class="text-xs text-stone-500">Verified</span>`}
                    </td>
                </tr>
            `;
        }).join('');
    };

    const renderAdminWithdrawals = () => {
        const tbody = document.getElementById('admin-withdrawals-tbody');
        if (!tbody) return;
        const state = ApiClient.getState();
        const curr = state.settings.currency || '₦';
        const withdrawals = state.transactions.filter(t => t.type === 'WITHDRAWAL');

        if (withdrawals.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-stone-400 text-xs">No withdrawal requests found.</td></tr>`;
            return;
        }

        tbody.innerHTML = withdrawals.map(tx => {
            const isPending = tx.status === 'Pending';
            let statusBadge;
            if (isPending) {
                statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">${tx.status}</span>`;
            } else if (tx.status === 'Rejected') {
                statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">${tx.status}</span>`;
            } else {
                statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">${tx.status}</span>`;
            }
            return `
                <tr class="hover:bg-white/[0.02]">
                    <td class="py-3.5 px-4 font-mono text-xs text-stone-300">${tx.id}</td>
                    <td class="py-3.5 px-4 font-semibold text-white">${tx.user}</td>
                    <td class="py-3.5 px-4 font-display font-bold text-royal-pink">-${curr}${tx.cost.toFixed(2)}</td>
                    <td class="py-3.5 px-4 text-xs text-stone-300 max-w-xs truncate">${tx.desc}</td>
                    <td class="py-3.5 px-4">${statusBadge}</td>
                    <td class="py-3.5 px-4 text-xs text-stone-400">${tx.time}</td>
                    <td class="py-3.5 px-4 text-right space-x-1.5">
                        ${isPending
                    ? `<button onclick="AppController.adminApproveWithdrawal('${tx.id}')" class="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold">Approve</button>
                               <button onclick="AppController.adminRejectWithdrawal('${tx.id}')" class="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold">Reject</button>`
                    : `<span class="text-xs text-stone-500">Processed</span>`}
                    </td>
                </tr>
            `;
        }).join('');
    };

    const renderAdminWheelEditor = () => {
        const state = ApiClient.getState();
        const costInput = document.getElementById('admin-wheel-cost-input');
        if (costInput && document.activeElement !== costInput) {
            costInput.value = state.wheelConfig.spinCost;
        }

        const availBtn = document.getElementById('admin-wheel-avail-btn');
        if (availBtn) {
            const avail = state.wheelConfig.available;
            availBtn.textContent = avail ? 'Game Status: ACTIVE (Click to Pause)' : 'Game Status: PAUSED (Click to Enable)';
            availBtn.className = avail
                ? 'px-4 py-2.5 rounded-xl font-bold text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'px-4 py-2.5 rounded-xl font-bold text-xs bg-rose-500/20 text-rose-300 border border-rose-500/40';
        }

        const tbody = document.getElementById('admin-wheel-segments-tbody');
        if (!tbody) return;
        tbody.innerHTML = state.wheelConfig.segments.map((seg, idx) => `
            <tr>
                <td class="py-2.5 px-4 font-mono text-xs text-stone-400">Segment #${idx + 1}</td>
                <td class="py-2.5 px-4">
                    <input type="text" id="wseg-label-${idx}" value="${seg.label}" class="w-24 px-2.5 py-1.5 rounded-lg bg-espresso-950 border border-white/15 text-xs text-white font-bold">
                </td>
                <td class="py-2.5 px-4">
                    <input type="number" step="50" id="wseg-val-${idx}" value="${seg.value}" class="w-24 px-2.5 py-1.5 rounded-lg bg-espresso-950 border border-white/15 text-xs text-royal-gold font-mono">
                </td>
                <td class="py-2.5 px-4 flex items-center gap-2">
                    <input type="color" id="wseg-col-${idx}" value="${seg.color}" class="w-8 h-8 rounded cursor-pointer bg-transparent border-0">
                    <span class="font-mono text-xs text-stone-400">${seg.color}</span>
                </td>
                <td class="py-2.5 px-4">
                    <input type="number" min="1" max="100" id="wseg-weight-${idx}" value="${seg.weight}" class="w-20 px-2.5 py-1.5 rounded-lg bg-espresso-950 border border-white/15 text-xs text-white font-mono">
                </td>
            </tr>
        `).join('');
    };

    const renderAdminMysteryEditor = () => {
        const state = ApiClient.getState();
        const curr = state.settings.currency || '₦';
        const availBtn = document.getElementById('admin-mystery-avail-btn');
        if (availBtn) {
            const avail = state.mysteryConfig.available;
            availBtn.textContent = avail ? 'Mystery Boxes: ACTIVE (Click to Pause)' : 'Mystery Boxes: PAUSED (Click to Enable)';
            availBtn.className = avail
                ? 'px-4 py-2.5 rounded-xl font-bold text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'px-4 py-2.5 rounded-xl font-bold text-xs bg-rose-500/20 text-rose-300 border border-rose-500/40';
        }

        const listEl = document.getElementById('admin-mystery-boxes-list');
        if (!listEl) return;
        listEl.innerHTML = state.mysteryConfig.boxes.map((box, bIdx) => `
            <div class="vault-card rounded-2xl p-5 flex flex-col justify-between space-y-4">
                <div class="space-y-3">
                    <div class="flex items-center justify-between">
                        <span class="text-[10px] font-bold uppercase px-2.5 py-1 rounded bg-royal-pink/20 text-pink-300">${box.badge}</span>
                        <span class="font-mono text-xs text-stone-400">${box.id}</span>
                    </div>
                    <div>
                        <label class="block text-[11px] uppercase text-stone-400 mb-1">Box Name</label>
                        <input type="text" id="mbox-name-${bIdx}" value="${box.name}" class="w-full px-3 py-2 rounded-xl bg-espresso-950 border border-white/15 text-sm font-bold text-white">
                    </div>
                    <div>
                        <label class="block text-[11px] uppercase text-stone-400 mb-1">Opening Cost (${curr})</label>
                        <input type="number" step="50" min="200" id="mbox-cost-${bIdx}" value="${box.cost}" class="w-full px-3 py-2 rounded-xl bg-espresso-950 border border-white/15 text-sm font-mono text-royal-gold">
                    </div>
                    <div class="space-y-1.5 pt-2">
                        <span class="block text-[11px] uppercase text-stone-400">Configured Prize Drops (${curr}, No ${curr}0) &amp; Odds (%)</span>
                        ${box.prizes.map((p, pIdx) => `
                            <div class="grid grid-cols-12 gap-1.5 items-center">
                                <input type="text" id="mbox-plbl-${bIdx}-${pIdx}" value="${p.label}" class="col-span-5 px-2 py-1 rounded bg-espresso-950 border border-white/10 text-xs text-white">
                                <input type="number" step="50" min="50" id="mbox-pval-${bIdx}-${pIdx}" value="${p.value}" class="col-span-3 px-2 py-1 rounded bg-espresso-950 border border-white/10 text-xs font-mono text-royal-gold">
                                <input type="text" id="mbox-podds-${bIdx}-${pIdx}" value="${p.odds}" class="col-span-4 px-2 py-1 rounded bg-espresso-950 border border-white/10 text-xs font-mono text-stone-300 text-right">
                            </div>
                        `).join('')}
                    </div>
                </div>
                <button onclick="AppController.saveMysteryBoxFromAdmin(${bIdx})" class="w-full py-2.5 rounded-xl btn-pink-gradient text-xs font-extrabold uppercase tracking-wider">
                    Update ${box.name}
                </button>
            </div>
        `).join('');
    };

    const renderAdminPrizes = () => {
        const tbody = document.getElementById('admin-prizes-tbody');
        if (!tbody) return;
        const state = ApiClient.getState();
        const curr = state.settings.currency || '₦';
        const wins = state.transactions.filter(t => t.type === 'SPIN' || t.type === 'BOX' || t.type === 'SLOT');
        tbody.innerHTML = wins.map(tx => `
            <tr class="hover:bg-white/[0.02]">
                <td class="py-3.5 px-4 font-mono text-xs text-stone-400">${tx.id}</td>
                <td class="py-3.5 px-4 font-semibold text-white">${tx.user}</td>
                <td class="py-3.5 px-4 text-xs text-stone-300">${tx.desc}</td>
                <td class="py-3.5 px-4 font-mono text-xs text-stone-400">${curr}${tx.cost.toFixed(2)}</td>
                <td class="py-3.5 px-4 font-display font-bold text-royal-gold">${curr}${tx.credit.toFixed(2)}</td>
                <td class="py-3.5 px-4">
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${tx.status === 'Flagged' ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'}">${tx.status}</span>
                </td>
                <td class="py-3.5 px-4 text-right">
                    <button onclick="AppController.adminTogglePrizeStatus('${tx.id}')" class="px-2.5 py-1 rounded-lg bg-espresso-800 hover:bg-espresso-700 text-xs text-stone-200 border border-white/10">
                        ${tx.status === 'Flagged' ? 'Mark Credited' : 'Flag Review'}
                    </button>
                </td>
            </tr>
        `).join('');
    };

    const renderAdminTransactions = () => {
        const tbody = document.getElementById('admin-tx-tbody');
        if (!tbody) return;
        const state = ApiClient.getState();
        const curr = state.settings.currency || '₦';
        const q = (document.getElementById('admin-tx-search')?.value || '').toLowerCase();
        const typeFilter = document.getElementById('admin-tx-filter')?.value || 'ALL';

        const list = state.transactions.filter(tx => {
            const matchesType = typeFilter === 'ALL' || tx.type === typeFilter;
            const matchesQ = tx.id.toLowerCase().includes(q) || tx.user.toLowerCase().includes(q) || tx.desc.toLowerCase().includes(q);
            return matchesType && matchesQ;
        });

        tbody.innerHTML = list.map(tx => `
            <tr class="hover:bg-white/[0.02]">
                <td class="py-3 px-4 font-mono text-xs text-stone-400">${tx.id}</td>
                <td class="py-3 px-4 font-semibold text-white text-xs">${tx.user}</td>
                <td class="py-3 px-4 text-xs font-bold text-royal-gold">${tx.type}</td>
                <td class="py-3 px-4 text-xs text-stone-300">${tx.desc}</td>
                <td class="py-3 px-4 font-mono text-xs text-stone-400">${curr}${tx.cost.toFixed(2)}</td>
                <td class="py-3 px-4 font-mono text-xs font-bold text-emerald-400">${curr}${tx.credit.toFixed(2)}</td>
                <td class="py-3 px-4 text-xs text-stone-300">${tx.status}</td>
                <td class="py-3 px-4 text-right text-xs text-stone-400">${tx.time}</td>
            </tr>
        `).join('');
    };

    const formatMessageTime = (dateStr) => {
        const d = new Date(dateStr);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const renderChatMessages = (containerId, messages, viewerRole) => {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (messages.length === 0) {
            container.innerHTML = `<div class="text-center text-xs text-gray-500 mt-4">No messages yet. Send a message to start the conversation!</div>`;
            return;
        }

        const currentMsgCount = container.dataset.msgCount || 0;

        container.innerHTML = messages.map(msg => {
            const isMine = msg.senderRole === viewerRole;
            const safeMsg = msg.message.replace(/</g, "&lt;").replace(/>/g, "&gt;");

            if (isMine) {
                return `
                    <div class="flex items-start gap-2.5 justify-end">
                        <div class="flex flex-col items-end">
                            <div class="bg-royal-gold border border-yellow-400 rounded-2xl rounded-tr-sm p-3 text-xs text-espresso-950 font-medium max-w-[80%] leading-relaxed shadow-md mb-1 break-words">
                                ${safeMsg}
                            </div>
                            <span class="text-[9px] text-gray-500">${formatMessageTime(msg.createdAt)}</span>
                        </div>
                    </div>
                `;
            } else {
                const avatar = msg.senderRole === 'admin'
                    ? `<div class="w-7 h-7 rounded-full bg-royal-gold/20 flex items-center justify-center shrink-0 border border-royal-gold/30 shadow-inner"><i class="fa-solid fa-user-tie text-[10px] text-royal-gold"></i></div>`
                    : `<div class="w-7 h-7 rounded-full bg-espresso-800 flex items-center justify-center shrink-0 border border-white/10 shadow-inner"><i class="fa-solid fa-user text-[10px] ${msg.senderRole === 'guest' ? 'text-royal-pink' : 'text-stone-400'}"></i></div>`;
                const roleSuffix = msg.senderRole === 'guest' ? ' <span class="text-royal-pink font-semibold">GUEST</span>' : '';

                return `
                    <div class="flex items-start gap-2.5">
                        ${avatar}
                        <div class="flex flex-col items-start">
                            <div class="bg-espresso-800 border border-white/10 rounded-2xl rounded-tl-sm p-3 text-xs text-gray-200 max-w-[80%] leading-relaxed shadow-md mb-1 break-words">
                                ${safeMsg}
                            </div>
                            <span class="text-[9px] text-gray-500">${msg.senderName}${roleSuffix} • ${formatMessageTime(msg.createdAt)}</span>
                        </div>
                    </div>
                `;
            }
        }).join('');

        if (messages.length > currentMsgCount) {
            container.scrollTop = container.scrollHeight;
            container.dataset.msgCount = messages.length;
        }
    };

    const loadPlayerChat = async () => {
        const formView = document.getElementById('chat-guest-form-view');
        const mainView = document.getElementById('chat-main-view');

        // No identity yet → show onboarding form
        if (!ApiClient.hasToken() && !ApiClient.hasGuestToken()) {
            if (formView) formView.style.display = 'flex';
            if (mainView) mainView.style.display = 'none';
            return;
        }

        try {
            if (ApiClient.hasToken()) {
                const msgs = await ApiClient.fetchChatMessages();
                renderChatMessages('player-chat-body', msgs, 'player');
                await ApiClient.markChatRead();
            } else {
                const msgs = await ApiClient.fetchGuestMessages();
                renderChatMessages('player-chat-body', msgs, 'guest');
                await ApiClient.markGuestRead();
            }
            if (formView) formView.style.display = 'none';
            if (mainView) mainView.style.display = 'flex';
        } catch (err) {
            if (!ApiClient.hasToken() && ApiClient.hasGuestToken()) {
                ApiClient.clearGuestSession();
                if (formView) formView.style.display = 'flex';
                if (mainView) mainView.style.display = 'none';
            }
        }
    };

    const sendPlayerChatMessage = async () => {
        const input = document.getElementById('player-chat-input');
        if (!input || !input.value.trim()) return;

        if (!ApiClient.hasToken() && !ApiClient.hasGuestToken()) {
            showToast('Please share your details to start chatting.', 'error');
            return;
        }

        const msg = input.value.trim();
        input.value = '';
        try {
            if (ApiClient.hasToken()) await ApiClient.sendChatMessage(msg);
            else await ApiClient.sendGuestMessage(msg);
            await loadPlayerChat();
        } catch (e) {
            showToast(e.message, 'error');
        }
    };

    const handleGuestChatSubmit = async (e) => {
        if (e) e.preventDefault();
        const nameInput = document.getElementById('guest-chat-name');
        const emailInput = document.getElementById('guest-chat-email');
        const errName = document.getElementById('err-guest-name');
        const errEmail = document.getElementById('err-guest-email');
        const btn = document.getElementById('btn-guest-chat-start');

        const name = (nameInput?.value || '').trim();
        const email = (emailInput?.value || '').trim();
        let ok = true;

        if (!name) {
            if (errName) { errName.textContent = 'Please enter your full name.'; errName.classList.remove('hidden'); }
            ok = false;
        } else if (errName) errName.classList.add('hidden');

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            if (errEmail) { errEmail.textContent = 'Please enter a valid email address.'; errEmail.classList.remove('hidden'); }
            ok = false;
        } else if (errEmail) errEmail.classList.add('hidden');

        if (!ok) return;

        try {
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Starting...'; }
            await ApiClient.initGuestChat(name, email);
            showToast('Chat started! Our team will respond shortly.', 'success');
            await loadPlayerChat();
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-paper-plane text-xs"></i><span>Start Chat</span>';
            }
        }
    };

    const loadAdminChatSessions = async () => {
        const sessions = await ApiClient.fetchAdminChatSessions();
        const list = document.getElementById('admin-chat-sessions-list');
        if (!list) return;
        if (sessions.length === 0) {
            list.innerHTML = `<div class="text-center text-xs text-gray-500 p-4">No active conversations.</div>`;
            return;
        }
        list.innerHTML = sessions.map((s) => {
            const isSelected = ApiClient.getState().activeAdminChatUserId === s.userId;
            const guestBadge = s.isGuest
                ? '<span class="ml-1 text-[8px] px-1.5 py-0.5 rounded bg-royal-pink/20 text-pink-300 border border-royal-pink/30 align-middle">GUEST</span>'
                : '';
            return `
                <button onclick="AppController.selectAdminChatSession('${s.userId}', '${s.userName.replace(/'/g, "\\'")}')"
                    class="w-full text-left p-3 rounded-xl transition ${isSelected ? 'bg-royal-gold/10 border border-royal-gold/30' : 'hover:bg-white/5 border border-transparent'} flex items-center justify-between">
                    <div class="overflow-hidden pr-2">
                        <div class="font-bold text-xs text-white truncate">${s.userName}${guestBadge}</div>
                        <div class="text-[10px] text-gray-400 truncate mt-0.5">${s.userEmail || s.lastMessage || ''}</div>
                    </div>
                    ${s.unreadCount > 0 ? `<div class="w-5 h-5 rounded-full bg-rose-500 flex items-center justify-center text-[10px] font-bold text-white shrink-0 shadow-lg">${s.unreadCount}</div>` : ''}
                </button>
            `;
        }).join('');
    };

    const selectAdminChatSession = async (userId, userName) => {
        ApiClient.getState().activeAdminChatUserId = userId;
        const header = document.getElementById('admin-chat-header');
        const input = document.getElementById('admin-chat-input');
        const btn = document.getElementById('btn-admin-chat-send');
        const session = (ApiClient.getState().adminChatSessions || []).find((s) => s.userId === userId);

        if (header) {
            const guestBadge = session?.isGuest
                ? '<span class="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-royal-pink/20 text-pink-300">GUEST</span>'
                : '';
            header.innerHTML = `
                <div class="flex flex-col">
                    <span class="font-bold text-sm text-white">${userName}${guestBadge}</span>
                    ${session?.userEmail ? `<span class="text-[10px] text-gray-400">${session.userEmail}</span>` : ''}
                </div>`;
        }

        if (input) { input.disabled = false; input.classList.add('chat-input-field'); }
        if (btn) btn.disabled = false;

        await loadAdminChatMessages();
        await loadAdminChatSessions();
    };

    const loadAdminChatMessages = async () => {
        const userId = ApiClient.getState().activeAdminChatUserId;
        if (!userId) return;
        const msgs = await ApiClient.fetchChatMessages(userId);
        renderChatMessages('admin-chat-body', msgs, 'admin');
        await ApiClient.markChatRead(userId);
    };

    const sendAdminChatMessage = async () => {
        const userId = ApiClient.getState().activeAdminChatUserId;
        if (!userId) return;
        const input = document.getElementById('admin-chat-input');
        if (!input || !input.value.trim()) return;
        const msg = input.value.trim();
        input.value = '';
        try {
            await ApiClient.sendChatMessage(msg, userId);
            await loadAdminChatMessages();
            await loadAdminChatSessions();
        } catch (e) {
            showToast(e.message, 'error');
        }
    };

    const startChatPolling = () => {
        if (chatPollInterval) clearInterval(chatPollInterval);
        chatPollInterval = setInterval(async () => {
            const hasIdentity = ApiClient.hasToken() || ApiClient.hasGuestToken();
            const state = ApiClient.getState();

            if (state.currentUser?.role === 'admin' && currentMainView === 'admin') {
                const adminTabChat = document.getElementById('admin-tab-chat');
                if (adminTabChat && !adminTabChat.classList.contains('hidden')) {
                    await loadAdminChatSessions();
                    if (state.activeAdminChatUserId) await loadAdminChatMessages();
                }
            }

            const win = document.getElementById('live-chat-window');
            const formView = document.getElementById('chat-guest-form-view');
            const isFormVisible = formView && formView.style.display === 'flex';

            if (hasIdentity && win && !win.classList.contains('hidden') && !isFormVisible) {
                try { await loadPlayerChat(); } catch (_) { }
            }
        }, 3000);
    };

    const switchMainView = (view) => {
        const user = ApiClient.getState().currentUser;
        if ((view === 'player' || view === 'admin') && !user) {
            view = 'auth';
        }
        if (view === 'admin' && (!user || user.role !== 'admin')) {
            showToast('Administrator privileges required.', 'error');
            view = 'player';
        }

        currentMainView = view;
        ['auth', 'player', 'admin'].forEach(v => {
            const sec = document.getElementById(`view-${v}`);
            if (sec) sec.classList.toggle('hidden', v !== view);
        });

        SoundFX.setBackgroundActive(view === 'player');
        syncAllViews();
    };

    const switchPlayerSection = (sec) => {
        ensureSlotMachineDOM();
        ensureInvestmentDOM();

        ['all', 'wheel', 'mystery', 'slot', 'history', 'invest'].forEach(k => {
            const btn = document.getElementById(`pnav-${k}`);
            if (btn) {
                btn.className = k === sec
                    ? 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition flex items-center gap-2 bg-espresso-800 text-royal-gold border border-royal-gold/30 shadow-[0_0_10px_rgba(255,215,0,0.1)] whitespace-nowrap'
                    : 'px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition flex items-center gap-2 text-stone-300 hover:text-white whitespace-nowrap';
            }
        });

        const wheelSec = document.getElementById('player-sec-wheel');
        const mysterySec = document.getElementById('player-sec-mystery');
        const slotSec = document.getElementById('player-sec-slot');
        const historySec = document.getElementById('player-sec-history');
        const investSec = document.getElementById('player-sec-invest');
        const arenaGrid = document.getElementById('games-arena-grid');

        if (sec === 'all') {
            arenaGrid.classList.remove('hidden');
            wheelSec.classList.remove('hidden', 'xl:col-span-12');
            wheelSec.classList.add('xl:col-span-6');
            mysterySec.classList.remove('hidden', 'xl:col-span-12');
            mysterySec.classList.add('xl:col-span-6');
            if (slotSec) {
                slotSec.classList.remove('hidden');
                slotSec.classList.add('xl:col-span-12');
            }
            if (historySec) historySec.classList.add('hidden');
            if (investSec) investSec.classList.add('hidden');
        } else if (sec === 'invest') {
            arenaGrid.classList.remove('hidden');
            if (historySec) historySec.classList.add('hidden');
            if (investSec) {
                investSec.classList.remove('hidden');
                investSec.classList.add('xl:col-span-12');
            }
            wheelSec.classList.add('hidden');
            mysterySec.classList.add('hidden');
            if (slotSec) slotSec.classList.add('hidden');
        } else if (sec === 'wheel') {
            arenaGrid.classList.remove('hidden');
            wheelSec.classList.remove('hidden', 'xl:col-span-6');
            wheelSec.classList.add('xl:col-span-12');
            mysterySec.classList.add('hidden');
            if (slotSec) slotSec.classList.add('hidden');
            if (historySec) historySec.classList.add('hidden');
            if (investSec) investSec.classList.add('hidden');
        } else if (sec === 'mystery') {
            arenaGrid.classList.remove('hidden');
            mysterySec.classList.remove('hidden', 'xl:col-span-6');
            mysterySec.classList.add('xl:col-span-12');
            wheelSec.classList.add('hidden');
            if (slotSec) slotSec.classList.add('hidden');
            if (historySec) historySec.classList.add('hidden');
            if (investSec) investSec.classList.add('hidden');
        } else if (sec === 'slot') {
            arenaGrid.classList.remove('hidden');
            if (slotSec) {
                slotSec.classList.remove('hidden');
                slotSec.classList.add('xl:col-span-12');
            }
            wheelSec.classList.add('hidden');
            mysterySec.classList.add('hidden');
            if (historySec) historySec.classList.add('hidden');
            if (investSec) investSec.classList.add('hidden');
        } else if (sec === 'history') {
            arenaGrid.classList.add('hidden');
            if (historySec) historySec.classList.remove('hidden');
            if (investSec) investSec.classList.add('hidden');
        }
        drawFortuneWheel();
    };

    const switchAdminTab = (tab) => {
        ensureInvestmentDOM();
        ensureAdminChatDOM();
        const tabs = ['overview', 'users', 'wallets', 'withdrawals', 'wheel', 'mystery', 'prizes', 'transactions', 'settings', 'investments', 'chat'];
        tabs.forEach(t => {
            const sec = document.getElementById(`admin-tab-${t}`);
            const btn = document.getElementById(`anav-${t}`);
            if (sec) sec.classList.toggle('hidden', t !== tab);
            if (btn) {
                if (t === tab) {
                    btn.classList.add('bg-royal-gold', 'text-espresso-950', 'shadow');
                    btn.classList.remove('text-stone-300', 'hover:bg-espresso-800');
                } else {
                    btn.classList.remove('bg-royal-gold', 'text-espresso-950', 'shadow');
                    btn.classList.add('text-stone-300', 'hover:bg-espresso-800');
                }
            }
        });
        syncAllViews();
        if (tab === 'chat') {
            loadAdminChatSessions().catch(() => { });
        }
    };

    const switchAuthTab = (tab) => {
        const isLogin = tab === 'login';
        document.getElementById('form-login').classList.toggle('hidden', !isLogin);
        document.getElementById('form-register').classList.toggle('hidden', isLogin);
        document.getElementById('auth-feedback-box').classList.add('hidden');

        document.getElementById('tab-btn-login').className = isLogin
            ? 'flex-1 py-2.5 rounded-xl font-display font-bold text-sm transition-all bg-royal-gold text-espresso-950 shadow'
            : 'flex-1 py-2.5 rounded-xl font-display font-bold text-sm transition-all text-stone-400 hover:text-white';
        document.getElementById('tab-btn-register').className = !isLogin
            ? 'flex-1 py-2.5 rounded-xl font-display font-bold text-sm transition-all bg-royal-pink text-white shadow'
            : 'flex-1 py-2.5 rounded-xl font-display font-bold text-sm transition-all text-stone-400 hover:text-white';
    };

    const togglePasswordVisibility = (inputId, iconId) => {
        const inp = document.getElementById(inputId);
        const ico = document.getElementById(iconId);
        if (!inp || !ico) return;
        if (inp.type === 'password') {
            inp.type = 'text';
            ico.className = 'fa-solid fa-eye-slash text-royal-gold';
        } else {
            inp.type = 'password';
            ico.className = 'fa-solid fa-eye';
        }
    };

    const updatePasswordStrength = (val) => {
        const b1 = document.getElementById('pw-bar-1');
        const b2 = document.getElementById('pw-bar-2');
        const b3 = document.getElementById('pw-bar-3');
        const txt = document.getElementById('pw-strength-text');
        if (!b1) return;

        let score = 0;
        if (val.length >= 6) score++;
        if (val.length >= 8 && /[0-9]/.test(val)) score++;
        if (val.length >= 10 && /[^A-Za-z0-9]/.test(val)) score++;

        b1.className = `h-1 flex-1 rounded-full ${score >= 1 ? 'bg-rose-400' : 'bg-white/10'}`;
        b2.className = `h-1 flex-1 rounded-full ${score >= 2 ? 'bg-amber-400' : 'bg-white/10'}`;
        b3.className = `h-1 flex-1 rounded-full ${score >= 3 ? 'bg-emerald-400' : 'bg-white/10'}`;
        txt.textContent = score === 0 ? 'Weak' : (score === 1 ? 'Fair' : (score === 2 ? 'Good' : 'Strong'));
    };

    const handleLoginSubmit = async (e) => {
        e.preventDefault();
        const idVal = document.getElementById('login-identifier').value.trim();
        const pwVal = document.getElementById('login-password').value;
        const btn = document.getElementById('btn-login-submit');

        if (!idVal || !pwVal) {
            showToast('Please enter your email/phone and password.', 'error');
            return;
        }

        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><span>SIGNING IN...</span>`;
        try {
            const res = await ApiClient.authenticateUser(idVal, pwVal);
            showToast(`Welcome back, ${res.user.name}!`, 'success');
            switchMainView(res.redirectRole === 'admin' ? 'admin' : 'player');
        } catch (err) {
            showToast(err.message || 'Authentication failed', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<span>SIGN IN TO ACCOUNT</span><i class="fa-solid fa-arrow-right"></i>`;
        }
    };

    const handleRegisterSubmit = async (e) => {
        e.preventDefault();
        const name = document.getElementById('reg-name')?.value.trim() || '';
        const email = document.getElementById('reg-email').value.trim();
        const phone = document.getElementById('reg-phone').value.trim();
        const password = document.getElementById('reg-password').value;
        const terms = document.getElementById('reg-terms').checked;

        const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        const phoneOk = phone.replace(/\D/g, '').length >= 7;
        const pwOk = password.length >= 8;

        document.getElementById('err-reg-email').classList.toggle('hidden', emailOk);
        document.getElementById('err-reg-email').textContent = 'Please enter a valid email address.';
        document.getElementById('err-reg-phone').classList.toggle('hidden', phoneOk);
        document.getElementById('err-reg-phone').textContent = 'Please enter a valid phone number (min 7 digits).';
        document.getElementById('err-reg-password').classList.toggle('hidden', pwOk);
        document.getElementById('err-reg-password').textContent = 'Password must be at least 8 characters long.';
        document.getElementById('err-reg-terms').classList.toggle('hidden', terms);
        document.getElementById('err-reg-terms').textContent = 'You must accept the platform terms.';

        if (!emailOk || !phoneOk || !pwOk || !terms) return;

        const btn = document.getElementById('btn-register-submit');
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><span>CREATING ACCOUNT...</span>`;

        try {
            const res = await ApiClient.registerUser({ name, email, phone, password });
            ConfettiEngine.launch();
            showToast(`Welcome to LuckyVault, ${res.user.name}!`, 'success');
            switchMainView('player');
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
            const bonus = Number(ApiClient.getState().settings.regBonus || 0);
            const curr = ApiClient.getState().settings.currency || '₦';
            btn.innerHTML = `<i class="fa-solid fa-user-plus"></i><span id="btn-register-submit-text">${bonus > 0 ? `CREATE ACCOUNT & CLAIM ${curr}${bonus} BONUS` : 'CREATE ACCOUNT'}</span>`;
        }
    };

    const handleLogout = () => {
        ApiClient.clearSession();
        showToast('Signed out successfully.', 'info');
        switchMainView('auth');
    };

    const openRechargeModal = () => {
        const state = ApiClient.getState();
        const curr = state.settings.currency || '₦';

        [1000, 1500, 2000, 2500, 3000].forEach(v => {
            const el = document.getElementById(`recharge-preset-${v}`);
            if (el) el.textContent = `${curr}${v.toLocaleString()}`;
        });
        const customLbl = document.getElementById('recharge-custom-amount-label');
        if (customLbl) customLbl.textContent = `Custom Amount (${curr})`;
        const amtInput = document.getElementById('recharge-amount-input');
        if (amtInput) {
            amtInput.min = String(state.settings.minRecharge);
            amtInput.max = String(state.settings.maxRecharge);
            const curVal = Number(amtInput.value);
            if (!Number.isFinite(curVal) || curVal < state.settings.minRecharge || curVal > state.settings.maxRecharge) {
                amtInput.value = state.settings.minRecharge;
            }
        }

        const bank = state.settings.bankDetails || { bankName: 'N/A', accountNumber: 'N/A', accountName: 'N/A' };
        document.getElementById('bank-transfer-bankname').textContent = bank.bankName;
        document.getElementById('bank-transfer-accountno').textContent = bank.accountNumber;
        document.getElementById('bank-transfer-accountname').textContent = bank.accountName;

        document.getElementById('modal-recharge').classList.remove('hidden');
    };
    const closeRechargeModal = () => {
        document.getElementById('modal-recharge').classList.add('hidden');
    };
    const selectRechargePreset = (amt) => {
        document.getElementById('recharge-amount-input').value = amt;
    };
    const confirmRecharge = async () => {
        const amt = Number(document.getElementById('recharge-amount-input').value);
        const state = ApiClient.getState();
        const curr = state.settings.currency || '₦';
        if (!amt || amt < state.settings.minRecharge || amt > state.settings.maxRecharge) {
            showToast(`Please enter an amount between ${curr}${state.settings.minRecharge} and ${curr}${state.settings.maxRecharge}.`, 'error');
            return;
        }

        try {
            const response = await ApiClient.rechargeWallet(amt, 'Korapay Checkout');
            document.getElementById('recharge-reference-input').value = '';
            closeRechargeModal();

            if (response.checkoutUrl) {
                showToast(`Initializing Korapay secure checkout...`, 'info');
                setTimeout(() => {
                    window.location.href = response.checkoutUrl;
                }, 1200);
            } else if (response.tx && response.tx.status === 'Completed') {
                ConfettiEngine.launch();
                showToast(`Wallet credited with +${curr}${amt.toFixed(2)}!`, 'success');
            } else {
                showToast(`Recharge request submitted and pending verification.`, 'info');
            }
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const openWithdrawModal = () => {
        const state = ApiClient.getState();
        const user = state.currentUser;
        const curr = state.settings.currency || '₦';
        const minW = Number(state.settings.minWithdrawal ?? 50);

        if (!user) {
            showToast('Please sign in to withdraw.', 'error');
            return;
        }

        const minLbl = document.getElementById('withdraw-min-display');
        if (minLbl) minLbl.textContent = `${curr}${minW.toFixed(2)}`;
        const amtLbl = document.getElementById('withdraw-amount-label');
        if (amtLbl) amtLbl.textContent = `Withdrawal Amount (${curr})`;
        const balEl = document.getElementById('withdraw-available-balance');
        if (balEl) balEl.textContent = `${curr}${Number(user.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        const bank = user.bankDetails || {};
        const hasBank = Boolean(bank.bankName && bank.accountNumber && bank.accountName);

        const nameDisp = document.getElementById('withdraw-bank-name-display');
        const acctDisp = document.getElementById('withdraw-bank-account-display');
        const holderDisp = document.getElementById('withdraw-bank-holder-display');
        if (nameDisp) nameDisp.textContent = bank.bankName || '-';
        if (acctDisp) acctDisp.textContent = bank.accountNumber || '-';
        if (holderDisp) holderDisp.textContent = bank.accountName || '-';

        const nameInp = document.getElementById('withdraw-bank-name');
        const acctInp = document.getElementById('withdraw-bank-account');
        const holderInp = document.getElementById('withdraw-bank-holder');
        if (nameInp) nameInp.value = bank.bankName || '';
        if (acctInp) acctInp.value = bank.accountNumber || '';
        if (holderInp) holderInp.value = bank.accountName || '';

        const amtInput = document.getElementById('withdraw-amount-input');
        if (amtInput) {
            amtInput.min = String(minW);
            amtInput.max = String(user.balance);
            const curVal = Number(amtInput.value);
            if (!Number.isFinite(curVal) || curVal < minW) amtInput.value = minW;
        }

        const saved = document.getElementById('withdraw-bank-saved');
        const form = document.getElementById('withdraw-bank-form');
        const warn = document.getElementById('withdraw-no-bank-warning');
        const btn = document.getElementById('btn-confirm-withdrawal');
        if (hasBank) {
            if (saved) saved.classList.remove('hidden');
            if (form) form.classList.add('hidden');
            if (warn) warn.classList.add('hidden');
            if (btn) btn.disabled = false;
        } else {
            if (saved) saved.classList.add('hidden');
            if (form) form.classList.remove('hidden');
            if (warn) warn.classList.remove('hidden');
            if (btn) btn.disabled = true;
        }

        document.getElementById('modal-withdraw').classList.remove('hidden');
    };

    const closeWithdrawModal = () => {
        document.getElementById('modal-withdraw').classList.add('hidden');
    };

    const showBankEditForm = () => {
        const saved = document.getElementById('withdraw-bank-saved');
        const form = document.getElementById('withdraw-bank-form');
        if (saved) saved.classList.add('hidden');
        if (form) form.classList.remove('hidden');
    };

    const saveBankDetails = async () => {
        const bankName = document.getElementById('withdraw-bank-name').value.trim();
        const accountNumber = document.getElementById('withdraw-bank-account').value.trim();
        const accountName = document.getElementById('withdraw-bank-holder').value.trim();
        if (!bankName || !accountNumber || !accountName) {
            showToast('Please fill in all bank details.', 'error');
            return;
        }
        try {
            await ApiClient.saveUserBankDetails({ bankName, accountNumber, accountName });
            showToast('Bank account saved successfully!', 'success');
            openWithdrawModal();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const confirmWithdrawal = async () => {
        const state = ApiClient.getState();
        const curr = state.settings.currency || '₦';
        const user = state.currentUser;
        const minW = Number(state.settings.minWithdrawal ?? 50);
        const amount = Number(document.getElementById('withdraw-amount-input').value);

        if (!Number.isFinite(amount) || amount < minW) {
            showToast(`Minimum withdrawal is ${curr}${minW.toFixed(2)}.`, 'error');
            return;
        }
        if (amount > Number(user.balance || 0)) {
            showToast(`Insufficient balance. You have ${curr}${Number(user.balance).toFixed(2)}.`, 'error');
            return;
        }

        const btn = document.getElementById('btn-confirm-withdrawal');
        if (btn) btn.disabled = true;
        try {
            const tx = await ApiClient.requestWithdrawal(amount);
            closeWithdrawModal();
            showToast(`Withdrawal request (${tx.id}) for ${curr}${amount.toFixed(2)} submitted. Awaiting admin approval.`, 'info');
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    };

    const adminApproveWithdrawal = async (txId) => {
        try {
            const curr = ApiClient.getState().settings.currency || '₦';
            const tx = await ApiClient.adminApproveWithdrawal(txId);
            showToast(`Withdrawal ${txId} (${curr}${Number(tx.cost).toFixed(2)}) approved for ${tx.user}.`, 'success');
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const adminRejectWithdrawal = async (txId) => {
        try {
            const curr = ApiClient.getState().settings.currency || '₦';
            const tx = await ApiClient.adminRejectWithdrawal(txId);
            showToast(`Withdrawal ${txId} rejected. ${curr}${Number(tx.cost).toFixed(2)} refunded to ${tx.user}.`, 'info');
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const openPrizeModal = (badge, title, subtitle) => {
        document.getElementById('prize-modal-badge').textContent = badge;
        document.getElementById('prize-modal-title').textContent = title;
        document.getElementById('prize-modal-subtitle').textContent = subtitle;
        document.getElementById('modal-prize-result').classList.remove('hidden');
    };
    const closePrizeModal = () => {
        document.getElementById('modal-prize-result').classList.add('hidden');
    };

    const adminCreditUser = async (userId, amount) => {
        try {
            const curr = ApiClient.getState().settings.currency || '₦';
            await ApiClient.adminCreditUser(userId, amount);
            showToast(`Credited +${curr}${amount.toFixed(2)} to user wallet.`, 'success');
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const adminToggleUserStatus = async (userId) => {
        try {
            const res = await ApiClient.adminToggleUserStatus(userId);
            showToast(`${res.userName} status updated to ${res.userStatus}.`, 'info');
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const adminApproveRecharge = async (txId) => {
        try {
            const curr = ApiClient.getState().settings.currency || '₦';
            const tx = await ApiClient.adminApproveRecharge(txId);
            showToast(`Approved recharge ${txId} (+${curr}${Number(tx.credit).toFixed(2)}) for ${tx.user}.`, 'success');
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const saveWheelConfigFromAdmin = async () => {
        try {
            const state = ApiClient.getState();
            const newCost = Number(document.getElementById('admin-wheel-cost-input').value);
            const updatedSegments = state.wheelConfig.segments.map((seg, idx) => ({
                id: seg.id || idx + 1,
                label: document.getElementById(`wseg-label-${idx}`)?.value ?? seg.label,
                value: Number(document.getElementById(`wseg-val-${idx}`)?.value ?? seg.value),
                color: document.getElementById(`wseg-col-${idx}`)?.value ?? seg.color,
                weight: Number(document.getElementById(`wseg-weight-${idx}`)?.value ?? seg.weight)
            }));

            await ApiClient.updateWheelConfig({
                spinCost: newCost >= 250 ? newCost : state.wheelConfig.spinCost,
                segments: updatedSegments
            });
            showToast('Spin the Wheel configuration saved!', 'success');
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const restoreReferenceWheel = async () => {
        try {
            await ApiClient.updateWheelConfig({ restoreReference: true });
            showToast('Restored default wheel segments and spin cost.', 'info');
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const toggleWheelAvailability = async () => {
        try {
            const state = ApiClient.getState();
            await ApiClient.updateWheelConfig({ available: !state.wheelConfig.available });
            showToast(`Spin the Wheel is now ${ApiClient.getState().wheelConfig.available ? 'ACTIVE' : 'PAUSED'}.`, 'info');
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const toggleMysteryAvailability = async () => {
        try {
            const state = ApiClient.getState();
            await ApiClient.updateMysteryBoxConfig({ available: !state.mysteryConfig.available });
            showToast(`Mystery Box game is now ${ApiClient.getState().mysteryConfig.available ? 'ACTIVE' : 'PAUSED'}.`, 'info');
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const saveMysteryBoxFromAdmin = async (bIdx) => {
        try {
            const box = ApiClient.getState().mysteryConfig.boxes[bIdx];
            if (!box) return;
            const rawCost = Number(document.getElementById(`mbox-cost-${bIdx}`)?.value || box.cost);
            const updatedBox = {
                ...box,
                name: document.getElementById(`mbox-name-${bIdx}`)?.value || box.name,
                cost: Math.max(200, rawCost),
                prizes: box.prizes.map((p, pIdx) => {
                    const val = Math.max(50, Number(document.getElementById(`mbox-pval-${bIdx}-${pIdx}`)?.value ?? p.value));
                    return {
                        ...p,
                        label: document.getElementById(`mbox-plbl-${bIdx}-${pIdx}`)?.value || `₦${val}`,
                        value: val,
                        odds: document.getElementById(`mbox-podds-${bIdx}-${pIdx}`)?.value || p.odds
                    };
                })
            };
            await ApiClient.updateMysteryBoxConfig({ boxIndex: bIdx, updatedBox });
            showToast(`${updatedBox.name} updated!`, 'success');
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const adminTogglePrizeStatus = async (txId) => {
        try {
            const newStatus = await ApiClient.adminTogglePrizeStatus(txId);
            showToast(`Prize record ${txId} marked as ${newStatus}.`, 'info');
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const saveAppSettings = async () => {
        try {
            const settings = {
                currency: document.getElementById('set-currency')?.value || '₦',
                minRecharge: Number(document.getElementById('set-min-recharge')?.value) || 100,
                maxRecharge: Number(document.getElementById('set-max-recharge')?.value) || 3000,
                minWithdrawal: Math.max(0, Number(document.getElementById('set-min-withdrawal')?.value ?? 50)),
                regBonus: Math.max(0, Number(document.getElementById('set-reg-bonus')?.value ?? 0)),
                instantRechargeApproval: Boolean(document.getElementById('set-instant-recharge')?.checked),
                maintenanceMode: Boolean(document.getElementById('set-maintenance')?.checked),
                enableConfetti: Boolean(document.getElementById('set-confetti')?.checked),
                bankDetails: {
                    bankName: document.getElementById('set-bank-name')?.value.trim() || '',
                    accountNumber: document.getElementById('set-bank-account')?.value.trim() || '',
                    accountName: document.getElementById('set-bank-holder')?.value.trim() || ''
                }
            };
            await ApiClient.saveAppSettings(settings);
            showToast('Application settings saved.', 'success');
            syncAllViews();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const toggleSound = () => {
        const state = ApiClient.getState();
        state.settings.soundEnabled = !state.settings.soundEnabled;
        const icon = document.getElementById('sound-icon');
        if (icon) {
            icon.className = state.settings.soundEnabled
                ? 'fa-solid fa-volume-high text-royal-gold text-xs sm:text-sm'
                : 'fa-solid fa-volume-xmark text-stone-500 text-xs sm:text-sm';
        }
        SoundFX.handleSoundToggle();
        showToast(`Sound effects ${state.settings.soundEnabled ? 'enabled' : 'muted'}.`, 'info');
    };

    return {
        init: async () => {
            ensureSlotMachineDOM();
            ensureInvestmentDOM();
            ensureAdminChatDOM();
            setupPlayerChatWidget();
            window.addEventListener('resize', drawFortuneWheel);

            ToneLoader.load().catch(() => { });

            const warmupAudio = () => {
                SoundFX.unlockAndInit();
                document.removeEventListener('click', warmupAudio);
                document.removeEventListener('keydown', warmupAudio);
                document.removeEventListener('touchstart', warmupAudio);
            };
            document.addEventListener('click', warmupAudio);
            document.addEventListener('keydown', warmupAudio);
            document.addEventListener('touchstart', warmupAudio, { passive: true });

            try {
                await ApiClient.fetchPublicConfig();
            } catch (e) {
                console.warn('Could not load public config:', e.message);
            }

            // Show the correct chat view based on stored credentials
            loadPlayerChat().catch(() => { });

            if (ApiClient.hasToken()) {
                try {
                    const state = await ApiClient.fetchInitialState();
                    switchMainView(state.currentUser?.role === 'admin' ? 'admin' : 'player');
                    startChatPolling();
                    return;
                } catch (err) {
                    ApiClient.clearSession();
                }
            }
            switchMainView('auth');
            startChatPolling();
        },
        calculateTotalROI,
        switchMainView,
        switchPlayerSection,
        switchAdminTab,
        switchAuthTab,
        togglePasswordVisibility,
        updatePasswordStrength,
        handleLoginSubmit,
        handleRegisterSubmit,
        handleLogout,
        spinWheel,
        spinSlotMachine,
        selectMysteryBoxTier,
        openMysteryBox,
        purchaseInvestment,
        filterPlayerHistory,
        openRechargeModal,
        closeRechargeModal,
        selectRechargePreset,
        confirmRecharge,
        openWithdrawModal,
        closeWithdrawModal,
        showBankEditForm,
        saveBankDetails,
        confirmWithdrawal,
        closePrizeModal,
        adminCreditUser,
        adminToggleUserStatus,
        adminApproveRecharge,
        adminApproveWithdrawal,
        adminRejectWithdrawal,
        saveWheelConfigFromAdmin,
        restoreReferenceWheel,
        toggleWheelAvailability,
        toggleMysteryAvailability,
        saveMysteryBoxFromAdmin,
        showAdminInvestForm,
        hideAdminInvestForm,
        editAdminInvestPlan,
        saveAdminInvestPlan,
        deleteAdminInvestPlan,
        adminTogglePrizeStatus,
        saveAppSettings,
        toggleSound,
        showToast,
        renderAdminUsers,
        renderAdminTransactions,
        renderAdminWithdrawals,
        loadPlayerChat,
        sendPlayerChatMessage,
        handleGuestChatSubmit,
        selectAdminChatSession,
        sendAdminChatMessage
    };
})();

window.onload = function () {
    AppController.init();
};