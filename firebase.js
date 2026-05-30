// Firebase Configuration & Database Operations
// Replace with your Firebase config from Firebase Console

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js';
import { 
    getAuth, 
    signInWithPopup, 
    signInWithRedirect,
    getRedirectResult,
    GoogleAuthProvider,
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import { 
    getFirestore, 
    collection, 
    addDoc, 
    updateDoc,
    deleteDoc,
    doc,
    getDocs,
    query,
    where,
    orderBy,
    onSnapshot,
    writeBatch,
    runTransaction,
    setDoc,
    getDoc,
    serverTimestamp,
    Timestamp
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

// ============================================================================
// FIREBASE CONFIGURATION - UPDATE WITH YOUR PROJECT DETAILS
// ============================================================================
const firebaseConfig = {
    apiKey: "AIzaSyCquDSf27zLfUVLKWHds06GI7zlCE1ppWc",
    authDomain: "esuniverse-c7e1a.firebaseapp.com",
    projectId: "esuniverse-c7e1a",
    storageBucket: "esuniverse-c7e1a.firebasestorage.app",
    messagingSenderId: "667649269247",
    appId: "1:667649269247:web:17a6e0d0d4acb892079bca"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Google Auth Provider
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// ============================================================================
// AUTHENTICATION FUNCTIONS
// ============================================================================

export async function signInWithGoogle() {
    try {
        // Use redirect on mobile devices as popups are often blocked by mobile browsers
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        if (isMobile) {
            return await signInWithRedirect(auth, googleProvider);
        }

        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        
        // We wrap this in a separate try/catch so a database error 
        // doesn't break the entire authentication flow
        try {
            await ensureUserDoc(user.uid, user.displayName, user.email);
        } catch (dbError) {
            console.warn('User authenticated, but profile sync failed:', dbError);
        }
        
        return user;
    } catch (error) {
        throw error;
    }
}

/**
 * Handles the result of a sign-in redirect.
 * This should be called when the app initializes to process any returning redirect login.
 */
export async function handleRedirectResult() {
    try {
        const result = await getRedirectResult(auth);
        if (result && result.user) {
            const user = result.user;
            try {
                await ensureUserDoc(user.uid, user.displayName, user.email);
            } catch (dbError) {
                console.warn('User authenticated via redirect, but profile sync failed:', dbError);
            }
            return user;
        }
    } catch (error) {
        console.error('Redirect sign-in error:', error);
        throw error;
    }
    return null;
}

export async function signOutUser() {
    try {
        await signOut(auth);
    } catch (error) {
        console.error('Sign-out error:', error);
        throw error;
    }
}

export function onAuthChange(callback) {
    return onAuthStateChanged(auth, callback);
}

async function ensureUserDoc(uid, displayName, email) {
    const userDoc = doc(db, 'users', uid);
    const userSnap = await getDoc(userDoc);
    
    if (!userSnap.exists()) {
        await setDoc(userDoc, {
            uid,
            displayName: displayName || 'User',
            email: email || '',
            role: 'user',
            createdAt: serverTimestamp()
        });
    }
}

// ============================================================================
// AUTHORIZATION CHECKS
// ============================================================================

export async function isAdmin(uid) {
    if (!uid) return false;
    try {
        const userDoc = await getDoc(doc(db, 'users', uid));
        return userDoc.exists() && userDoc.data().role === 'admin';
    } catch (error) {
        console.error('Error checking admin status:', error);
        return false;
    }
}

// ============================================================================
// SEASON MANAGEMENT
// ============================================================================

export async function createSeason(seasonName) {
    try {
        // Deactivate all existing seasons
        const seasons = await getDocs(collection(db, 'seasons'));
        for (const seasonDoc of seasons.docs) {
            await updateDoc(doc(db, 'seasons', seasonDoc.id), {
                isActive: false
            });
        }

        // Create new season
        const newSeason = await addDoc(collection(db, 'seasons'), {
            name: seasonName || `Season ${new Date().getFullYear()}`,
            isActive: true,
            createdAt: serverTimestamp()
        });

        return newSeason.id;
    } catch (error) {
        console.error('Error creating season:', error);
        throw error;
    }
}

export async function getActiveSeason() {
    try {
        const seasonQuery = query(
            collection(db, 'seasons'),
            where('isActive', '==', true)
        );
        const snapshot = await getDocs(seasonQuery);
        return snapshot.docs[0];
    } catch (error) {
        console.error('Error getting active season:', error);
        return null;
    }
}

export function onSeasonsChange(callback) {
    return onSnapshot(collection(db, 'seasons'), snapshot => {
        const seasons = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        callback(seasons);
    }, error => {
        console.error('Error listening to seasons:', error);
    });
}

// ============================================================================
// PLAYER MANAGEMENT
// ============================================================================

export async function addPlayer(name, seasonId) {
    try {
        const normalizedName = name.trim();
        
        // Check for duplicate (case-insensitive)
        const existing = await getDocs(query(
            collection(db, 'players'),
            where('seasonId', '==', seasonId),
            where('name', '==', normalizedName)
        ));

        if (!existing.empty) {
            throw new Error('Player already exists');
        }

        const player = await addDoc(collection(db, 'players'), {
            name: normalizedName,
            xp: 0,
            played: 0,
            won: 0,
            drawn: 0,
            lost: 0,
            avgQuizPct: 0,
            seasonId: seasonId,
            createdAt: serverTimestamp()
        });

        return player;
    } catch (error) {
        console.error('Error adding player:', error);
        throw error;
    }
}

export async function removePlayer(playerId) {
    try {
        // Delete player
        await deleteDoc(doc(db, 'players', playerId));

        // Delete all player's matches
        const matchesA = await getDocs(query(
            collection(db, 'matches'),
            where('playerAId', '==', playerId)
        ));
        
        const matchesB = await getDocs(query(
            collection(db, 'matches'),
            where('playerBId', '==', playerId)
        ));

        const batch = writeBatch(db);
        
        matchesA.forEach(m => batch.delete(m.ref));
        matchesB.forEach(m => batch.delete(m.ref));
        
        await batch.commit();
    } catch (error) {
        console.error('Error removing player:', error);
        throw error;
    }
}

export function onPlayersChange(seasonId, callback) {
    const q = query(
        collection(db, 'players'),
        where('seasonId', '==', seasonId),
        orderBy('xp', 'desc')
    );

    return onSnapshot(q, snapshot => {
        const players = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        // Apply tie-break logic for sorting
        const sorted = players.sort((a, b) => {
            if (a.xp !== b.xp) return b.xp - a.xp;
            if (a.avgQuizPct !== b.avgQuizPct) return b.avgQuizPct - a.avgQuizPct;
            return a.name.localeCompare(b.name);
        });

        callback(sorted);
    }, error => {
        console.error('Error listening to players:', error);
    });
}

// ============================================================================
// MATCH RECORDING
// ============================================================================

export async function recordMatch(playerAId, playerBId, result, scoreA, scoreB, seasonId) {
    try {
        return await runTransaction(db, async (transaction) => {
            const playerARef = doc(db, 'players', playerAId);
            const playerBRef = doc(db, 'players', playerBId);

            const playerASnap = await transaction.get(playerARef);
            const playerBSnap = await transaction.get(playerBRef);

            if (!playerASnap.exists() || !playerBSnap.exists()) {
                throw new Error('Player not found');
            }

            const playerA = playerASnap.data();
            const playerB = playerBSnap.data();

            // Calculate XP changes
            let xpChangeA = 0, xpChangeB = 0;
            let winsA = playerA.won, winsB = playerB.won;
            let lossesA = playerA.lost, lossesB = playerB.lost;
            let drawsA = playerA.drawn, drawsB = playerB.drawn;

            switch (result) {
                case 'A_WIN':
                    xpChangeA = 50;
                    xpChangeB = -30;
                    winsA++;
                    lossesB++;
                    break;
                case 'B_WIN':
                    xpChangeA = -30;
                    xpChangeB = 50;
                    lossesA++;
                    winsB++;
                    break;
                case 'DRAW':
                    xpChangeA = 25;
                    xpChangeB = 25;
                    drawsA++;
                    drawsB++;
                    break;
            }

            // Calculate new average quiz %
            const newAvgA = (playerA.avgQuizPct * playerA.played + scoreA) / (playerA.played + 1);
            const newAvgB = (playerB.avgQuizPct * playerB.played + scoreB) / (playerB.played + 1);

            // Update player A
            transaction.update(playerARef, {
                xp: playerA.xp + xpChangeA,
                played: playerA.played + 1,
                won: winsA,
                drawn: drawsA,
                lost: lossesA,
                avgQuizPct: newAvgA
            });

            // Update player B
            transaction.update(playerBRef, {
                xp: playerB.xp + xpChangeB,
                played: playerB.played + 1,
                won: winsB,
                drawn: drawsB,
                lost: lossesB,
                avgQuizPct: newAvgB
            });

            // Create match document
            const matchRef = await addDoc(collection(db, 'matches'), {
                playerAId: playerAId,
                playerBId: playerBId,
                playerAName: playerA.name,
                playerBName: playerB.name,
                result: result,
                playerAScore: scoreA,
                playerBScore: scoreB,
                seasonId: seasonId,
                createdAt: serverTimestamp(),
                createdBy: auth.currentUser?.uid || 'unknown'
            });

            return matchRef.id;
        });
    } catch (error) {
        console.error('Error recording match:', error);
        throw error;
    }
}

export function onMatchesChange(seasonId, callback) {
    const q = query(
        collection(db, 'matches'),
        where('seasonId', '==', seasonId),
        orderBy('createdAt', 'desc')
    );

    return onSnapshot(q, snapshot => {
        const matches = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate() || new Date()
            };
        });
        callback(matches);
    }, error => {
        console.error('Error listening to matches:', error);
    });
}

// ============================================================================
// ANALYTICS
// ============================================================================

export async function getAnalytics(seasonId) {
    try {
        const players = await getDocs(query(
            collection(db, 'players'),
            where('seasonId', '==', seasonId)
        ));

        const matches = await getDocs(query(
            collection(db, 'matches'),
            where('seasonId', '==', seasonId)
        ));

        const playerDocs = players.docs.map(doc => doc.data());
        const matchDocs = matches.docs.map(doc => doc.data());

        const highestXP = playerDocs.reduce((max, p) => p.xp > max.xp ? p : max, { xp: 0, name: '-' });
        const bestQuiz = playerDocs.reduce((max, p) => p.avgQuizPct > max.avgQuizPct ? p : max, { avgQuizPct: 0, name: '-' });

        return {
            totalMatches: matchDocs.length,
            activePlayers: playerDocs.length,
            highestXP: highestXP.xp,
            highestXPPlayer: highestXP.name,
            bestQuiz: bestQuiz.avgQuizPct,
            bestQuizPlayer: bestQuiz.name,
            players: playerDocs,
            matches: matchDocs
        };
    } catch (error) {
        console.error('Error getting analytics:', error);
        return null;
    }
}

// ============================================================================
// RESET SEASON
// ============================================================================

export async function resetSeason(seasonId) {
    try {
        return await runTransaction(db, async (transaction) => {
            // Get all players in season
            const playersSnap = await getDocs(query(
                collection(db, 'players'),
                where('seasonId', '==', seasonId)
            ));

            // Reset each player
            playersSnap.forEach(playerDoc => {
                transaction.update(playerDoc.ref, {
                    xp: 0,
                    played: 0,
                    won: 0,
                    drawn: 0,
                    lost: 0,
                    avgQuizPct: 0
                });
            });

            // Delete all matches in season
            const matchesSnap = await getDocs(query(
                collection(db, 'matches'),
                where('seasonId', '==', seasonId)
            ));

            matchesSnap.forEach(matchDoc => {
                transaction.delete(matchDoc.ref);
            });
        });
    } catch (error) {
        console.error('Error resetting season:', error);
        throw error;
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function formatDate(date) {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    const now = new Date();
    const diff = now - d;
    const hours = Math.floor(diff / 3600000);
    
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    
    return d.toLocaleDateString();
}

export function validatePlayerName(name) {
    const trimmed = name.trim();
    if (!trimmed) return { valid: false, error: 'Name is required' };
    if (trimmed.length > 20) return { valid: false, error: 'Max 20 characters' };
    return { valid: true };
}

export function validateScores(scoreA, scoreB) {
    const a = parseFloat(scoreA);
    const b = parseFloat(scoreB);
    
    if (isNaN(a) || isNaN(b)) return { valid: false, error: 'Scores must be numbers' };
    if (a < 0 || a > 100 || b < 0 || b > 100) {
        return { valid: false, error: 'Scores must be between 0 and 100' };
    }
    
    return { valid: true };
}

export function ensureFirstSeason() {
    return createSeason('Season 1').catch(() => {
        // Season might already exist
        return null;
    });
}
