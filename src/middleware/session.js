// Simple in-memory session storage (use Redis in production)
const sessionStore = new Map();

const sessionMiddleware = (req, res, next) => {
    const sessionId = req.headers['session-id'] || req.body.sessionId;
    
    if (sessionId && sessionStore.has(sessionId)) {
        req.session = sessionStore.get(sessionId);
    } else {
        const newSessionId = generateSessionId();
        req.session = { id: newSessionId };
        sessionStore.set(newSessionId, req.session);
        res.setHeader('Session-Id', newSessionId);
    }
    
    next();
};

const generateSessionId = () => {
    return 'session_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
};

const saveSession = (sessionId, data) => {
    if (sessionStore.has(sessionId)) {
        sessionStore.set(sessionId, { ...sessionStore.get(sessionId), ...data });
    }
};

const getSession = (sessionId) => {
    return sessionStore.get(sessionId);
};

module.exports = { sessionMiddleware, saveSession, getSession };