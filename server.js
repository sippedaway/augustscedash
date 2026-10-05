const express = require('express');
const cors = require('cors');
require('dotenv').config();
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const { validateSpawnPointUpdate } = require('./public/weekly-config');

const requiredEnvironmentVariables = ['DATABASE_URL'];
const sessionSecret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
const missingEnvironmentVariables = requiredEnvironmentVariables.filter(name => !process.env[name]);
if (!sessionSecret) missingEnvironmentVariables.unshift('SESSION_SECRET');
if (missingEnvironmentVariables.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnvironmentVariables.join(', ')}`);
}

const app = express();
const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true' || Boolean(process.env.VERCEL);
app.set('trust proxy', trustProxy);
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,https://augustscedash.vercel.app')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin is not allowed by CORS'));
    },
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false
});
const playerSearchLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false
});

const API_BASE = 'https://api.oriondrift.net';
const FLEET_ID = '0044c72f-8c2f-41f7-9241-97641e2b8e92';

const ALLOWED_ROLE_PERMISSIONS = new Set([
    'fleet:join',
    'user_kick',
    'global_voip',
    'color:green',
    'key_holder_circuitlounge',
    'key_holder_office',
    'key_holder',
    'key_holder_driftplex',
    'key_holder_complex',
    'user_ban:write',
    'user_warn',
    'user_ban_short:write',
    'fleet:read',
    'user_mute'
]);
const ALLOWED_EXACT_KEYS = [
    'config.player.enableThrusters',
    'config.player.enableHeartBall',
    'config.player.tackleEnemyTeamOnly',
    'config.player.enableEnemyPlayerGrab',
    'config.visualEffects.fireworksOn',
    'config.gateKeeperVolumes.circuitLoungeLocked',
    'config.gateKeeperVolumes.driftplexLocked',
    'config.gateKeeperVolumes.complexLocked',
    'config.gateKeeperVolumes.officeLocked',
    'config.spawnPointSettings.overrideSpawnPoint',
    'config.spawnPointSettings.overriddenSpawnLocationX',
    'config.spawnPointSettings.overriddenSpawnLocationY',
    'config.spawnPointSettings.overriddenSpawnLocationZ',
    'config.spawnPointSettings.overriddenSpawnRotationPitch',
    'config.spawnPointSettings.overriddenSpawnRotationYaw',
    'config.spawnPointSettings.overriddenSpawnRotationRoll',
    'is_whitelist',
    'CustomGamemodes.PKR_Scrapun_Demo_Full_1',
    'CustomGamemodes.0300_Full_1',
    'CustomGamemodes.0800_Full_1',
    'CustomGamemodes.1200_Full_1',
    'loadedgamemodes.PKR_Scrapun_Demo_Full_1.modulestate.dashboardconfigoverrides.Assistants'
];
const ALLOWED_PREFIXES = [
    'loadedgamemodes.tkb_prime.',
    'loadedgamemodes.tkb_plazawest.',
    'loadedgamemodes.tkb_plazaeast.',
    'loadedgamemodes.driftball west 01.',
    'loadedgamemodes.driftball east 01.',
    'loadedgamemodes.czg_zdrift_beta.',
    'loadedgamemodes.czg_zdrift_alpha.',
    'loadedgamemodes.czg_zdrift_gamma.',
    'loadedgamemodes.driftplexsoccerwestfront.',
    'loadedgamemodes.pkr_ctf_01.'
];

function validateKey(key) {
    if (ALLOWED_EXACT_KEYS.includes(key)) return true;
    if (isWhitelistPlayerListKey(key)) return true;
    if (/(?:^|\.)Admins$|(?:^|\.)Assistants$/i.test(key)) return false;
    for (const prefix of ALLOWED_PREFIXES) {
        if (key.startsWith(prefix)) return true;
    }
    return false;
}

function isWhitelistPlayerListKey(key) {
    return /(?:^|\.)team[01]whitelist$/i.test(key);
}

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

const sessionTableReady = pool.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
        session_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        encrypted_api_key TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
    );
    ALTER TABLE auth_sessions DROP COLUMN IF EXISTS discord_id;
    ALTER TABLE auth_sessions DROP COLUMN IF EXISTS avatar;
    CREATE TABLE IF NOT EXISTS odgroups (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        players JSONB NOT NULL DEFAULT '[]'::jsonb
    )
`);

const encryptionKey = crypto.createHash('sha256').update(sessionSecret).digest();

function getHeaders(req) {
    if (!req.user?.dashApiKey) {
        const error = new Error('Authenticated session does not contain a dashboard API key');
        error.status = 401;
        throw error;
    }

    const dashApiKey = normalizeApiKey(req.user.dashApiKey);

    return {
        'x-api-key': dashApiKey,
        'Content-Type': 'application/json'
    };
}

function normalizeApiKey(value) {
    return String(value)
        .trim()
        .replace(/^Bearer\s+/i, '')
        .replace(/^['"]|['"]$/g, '')
        .replace(/[\u0000-\u0020\u00a0]/g, '');
}

function getCookieOptions(req) {
    return { httpOnly: true, secure: req.secure || process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
}

function encryptApiKey(apiKey) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv, authTag, encrypted].map(value => value.toString('base64url')).join('.');
}

function decryptApiKey(value) {
    const [ivValue, authTagValue, encryptedValue] = String(value).split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(authTagValue, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, 'base64url')),
        decipher.final()
    ]).toString('utf8');
}

app.get('/setup.html', (req, res) => {
    res.sendFile(require('path').join(__dirname, 'public', 'setup.html'));
});

app.get('/style.css', (req, res) => {
    res.sendFile(require('path').join(__dirname, 'public', 'style.css'));
});

app.post('/api/auth/finalize', loginLimiter, async (req, res) => {
    const dashApiKey = typeof req.body.dashApiKey === 'string' ? normalizeApiKey(req.body.dashApiKey) : '';

    if (!dashApiKey) return res.status(400).json({ error: 'Missing API key' });

    try {
        const validationResponse = await requestApi(`${API_BASE}/v1/fleets/${FLEET_ID}`, {
            headers: { 'x-api-key': dashApiKey, 'Content-Type': 'application/json' }
        });
        await validationResponse.arrayBuffer();

        const sessionId = crypto.randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await sessionTableReady;
        await pool.query(
            `INSERT INTO auth_sessions
                (session_id, username, encrypted_api_key, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [sessionId, 'Orion Drift user', encryptApiKey(dashApiKey), expiresAt]
        );
        res.cookie('auth_token', sessionId, getCookieOptions(req));
        res.json({ success: true });
    } catch (err) {
        if (err.status && err.status < 500) {
            return res.status(401).json({ error: 'Uhm bad API key. Or it doesn\'t have Creator Events access. Remake it or try again?' });
        }
        console.error('Auth session creation failed:', err.message);
        res.status(500).json({ error: 'Failed to validate API key or create authenticated session' });
    }
});

async function requireAuth(req, res, next) {
    const token = req.cookies.auth_token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        req.user = await getSessionUser(token);
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired session' });
    }
}

async function getSessionUser(sessionId) {
    await sessionTableReady;
    const result = await pool.query(
        `SELECT username, encrypted_api_key
         FROM auth_sessions
         WHERE session_id = $1 AND expires_at > NOW()`,
        [sessionId]
    );
    if (result.rowCount === 0) throw new Error('Invalid or expired session');

    const session = result.rows[0];
    return {
        username: session.username,
        dashApiKey: decryptApiKey(session.encrypted_api_key)
    };
}

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ username: req.user.username });
});

app.get('/', async (req, res, next) => {
    if (!req.cookies.auth_token) return res.redirect('/setup.html');
    try {
        await getSessionUser(req.cookies.auth_token);
    } catch (err) {
        return res.redirect('/setup.html');
    }
    next();
});

async function validateWhitelist(playersString) {
    if (!playersString) return true;
    const players = playersString.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
    if (players.length === 0) return true;

    const result = await pool.query('SELECT players FROM odgroups');
    const dbPlayers = new Set();
    result.rows.forEach(row => {
        let groupPlayers = row.players;
        if (typeof groupPlayers === 'string') {
            try {
                groupPlayers = JSON.parse(groupPlayers);
            } catch (e) {
                groupPlayers = [];
            }
        }
        if (Array.isArray(groupPlayers)) {
            groupPlayers.forEach(p => {
                if (typeof p === 'string') {
                    dbPlayers.add(p.trim().toLowerCase());
                } else if (p && typeof p.username === 'string') {
                    dbPlayers.add(p.username.trim().toLowerCase());
                }
            });
        }
    });

    // Validates if player is in odgroups OR allows valid player format
    for (const p of players) {
        if (!dbPlayers.has(p) && !/^[a-zA-Z0-9_.-]+$/.test(p)) return false;
    }
    return true;
}
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function requestApi(url, options, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const response = await fetch(url, options);
        
        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : (1000 * Math.pow(2, attempt));
            
            console.warn(`[Rate Limit] Orion API returned 429 for ${url}. Retrying in ${waitTime}ms (Attempt ${attempt + 1}/${maxRetries}).`);
            await delay(waitTime);
            continue; 
        }
        
        if (!response.ok) {
            const error = new Error(`Orion API returned ${response.status}`);
            error.status = response.status;
            error.body = await response.text();
            throw error;
        }
        
        return response; // Success
    }
    
    const error = new Error(`Orion API request failed after ${maxRetries} retries due to rate limiting.`);
    error.status = 429;
    throw error;
}

function sendOrionError(res, route, error) {
    console.error(`${route} failed:`, error.message, error.body || '');
    res.status(error.status && error.status >= 400 && error.status < 500 ? error.status : 502).json({
        error: 'Orion Drift API request failed',
        status: error.status || 502,
        details: error.body || error.message
    });
}

app.get('/api/groups', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM odgroups');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/groups', requireAuth, async (req, res) => {
    try {
        const { name, players } = req.body;
        const result = await pool.query(
            'INSERT INTO odgroups (name, players) VALUES ($1, $2) RETURNING *',
            [name, JSON.stringify(players)]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.put('/api/groups/:id', requireAuth, async (req, res) => {
    try {
        const { name, players } = req.body;
        const result = await pool.query(
            'UPDATE odgroups SET name = $1, players = $2 WHERE id = $3 RETURNING *',
            [name, JSON.stringify(players), req.params.id]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/groups/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM odgroups WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/stations', requireAuth, async (req, res) => {
    try {
        const response = await requestApi(`${API_BASE}/v1/fleets/${FLEET_ID}`, { headers: getHeaders(req) });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        sendOrionError(res, 'Fetching stations', error);
    }
});

app.get('/api/stations/:id/config', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const [fullRes, stationRes] = await Promise.all([
            requestApi(`${API_BASE}/v2/stations/${id}/config?include_fleet_config=true`, { headers: getHeaders(req) }),
            requestApi(`${API_BASE}/v2/stations/${id}/config?include_fleet_config=false`, { headers: getHeaders(req) })
        ]);
        
        const fullConfig = await fullRes.json();
        const stationConfig = await stationRes.json();
        
        res.json({ fullConfig, stationConfig });
    } catch (error) {
        sendOrionError(res, 'Fetching station config', error);
    }
});

app.get('/api/fleet/config', requireAuth, async (req, res) => {
    try {
        const response = await requestApi(`${API_BASE}/v1/fleets/${FLEET_ID}/config`, { headers: getHeaders(req) });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        sendOrionError(res, 'Fetching fleet config', error);
    }
});

app.post('/api/fleet/update', requireAuth, async (req, res) => {
    try {
        const { fleetUpdates = {}, fleetDeletes = [] } = req.body;
        const cleanFleetUpdates = {};
        for (const [key, value] of Object.entries(fleetUpdates)) {
            cleanFleetUpdates[key] = typeof value === 'boolean' || typeof value === 'number' ? String(value) : value;
        }
        const allKeys = [...Object.keys(cleanFleetUpdates), ...fleetDeletes];
        for (const key of allKeys) {
            if (!validateKey(key)) {
                return res.status(403).json({ error: 'Unauthorized key modification.' });
            }
        }

        if (fleetDeletes.length > 0) {
            await requestApi(`${API_BASE}/v1/fleets/${FLEET_ID}/config`, {
                method: 'DELETE',
                headers: getHeaders(req),
                body: JSON.stringify(fleetDeletes)
            });
        }

        if (Object.keys(cleanFleetUpdates).length > 0) {
            await requestApi(`${API_BASE}/v1/fleets/${FLEET_ID}/config`, {
                method: 'POST',
                headers: getHeaders(req),
                body: JSON.stringify(cleanFleetUpdates)
            });
        }

        res.json({ success: true });
    } catch (error) {
        sendOrionError(res, 'Updating fleet config', error);
    }
});

app.post('/api/stations/:id/update', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            stationUpdates = {}, 
            stationDeletes = [], 
            fleetUpdates = {}, 
            fleetDeletes = [] 
        } = req.body;

        const allKeys = [...Object.keys(stationUpdates), ...stationDeletes, ...Object.keys(fleetUpdates), ...fleetDeletes];
        for (const key of allKeys) {
            if (!validateKey(key)) {
                return res.status(403).json({ error: 'Unauthorized key modification.' });
            }
        }

        if (!validateSpawnPointUpdate({ stationUpdates, fleetUpdates, stationDeletes, fleetDeletes })) {
            return res.status(403).json({ error: 'Invalid spawn point configuration.' });
        }

        const allUpdates = { ...stationUpdates, ...fleetUpdates };
        for (const [key, val] of Object.entries(allUpdates)) {
            if (isWhitelistPlayerListKey(key) && typeof val === 'string') {
                const valid = await validateWhitelist(val);
                if (!valid) {
                    return res.status(403).json({ error: 'Whitelisted players must exist in odgroups.' });
                }
            }
        }

        if (stationDeletes.length > 0) {
            await requestApi(`${API_BASE}/v2/stations/${id}/config`, {
                method: 'DELETE',
                headers: getHeaders(req),
                body: JSON.stringify(stationDeletes)
            });
        }

        if (Object.keys(stationUpdates).length > 0) {
            await requestApi(`${API_BASE}/v2/stations/${id}/config`, {
                method: 'POST',
                headers: getHeaders(req),
                body: JSON.stringify(stationUpdates)
            });
        }

        if (fleetDeletes.length > 0) {
            await requestApi(`${API_BASE}/v1/fleets/${FLEET_ID}/config`, {
                method: 'DELETE',
                headers: getHeaders(req),
                body: JSON.stringify(fleetDeletes)
            });
        }

        if (Object.keys(fleetUpdates).length > 0) {
            await requestApi(`${API_BASE}/v1/fleets/${FLEET_ID}/config`, {
                method: 'POST',
                headers: getHeaders(req),
                body: JSON.stringify(fleetUpdates)
            });
        }

        res.json({ success: true });
    } catch (error) {
        sendOrionError(res, 'Updating station config', error);
    }
});

app.get('/api/players/search', playerSearchLimiter, requireAuth, async (req, res) => {
    try {
        const search = req.query.q || '';
        const response = await requestApi(`${API_BASE}/v3/fleets/${FLEET_ID}/users?include_roles=true&page_size=16&page=1&search_string=${encodeURIComponent(search)}`, { headers: getHeaders(req) });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        sendOrionError(res, 'Searching players', error);
    }
});

app.get('/api/players/:id/roles', requireAuth, async (req, res) => {
    try {
        const response = await requestApi(`${API_BASE}/v1/fleets/${FLEET_ID}/users/${req.params.id}/roles`, { headers: getHeaders(req) });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        sendOrionError(res, 'Fetching user roles', error);
    }
});

app.get('/api/roles', requireAuth, async (req, res) => {
    try {
        const response = await requestApi(`${API_BASE}/v1/fleets/${FLEET_ID}/roles`, { headers: getHeaders(req) });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        sendOrionError(res, 'Fetching roles', error);
    }
});

app.post('/api/players/:id/roles/:roleId', requireAuth, async (req, res) => {
    try {
        const rolesResponse = await requestApi(`${API_BASE}/v1/fleets/${FLEET_ID}/roles`, { headers: getHeaders(req) });
        const rolesData = await rolesResponse.json();
        const targetRole = rolesData.roles.find(r => r.role_id === req.params.roleId);

        if (!targetRole) {
            return res.status(404).json({ error: 'Role not found' });
        }

        const rolePerms = Array.isArray(targetRole.permissions) ? targetRole.permissions : [];
        const restrictedPerms = rolePerms.filter(permission => 
            !ALLOWED_ROLE_PERMISSIONS.has(String(permission).trim().toLowerCase())
        );

        if (restrictedPerms.length > 0) {
            return res.status(403).json({ 
                error: `Cannot assign role with restricted permissions: ${restrictedPerms.join(', ')}. Allowed: ${Array.from(ALLOWED_ROLE_PERMISSIONS).join(', ')}`
            });
        }

        const response = await requestApi(`${API_BASE}/v1/fleets/${FLEET_ID}/users/${req.params.id}/roles/${req.params.roleId}`, { 
            method: 'POST',
            headers: getHeaders(req) 
        });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        sendOrionError(res, 'Adding role', error);
    }
});

app.delete('/api/players/:id/roles/:roleId', requireAuth, async (req, res) => {
    try {
        const response = await requestApi(`${API_BASE}/v1/fleets/${FLEET_ID}/users/${req.params.id}/role/${req.params.roleId}`, { 
            method: 'DELETE',
            headers: getHeaders(req) 
        });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        sendOrionError(res, 'Removing role', error);
    }
});

app.use(requireAuth);
app.use(express.static(require('path').join(__dirname, 'public')));

module.exports = app;

if (require.main === module) {
    app.listen(process.env.PORT || 3000, () => {
        console.log(`Dashboard listening on port ${process.env.PORT || 3000}`);
    });
}