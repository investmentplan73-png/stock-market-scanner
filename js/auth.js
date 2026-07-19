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
            const name = this.currentUser.name || this.currentUser.email || '';
            let expiryText = '';
            if (this.currentUser.expiryDate) {
                const expDate = new Date(this.currentUser.expiryDate);
                const now = new Date();
                const daysLeft = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
                const dateStr = expDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
                if (daysLeft <= 7) {
                    expiryText = ` | Expires: ${dateStr} (${daysLeft}d left ⚠️)`;
                } else {
                    expiryText = ` | Expires: ${dateStr}`;
                }
            }
            userEl.innerHTML = `${name}<span style="font-size:10px;color:#6b7b8f;margin-left:6px">${expiryText}</span>`;
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

// Toggle login requirement from inside the app
async function toggleLoginFromApp() {
    const adminPass = prompt('Enter Admin Password to toggle login:');
    if (!adminPass) return;

    try {
        // First check current status
        const settingsRes = await fetch(`${Auth.getProxyBase()}/api/admin/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminPassword: adminPass })
        });
        const settings = await settingsRes.json();
        if (!settings.success) {
            alert('Wrong admin password!');
            return;
        }

        const currentStatus = settings.loginRequired !== false;
        const newStatus = !currentStatus;

        const res = await fetch(`${Auth.getProxyBase()}/api/admin/toggle-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminPassword: adminPass, enabled: newStatus })
        });
        const data = await res.json();
        if (data.success) {
            const btn = document.getElementById('loginToggleAppBtn');
            if (btn) {
                btn.textContent = newStatus ? 'Login: ON' : 'Login: OFF';
                btn.style.background = newStatus ? '#f59e0b' : '#64748b';
            }
            alert(newStatus ? 'Login ON - users must login now' : 'Login OFF - app opens directly');
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

// Update login toggle button status on load
async function updateLoginToggleButton() {
    try {
        const res = await fetch(`${Auth.getProxyBase()}/api/auth/check-login-required`);
        const data = await res.json();
        const btn = document.getElementById('loginToggleAppBtn');
        if (btn) {
            const isOn = data.loginRequired !== false;
            btn.textContent = isOn ? 'Login: ON' : 'Login: OFF';
            btn.style.background = isOn ? '#f59e0b' : '#64748b';
        }
    } catch (e) {}
}
setTimeout(updateLoginToggleButton, 1000);

// ==================== CHANGE PASSWORD ====================

function showChangePasswordModal() {
    document.getElementById('changePasswordModal').classList.remove('hidden');
    document.getElementById('oldPassword').value = '';
    document.getElementById('newPassword1').value = '';
    document.getElementById('newPassword2').value = '';
    document.getElementById('changePassError').textContent = '';
    document.getElementById('changePassSuccess').textContent = '';
    document.getElementById('changePassSuccess').classList.add('hidden');
}

function closeChangePasswordModal() {
    document.getElementById('changePasswordModal').classList.add('hidden');
}

async function submitChangePassword() {
    const oldPass = document.getElementById('oldPassword').value;
    const newPass = document.getElementById('newPassword1').value;
    const confirmPass = document.getElementById('newPassword2').value;
    const errorEl = document.getElementById('changePassError');
    const successEl = document.getElementById('changePassSuccess');

    errorEl.textContent = '';
    successEl.textContent = '';
    successEl.classList.add('hidden');

    if (!oldPass || !newPass || !confirmPass) {
        errorEl.textContent = 'All fields are required';
        return;
    }

    if (newPass.length < 6) {
        errorEl.textContent = 'New password must be at least 6 characters';
        return;
    }

    if (newPass !== confirmPass) {
        errorEl.textContent = 'New passwords do not match';
        return;
    }

    if (oldPass === newPass) {
        errorEl.textContent = 'New password must be different from old password';
        return;
    }

    try {
        const session = Auth.getSession();
        const response = await fetch(`${Auth.getProxyBase()}/api/auth/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: session?.user?.id || '',
                oldPassword: oldPass,
                newPassword: newPass
            })
        });
        const data = await response.json();

        if (!data.success) {
            errorEl.textContent = data.message || 'Failed to change password';
            return;
        }

        successEl.textContent = '✓ Password changed successfully!';
        successEl.classList.remove('hidden');
        document.getElementById('oldPassword').value = '';
        document.getElementById('newPassword1').value = '';
        document.getElementById('newPassword2').value = '';

        setTimeout(() => closeChangePasswordModal(), 2000);
    } catch (error) {
        errorEl.textContent = 'Server error. Try again.';
    }
}
