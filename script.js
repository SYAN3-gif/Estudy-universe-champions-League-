// eStudyUniverse - Main Application Logic

import {
    auth,
    db,
    signInWithGoogle,
    handleRedirectResult,
    signOutUser,
    onAuthChange,
    isAdmin,
    createSeason,
    getActiveSeason,
    onSeasonsChange,
    addPlayer,
    removePlayer,
    onPlayersChange,
    recordMatch,
    onMatchesChange,
    getAnalytics,
    resetSeason,
    formatDate,
    validatePlayerName,
    validateScores,
    ensureFirstSeason
} from './firebase.js';

// ============================================================================
// STATE & GLOBALS
// ============================================================================

let currentUser = null;
let currentUserIsAdmin = false;
let activeSeason = null;
let players = [];
let matches = [];
let unsubscribeAuth = null;
let unsubscribePlayers = null;
let unsubscribeMatches = null;
let unsubscribeSeasons = null;
let selectedDeletePlayerId = null;
let playerToDelete = null;
let charts = {};

// ============================================================================
// UI ELEMENTS
// ============================================================================

const authModal = document.getElementById('authModal');
const app = document.getElementById('app');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const signOutBtn = document.getElementById('signOutBtn');
const adminToggle = document.getElementById('adminToggle');
const addPlayerBtn = document.getElementById('addPlayerBtn');
const seasonSelect = document.getElementById('seasonSelect');
const adminPanel = document.getElementById('adminPanel');
const closeAdminBtn = document.getElementById('closeAdminBtn');

const matchForm = document.getElementById('matchForm');
const playerA = document.getElementById('playerA');
const playerB = document.getElementById('playerB');
const scoreA = document.getElementById('scoreA');
const scoreB = document.getElementById('scoreB');
const matchResult = document.getElementById('matchResult');
const standingsTable = document.getElementById('standingsTable');
const playerRows = document.getElementById('playerRows');
const emptyState = document.getElementById('emptyState');
const matchHistory = document.getElementById('matchHistory');

const addPlayerModal = document.getElementById('addPlayerModal');
const addPlayerForm = document.getElementById('addPlayerForm');
const playerNameInput = document.getElementById('playerNameInput');
const deleteModal = document.getElementById('deleteModal');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
const deletePlayerName = document.getElementById('deletePlayerName');

const toast = document.getElementById('toast');

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
    // Ensure first season exists
    try {
        await ensureFirstSeason();
    } catch (error) {
        console.log('Season initialization handled');
    }

    // Handle sign-in redirect result (necessary for mobile support)
    try {
        await handleRedirectResult();
    } catch (error) {
        console.error('Redirect login processing failed:', error);
    }

    // Setup auth listener
    unsubscribeAuth = onAuthChange(async (user) => {
        console.log('Auth State Changed. User:', user ? user.email : 'None');
        
        if (user) {
            currentUser = user;
            try {
                // Default to non-admin if this check fails due to database restrictions
                currentUserIsAdmin = await isAdmin(user.uid).catch(() => false);
                
                authModal.classList.add('hidden');
                app.classList.remove('hidden');
                
                setupAdminControls();
                await loadSeasons();
                setupSeasonsListener();
            } catch (err) {
                console.error('Error during post-login UI setup:', err);
            }
        } else {
            currentUser = null;
            currentUserIsAdmin = false;
            
            authModal.classList.remove('hidden');
            app.classList.add('hidden');
            
            cleanupListeners();
        }
    });
}

async function setupAdminControls() {
    adminToggle.style.display = currentUserIsAdmin ? 'block' : 'none';
    addPlayerBtn.style.display = currentUserIsAdmin ? 'block' : 'none';
}

// ============================================================================
// SEASON MANAGEMENT
// ============================================================================

async function loadSeasons() {
    try {
        const season = await getActiveSeason();
        if (season) {
            activeSeason = {
                id: season.id,
                ...season.data()
            };
            updateSeasonSelect();
            setupPlayersListener();
        }
    } catch (error) {
        showToast('Error loading season', 'error');
    }
}

function setupSeasonsListener() {
    unsubscribeSeasons = onSeasonsChange((seasons) => {
        updateSeasonSelect(seasons);
    });
}

function updateSeasonSelect(seasons = null) {
    if (!seasons && activeSeason) {
        seasonSelect.innerHTML = `<option value="${activeSeason.id}">${activeSeason.name}</option>`;
        return;
    }

    seasonSelect.innerHTML = seasons
        .map(s => `<option value="${s.id}" ${s.isActive ? 'selected' : ''}>${s.name}${s.isActive ? ' (Active)' : ''}</option>`)
        .join('');

    seasonSelect.onchange = async (e) => {
        const selectedId = e.target.value;
        const selected = seasons.find(s => s.id === selectedId);
        if (selected && selected.isActive) {
            activeSeason = selected;
            setupPlayersListener();
        }
    };
}

// ============================================================================
// PLAYERS & STANDINGS
// ============================================================================

function setupPlayersListener() {
    if (unsubscribePlayers) unsubscribePlayers();
    
    if (!activeSeason) return;

    unsubscribePlayers = onPlayersChange(activeSeason.id, (playerList) => {
        players = playerList;
        renderStandings();
        updatePlayerSelects();
        updateAnalytics();
    });
}

function renderStandings() {
    if (players.length === 0) {
        playerRows.innerHTML = '';
        emptyState.classList.remove('hidden');
        standingsTable.style.display = 'none';
        return;
    }

    emptyState.classList.add('hidden');
    standingsTable.style.display = 'block';

    playerRows.innerHTML = players.map((player, index) => `
        <div class="table-row">
            <div class="col-pos">${index + 1}</div>
            <div class="col-player">
                <div class="col-player-name">
                    <div class="col-player-avatar">${player.name.charAt(0).toUpperCase()}</div>
                    <span>${player.name}</span>
                </div>
            </div>
            <div class="col-xp">${Math.floor(player.xp)}</div>
            <div class="col-stats">${player.played}</div>
            <div class="col-stats">${player.won}</div>
            <div class="col-stats">${player.drawn}</div>
            <div class="col-stats">${player.lost}</div>
            <div class="col-quiz">${player.avgQuizPct.toFixed(1)}%</div>
            <div class="col-actions">
                ${currentUserIsAdmin ? `<button class="delete-btn" onclick="deletePlayer('${player.id}', '${player.name}')">🗑️</button>` : ''}
            </div>
        </div>
    `).join('');
}

function updatePlayerSelects() {
    const options = players.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    
    playerA.innerHTML = '<option value="">Select player...</option>' + options;
    playerB.innerHTML = '<option value="">Select player...</option>' + options;

    // Prevent same player selection
    playerA.onchange = validatePlayerSelection;
    playerB.onchange = validatePlayerSelection;
}

function validatePlayerSelection() {
    if (playerA.value === playerB.value && playerA.value !== '') {
        showToast('Select different players', 'error');
        playerB.value = '';
    }
}

// Delete Player
window.deletePlayer = function(playerId, playerName) {
    selectedDeletePlayerId = playerId;
    playerToDelete = playerName;
    deletePlayerName.textContent = playerName;
    deleteModal.classList.remove('hidden');
};

confirmDeleteBtn.onclick = async () => {
    if (!selectedDeletePlayerId) return;

    try {
        confirmDeleteBtn.disabled = true;
        await removePlayer(selectedDeletePlayerId);
        deleteModal.classList.add('hidden');
        showToast(`${playerToDelete} removed`, 'success');
        selectedDeletePlayerId = null;
        playerToDelete = null;
    } catch (error) {
        showToast('Error removing player', 'error');
    } finally {
        confirmDeleteBtn.disabled = false;
    }
};

// ============================================================================
// MATCH RECORDING
// ============================================================================

document.querySelectorAll('.result-btn').forEach(btn => {
    btn.onclick = function(e) {
        e.preventDefault();
        document.querySelectorAll('.result-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        matchResult.value = this.dataset.result;
    };
});

matchForm.onsubmit = async (e) => {
    e.preventDefault();

    if (!playerA.value || !playerB.value || !matchResult.value) {
        showToast('Select players and result', 'error');
        return;
    }

    if (playerA.value === playerB.value) {
        showToast('Select different players', 'error');
        return;
    }

    const validation = validateScores(scoreA.value, scoreB.value);
    if (!validation.valid) {
        showToast(validation.error, 'error');
        return;
    }

    try {
        matchForm.querySelector('button[type="submit"]').disabled = true;
        
        await recordMatch(
            playerA.value,
            playerB.value,
            matchResult.value,
            parseFloat(scoreA.value),
            parseFloat(scoreB.value),
            activeSeason.id
        );

        // Reset form
        matchForm.reset();
        document.querySelectorAll('.result-btn').forEach(b => b.classList.remove('active'));
        matchResult.value = '';
        
        showToast('Match recorded!', 'success');
    } catch (error) {
        showToast('Error recording match', 'error');
    } finally {
        matchForm.querySelector('button[type="submit"]').disabled = false;
    }
};

// ============================================================================
// MATCH HISTORY
// ============================================================================

function setupMatchesListener() {
    if (unsubscribeMatches) unsubscribeMatches();
    
    if (!activeSeason) return;

    unsubscribeMatches = onMatchesChange(activeSeason.id, (matchList) => {
        matches = matchList;
        renderMatchHistory();
    });
}

function renderMatchHistory() {
    if (matches.length === 0) {
        matchHistory.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--color-text-secondary);">No matches yet</div>';
        return;
    }

    matchHistory.innerHTML = matches.map(match => {
        const isAWin = match.result === 'A_WIN';
        const isBWin = match.result === 'B_WIN';
        const isDraw = match.result === 'DRAW';

        return `
            <div class="match-item">
                <div class="match-players">
                    <div class="match-player">
                        <div class="match-player-avatar">${match.playerAName.charAt(0).toUpperCase()}</div>
                        <div class="match-player-info">
                            <div class="match-player-name">${match.playerAName}</div>
                            <div class="match-player-score">${match.playerAScore}%</div>
                        </div>
                    </div>
                </div>
                <div class="match-result ${isAWin ? 'win' : isBWin ? 'loss' : 'draw'}">
                    ${isDraw ? 'Draw' : isAWin ? 'Win' : 'Loss'}
                </div>
                <div class="match-players">
                    <div class="match-player">
                        <div class="match-player-avatar">${match.playerBName.charAt(0).toUpperCase()}</div>
                        <div class="match-player-info">
                            <div class="match-player-name">${match.playerBName}</div>
                            <div class="match-player-score">${match.playerBScore}%</div>
                        </div>
                    </div>
                </div>
                <div class="match-timestamp">${formatDate(match.createdAt)}</div>
            </div>
        `;
    }).join('');
}

// ============================================================================
// ANALYTICS
// ============================================================================

async function updateAnalytics() {
    if (!activeSeason) return;

    try {
        const analytics = await getAnalytics(activeSeason.id);
        
        document.getElementById('totalMatches').textContent = analytics.totalMatches;
        document.getElementById('activePlayers').textContent = analytics.activePlayers;
        document.getElementById('highestXP').textContent = Math.floor(analytics.highestXP);
        document.getElementById('highestXPPlayer').textContent = analytics.highestXPPlayer;
        document.getElementById('bestQuiz').textContent = analytics.bestQuiz.toFixed(1) + '%';
        document.getElementById('bestQuizPlayer').textContent = analytics.bestQuizPlayer;

        // Render charts
        renderXPChart(analytics.players);
        renderWinRateChart(analytics.players);
    } catch (error) {
        console.error('Error updating analytics:', error);
    }
}

function renderXPChart(playerList) {
    const ctx = document.getElementById('xpChart');
    if (!ctx) return;

    if (charts.xp) charts.xp.destroy();

    charts.xp = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: playerList.map(p => p.name),
            datasets: [{
                label: 'XP',
                data: playerList.map(p => p.xp),
                backgroundColor: 'rgba(94, 72, 214, 0.8)',
                borderColor: 'rgba(94, 72, 214, 1)',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: { color: 'rgba(232, 238, 245, 0.7)' },
                    grid: { color: 'rgba(58, 66, 79, 0.3)' }
                },
                y: {
                    ticks: { color: 'rgba(232, 238, 245, 0.7)' },
                    grid: { display: false }
                }
            }
        }
    });
}

function renderWinRateChart(playerList) {
    const ctx = document.getElementById('winRateChart');
    if (!ctx) return;

    if (charts.winRate) charts.winRate.destroy();

    const winRates = playerList.map(p => 
        p.played > 0 ? (p.won / p.played * 100) : 0
    );

    charts.winRate = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: playerList.map(p => p.name),
            datasets: [{
                data: winRates,
                backgroundColor: [
                    'rgba(94, 72, 214, 0.8)',
                    'rgba(255, 107, 107, 0.8)',
                    'rgba(76, 175, 80, 0.8)',
                    'rgba(255, 152, 0, 0.8)',
                    'rgba(33, 150, 243, 0.8)'
                ],
                borderColor: 'rgba(15, 20, 25, 1)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: 'rgba(232, 238, 245, 0.7)' },
                    position: 'bottom'
                }
            }
        }
    });
}

// ============================================================================
// ADMIN CONTROLS
// ============================================================================

adminToggle.onclick = () => {
    adminPanel.classList.toggle('hidden');
};

closeAdminBtn.onclick = () => {
    adminPanel.classList.add('hidden');
};

// Add Player
addPlayerBtn.onclick = () => {
    playerNameInput.value = '';
    addPlayerModal.classList.remove('hidden');
};

addPlayerForm.onsubmit = async (e) => {
    e.preventDefault();

    const validation = validatePlayerName(playerNameInput.value);
    if (!validation.valid) {
        showToast(validation.error, 'error');
        return;
    }

    try {
        addPlayerForm.querySelector('button[type="submit"]').disabled = true;
        await addPlayer(playerNameInput.value, activeSeason.id);
        addPlayerModal.classList.add('hidden');
        showToast(`${playerNameInput.value} added!`, 'success');
    } catch (error) {
        showToast(error.message || 'Error adding player', 'error');
    } finally {
        addPlayerForm.querySelector('button[type="submit"]').disabled = false;
    }
};

// Create Season
document.getElementById('createSeasonBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('newSeasonName')?.value?.trim();
    if (!name) {
        showToast('Enter season name', 'error');
        return;
    }

    try {
        await createSeason(name);
        document.getElementById('newSeasonName').value = '';
        showToast('Season created!', 'success');
    } catch (error) {
        showToast('Error creating season', 'error');
    }
});

// Reset Season
document.getElementById('resetSeasonBtn')?.addEventListener('click', async () => {
    if (!confirm('Reset all standings and matches? This cannot be undone.')) return;

    try {
        await resetSeason(activeSeason.id);
        showToast('Season reset', 'success');
    } catch (error) {
        showToast('Error resetting season', 'error');
    }
});

// ============================================================================
// AUTHENTICATION
// ============================================================================

googleSignInBtn.onclick = async () => {
    try {
        googleSignInBtn.disabled = true;
        await signInWithGoogle();
    } catch (error) {
        console.error('Google Sign-In Detail Error:', error);
        const message = error.code === 'auth/popup-closed-by-user' ? 'Login cancelled' : 'Sign-in failed';
        showToast(message, 'error');
    } finally {
        googleSignInBtn.disabled = false;
    }
};

signOutBtn.onclick = async () => {
    try {
        await signOutUser();
    } catch (error) {
        showToast('Sign-out failed', 'error');
    }
};

// ============================================================================
// MODAL MANAGEMENT
// ============================================================================

document.querySelectorAll('.modal-close').forEach(btn => {
    btn.onclick = (e) => {
        const modal = e.target.closest('.modal');
        if (modal) modal.classList.add('hidden');
    };
});

// ============================================================================
// NOTIFICATIONS
// ============================================================================

function showToast(message, type = 'info') {
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');

    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// ============================================================================
// CLEANUP
// ============================================================================

function cleanupListeners() {
    if (unsubscribePlayers) unsubscribePlayers();
    if (unsubscribeMatches) unsubscribeMatches();
}

window.addEventListener('beforeunload', () => {
    if (unsubscribeAuth) unsubscribeAuth();
    cleanupListeners();
    if (unsubscribeSeasons) unsubscribeSeasons();
});

// ============================================================================
// START APPLICATION
// ============================================================================

init();

// Re-setup match history listener when season changes
const originalSetupPlayersListener = setupPlayersListener;
window.setupPlayersListener = function() {
    originalSetupPlayersListener();
    setupMatchesListener();
};

setupMatchesListener();
