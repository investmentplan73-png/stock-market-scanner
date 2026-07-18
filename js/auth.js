// User Authentication System
// Handles login, signup, session management via local server API.
const Auth = {
    currentUser: null,
    sessionKey: 'authSession',

    init: async function() {
        // Check if login is required (admin can disable it)
        try {
            const res = await fetch(`${this.getProxyBase()}/api/auth/check-login-required`);
            const data = await res.json();
            if (data.loginRequired === false) {
                // Login disabled by admin - go directly to app
                this.currentUser = { name: 'Guest', email: '' };
                this.showApp();
                return;
            }
        } catch (e) {
            // If server not reachable, show login anyway
        }

        const session = this.getSession();
        if (session && session.token && session.user) {
            this.currentUser = session.user;
            this.showApp();
            return;
        }
        this.showAuth();
    },

    getSession: function() {
        try {
            return JSON.parse(localStorage.getItem(this.sessionKey) || 'null');
        } catch (e) {
            return null;
        }
    },

    saveSession: function(user, token) {
        this.currentUser = user;
        localStorage.setItem(this.sessionKey, JSON.stringify({ user, token }));
    },

    clearSession: function() {
        this.currentUser = null;
        localStorage.removeItem(this.sessionKey);
    },

    showAuth: function() {
        document.getElementById('authContainer').classList.remove('hidden');
        document.getElementById('appContainer').classList.add('hidden');
    },

    showApp: function() {
        document.getElementById('authContainer').classList.add('hidden');
        document.getElementById('appContainer').classList.remove('hidden');
        const userEl = document.getElementById('loggedInUser');
        if (userEl && this.currentUser) {
            userEl.textContent = this.currentUser.name || this.currentUser.email || '';
        }
    },

    getProxyBase: function() {
        if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
            return window.location.origin;
        }
        return 'http://localhost:8787';
    },

    login: async function(email, password) {
        const response = await fetch(`${this.getProxyBase()}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim(), password })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Login failed');
        }
        this.saveSession(data.user, data.token);
        return data.user;
    },

    signup: async function(name, email, mobile, password) {
        const response = await fetch(`${this.getProxyBase()}/api/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name.trim(),
                email: email.trim().toLowerCase(),
                mobile: mobile.trim(),
                password
            })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Signup failed');
        }
        this.saveSession(data.user, data.token);
        return data.user;
    },

    logout: function() {
        this.clearSession();
        this.showAuth();
        // Stop market data if running
        if (typeof stopMarketDataUpdates === 'function') {
            stopMarketDataUpdates();
        }
    }
};

// UI Handlers
function showLoginForm() {
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('signupForm').classList.add('hidden');
    document.getElementById('loginError').textContent = '';
}

function showSignupForm() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('signupForm').classList.remove('hidden');
    document.getElementById('signupError').textContent = '';
}

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');

    errorEl.textContent = '';
    btn.textContent = 'Logging in...';
    btn.disabled = true;

    try {
        await Auth.login(email, password);
        Auth.showApp();
    } catch (error) {
        errorEl.textContent = error.message;
    } finally {
        btn.textContent = 'Login';
        btn.disabled = false;
    }
    return false;
}

async function handleSignup(event) {
    event.preventDefault();
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const mobile = document.getElementById('signupMobile').value;
    const password = document.getElementById('signupPassword').value;
    const confirm = document.getElementById('signupConfirm').value;
    const errorEl = document.getElementById('signupError');
    const btn = document.getElementById('signupBtn');

    errorEl.textContent = '';

    if (password !== confirm) {
        errorEl.textContent = 'Passwords do not match';
        return false;
    }

    if (password.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters';
        return false;
    }

    btn.textContent = 'Creating account...';
    btn.disabled = true;

    try {
        await Auth.signup(name, email, mobile, password);
        Auth.showApp();
    } catch (error) {
        errorEl.textContent = error.message;
    } finally {
        btn.textContent = 'Create Account';
        btn.disabled = false;
    }
    return false;
}

function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        Auth.logout();
    }
}

// Initialize auth on page load
document.addEventListener('DOMContentLoaded', function() {
    Auth.init();
});
