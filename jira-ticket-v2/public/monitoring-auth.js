(function () {
    function ensureMonitoringSessionStyles() {
        if (document.getElementById('monitoring-session-profile-styles')) return;

        const style = document.createElement('style');
        style.id = 'monitoring-session-profile-styles';
        style.textContent = `
            [data-monitoring-session] { display: flex; justify-content: flex-end; margin-left: 1rem; margin-top: 1rem; position: relative; z-index: 30; }
            .monitoring-profile-panel { position: relative; display: inline-flex; align-items: center; gap: 0.85rem; max-width: 100%; }
            .monitoring-profile-trigger { display: inline-flex; align-items: center; gap: 0.85rem; min-width: 0; max-width: 100%; padding: 0.45rem 0.65rem 0.45rem 0.45rem; border-radius: 999px; border: 1px solid rgba(19, 49, 95, 0.12); background: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(241, 247, 255, 0.98) 100%); box-shadow: 0 10px 26px rgba(19, 49, 95, 0.08); color: inherit; cursor: pointer; transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease; }
            .monitoring-profile-trigger:hover, .monitoring-profile-trigger[aria-expanded="true"] { border-color: rgba(47, 111, 228, 0.28); box-shadow: 0 14px 30px rgba(19, 49, 95, 0.12); transform: translateY(-1px); }
            .monitoring-profile-avatar { width: 44px; height: 44px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #1e4f9c 0%, #5f9bff 100%); color: #ffffff; font-size: 0.95rem; font-weight: 700; letter-spacing: 0.04em; flex-shrink: 0; }
            .monitoring-profile-body { min-width: 0; display: flex; flex-direction: column; line-height: 1.2; text-align: left; }
            .monitoring-profile-name { color: #13315f; font-size: 0.9rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .monitoring-profile-scope { color: #5f738d; font-size: 0.74rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .monitoring-profile-caret { color: #5f738d; font-size: 0.78rem; flex-shrink: 0; }
            .monitoring-profile-menu { position: absolute; top: calc(100% + 0.6rem); right: 0; width: min(340px, calc(100vw - 2rem)); border: 1px solid rgba(19, 49, 95, 0.12); border-radius: 8px; background: #ffffff; box-shadow: 0 18px 42px rgba(19, 49, 95, 0.16); padding: 0.9rem; color: #13315f; }
            .monitoring-profile-menu[hidden], .monitoring-password-modal-backdrop[hidden] { display: none; }
            .monitoring-profile-menu-title { font-size: 0.74rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: #6b7d95; margin-bottom: 0.65rem; }
            .monitoring-profile-row { display: flex; justify-content: space-between; gap: 1rem; padding: 0.55rem 0; border-bottom: 1px solid rgba(19, 49, 95, 0.08); font-size: 0.82rem; }
            .monitoring-profile-row span:first-child { color: #6b7d95; font-weight: 700; }
            .monitoring-profile-row span:last-child { min-width: 0; color: #13315f; font-weight: 700; text-align: right; overflow-wrap: anywhere; }
            .monitoring-profile-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; margin-top: 0.85rem; }
            .monitoring-profile-action { border: 1px solid rgba(47, 111, 228, 0.18); border-radius: 8px; padding: 0.72rem 0.8rem; background: rgba(47, 111, 228, 0.08); color: #1e4f9c; font-size: 0.78rem; font-weight: 800; line-height: 1; transition: background-color 0.2s ease, color 0.2s ease, transform 0.2s ease; }
            .monitoring-profile-action:hover { background: rgba(47, 111, 228, 0.15); color: #13315f; transform: translateY(-1px); }
            .monitoring-profile-action.danger { border-color: rgba(214, 69, 69, 0.18); background: rgba(214, 69, 69, 0.08); color: #b42318; }
            .monitoring-profile-action.danger:hover { background: rgba(214, 69, 69, 0.15); color: #7a271a; }
            .monitoring-password-modal-backdrop { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 1rem; background: rgba(11, 31, 57, 0.48); z-index: 2000; }
            .monitoring-password-modal { width: min(440px, 100%); border-radius: 8px; background: #ffffff; box-shadow: 0 28px 80px rgba(11, 31, 57, 0.28); overflow: hidden; }
            .monitoring-password-modal-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 1.15rem; border-bottom: 1px solid rgba(19, 49, 95, 0.1); }
            .monitoring-password-modal-title { margin: 0; color: #13315f; font-size: 1rem; font-weight: 800; }
            .monitoring-password-modal-close { width: 36px; height: 36px; border: 1px solid rgba(19, 49, 95, 0.12); border-radius: 50%; background: #ffffff; color: #5f738d; font-size: 1.25rem; line-height: 1; }
            .monitoring-password-form { padding: 1.15rem; }
            .monitoring-password-field { margin-bottom: 0.9rem; }
            .monitoring-password-field label { display: block; margin-bottom: 0.35rem; color: #334e73; font-size: 0.82rem; font-weight: 800; }
            .monitoring-password-field input { width: 100%; min-height: 44px; border: 1px solid rgba(19, 49, 95, 0.16); border-radius: 8px; padding: 0.65rem 0.75rem; color: #13315f; font-size: 0.92rem; }
            .monitoring-password-field input:focus { outline: none; border-color: rgba(47, 111, 228, 0.55); box-shadow: 0 0 0 3px rgba(47, 111, 228, 0.12); }
            .monitoring-password-status { min-height: 1.2rem; margin: 0 0 0.9rem; font-size: 0.82rem; font-weight: 700; }
            .monitoring-password-status.success { color: #067647; }
            .monitoring-password-status.error { color: #b42318; }
            .monitoring-password-submit { width: 100%; min-height: 44px; border: none; border-radius: 8px; background: #1e4f9c; color: #ffffff; font-size: 0.9rem; font-weight: 800; }
            .monitoring-password-submit:disabled { cursor: not-allowed; opacity: 0.7; }
            @media (max-width: 991.98px) {
                [data-monitoring-session] { margin-left: 0; margin-top: 0.9rem; width: 100%; }
                .monitoring-profile-panel, .monitoring-profile-trigger { width: 100%; }
                .monitoring-profile-trigger { justify-content: space-between; }
                .monitoring-profile-menu { left: 0; right: auto; width: 100%; }
            }
        `;

        document.head.appendChild(style);
    }

    async function loadMonitoringSession() {
        const response = await fetch('/api/monitoring/session');
        if (!response.ok) {
            window.location.href = '/monitoring/monitoring-login.html';
            throw new Error('Monitoring session invalid');
        }

        const data = await response.json();
        window.monitoringSession = data.user;
        renderMonitoringSession(data.user);
        return data.user;
    }

    function renderMonitoringSession(user) {
        ensureMonitoringSessionStyles();

        document.querySelectorAll('[data-monitoring-session]').forEach((container, index) => {
            const scopeLabel = formatMonitoringRoleLabel(user.role);
            const countryLabel = user.accessCountryName || (hasGlobalMonitoringAccess(user) ? 'All countries' : '-');
            const displayName = user.displayName || user.email;
            const initials = getProfileInitials(displayName);
            const menuId = `monitoring-profile-menu-${index}`;

            container.innerHTML = `
                <div class="monitoring-profile-panel">
                    <button type="button" class="monitoring-profile-trigger" data-monitoring-profile-toggle aria-expanded="false" aria-controls="${menuId}">
                        <span class="monitoring-profile-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
                        <span class="monitoring-profile-body">
                            <span class="monitoring-profile-name">${escapeHtml(displayName)}</span>
                            <span class="monitoring-profile-scope">${escapeHtml(scopeLabel)}</span>
                        </span>
                        <span class="monitoring-profile-caret" aria-hidden="true">v</span>
                    </button>
                    <div class="monitoring-profile-menu" id="${menuId}" data-monitoring-profile-menu hidden>
                        <div class="monitoring-profile-menu-title">Account Profile</div>
                        <div class="monitoring-profile-row"><span>Name</span><span>${escapeHtml(displayName)}</span></div>
                        <div class="monitoring-profile-row"><span>Email</span><span>${escapeHtml(user.email)}</span></div>
                        <div class="monitoring-profile-row"><span>Role</span><span>${escapeHtml(scopeLabel)}</span></div>
                        <div class="monitoring-profile-row"><span>Access</span><span>${escapeHtml(countryLabel)}</span></div>
                        <div class="monitoring-profile-actions">
                            <button type="button" class="monitoring-profile-action" data-monitoring-password-open>Change Password</button>
                            <button type="button" class="monitoring-profile-action danger" data-monitoring-logout>Sign out</button>
                        </div>
                    </div>
                </div>
            `;
        });

        ensurePasswordModal();
        bindMonitoringProfileEvents();
    }

    function ensurePasswordModal() {
        if (document.getElementById('monitoring-password-modal')) return;

        const modal = document.createElement('div');
        modal.className = 'monitoring-password-modal-backdrop';
        modal.id = 'monitoring-password-modal';
        modal.hidden = true;
        modal.innerHTML = `
            <div class="monitoring-password-modal" role="dialog" aria-modal="true" aria-labelledby="monitoring-password-title">
                <div class="monitoring-password-modal-header">
                    <h2 class="monitoring-password-modal-title" id="monitoring-password-title">Change Password</h2>
                    <button type="button" class="monitoring-password-modal-close" data-monitoring-password-close aria-label="Close">&times;</button>
                </div>
                <form class="monitoring-password-form" id="monitoring-password-form">
                    <div class="monitoring-password-field">
                        <label for="monitoring-current-password">Current Password</label>
                        <input type="password" id="monitoring-current-password" autocomplete="current-password" required>
                    </div>
                    <div class="monitoring-password-field">
                        <label for="monitoring-new-password">New Password</label>
                        <input type="password" id="monitoring-new-password" autocomplete="new-password" minlength="8" required>
                    </div>
                    <div class="monitoring-password-field">
                        <label for="monitoring-confirm-password">Confirm New Password</label>
                        <input type="password" id="monitoring-confirm-password" autocomplete="new-password" minlength="8" required>
                    </div>
                    <p class="monitoring-password-status" id="monitoring-password-status" aria-live="polite"></p>
                    <button type="submit" class="monitoring-password-submit" id="monitoring-password-submit">Update Password</button>
                </form>
            </div>
        `;

        document.body.appendChild(modal);
    }

    function bindMonitoringProfileEvents() {
        document.querySelectorAll('[data-monitoring-profile-toggle]').forEach((button) => {
            if (button.dataset.bound === 'true') return;
            button.addEventListener('click', function (event) {
                event.stopPropagation();
                const panel = button.closest('.monitoring-profile-panel');
                const menu = panel?.querySelector('[data-monitoring-profile-menu]');
                const shouldOpen = menu?.hidden;
                closeProfileMenus();
                if (menu && shouldOpen) {
                    menu.hidden = false;
                    button.setAttribute('aria-expanded', 'true');
                }
            });
            button.dataset.bound = 'true';
        });

        document.querySelectorAll('[data-monitoring-password-open]').forEach((button) => {
            if (button.dataset.bound === 'true') return;
            button.addEventListener('click', function (event) {
                event.stopPropagation();
                closeProfileMenus();
                openPasswordModal();
            });
            button.dataset.bound = 'true';
        });

        document.querySelectorAll('[data-monitoring-logout]').forEach((button) => {
            if (button.dataset.bound === 'true') return;
            button.addEventListener('click', logoutMonitoringUser);
            button.dataset.bound = 'true';
        });

        document.querySelectorAll('[data-monitoring-password-close]').forEach((button) => {
            if (button.dataset.bound === 'true') return;
            button.addEventListener('click', closePasswordModal);
            button.dataset.bound = 'true';
        });

        const form = document.getElementById('monitoring-password-form');
        if (form && form.dataset.bound !== 'true') {
            form.addEventListener('submit', changeMonitoringPassword);
            form.dataset.bound = 'true';
        }

        const modal = document.getElementById('monitoring-password-modal');
        if (modal && modal.dataset.bound !== 'true') {
            modal.addEventListener('click', function (event) {
                if (event.target === modal) {
                    closePasswordModal();
                }
            });
            modal.dataset.bound = 'true';
        }
    }

    function closeProfileMenus() {
        document.querySelectorAll('[data-monitoring-profile-menu]').forEach((menu) => {
            menu.hidden = true;
        });

        document.querySelectorAll('[data-monitoring-profile-toggle]').forEach((button) => {
            button.setAttribute('aria-expanded', 'false');
        });
    }

    function openPasswordModal() {
        const modal = document.getElementById('monitoring-password-modal');
        const form = document.getElementById('monitoring-password-form');
        const status = document.getElementById('monitoring-password-status');

        if (!modal || !form) return;

        form.reset();
        setPasswordStatus(status, '', '');
        modal.hidden = false;
        setTimeout(() => document.getElementById('monitoring-current-password')?.focus(), 0);
    }

    function closePasswordModal() {
        const modal = document.getElementById('monitoring-password-modal');
        if (modal) {
            modal.hidden = true;
        }
    }

    async function changeMonitoringPassword(event) {
        event.preventDefault();

        const currentPassword = document.getElementById('monitoring-current-password')?.value || '';
        const newPassword = document.getElementById('monitoring-new-password')?.value || '';
        const confirmPassword = document.getElementById('monitoring-confirm-password')?.value || '';
        const status = document.getElementById('monitoring-password-status');
        const submitButton = document.getElementById('monitoring-password-submit');

        if (newPassword.length < 8) {
            setPasswordStatus(status, 'New password must be at least 8 characters.', 'error');
            return;
        }

        if (newPassword !== confirmPassword) {
            setPasswordStatus(status, 'New password confirmation does not match.', 'error');
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = 'Updating...';
        setPasswordStatus(status, '', '');

        try {
            const response = await fetch('/api/monitoring/change-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ currentPassword, newPassword })
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                setPasswordStatus(status, data.message || 'Failed to update password.', 'error');
                return;
            }

            if (data.user) {
                window.monitoringSession = data.user;
            }

            setPasswordStatus(status, data.message || 'Password updated successfully.', 'success');
            setTimeout(closePasswordModal, 900);
        } catch (error) {
            console.error('Monitoring change password error:', error);
            setPasswordStatus(status, 'An error occurred while updating the password.', 'error');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Update Password';
        }
    }

    function setPasswordStatus(element, message, type) {
        if (!element) return;

        element.textContent = message;
        element.classList.remove('success', 'error');
        if (type) {
            element.classList.add(type);
        }
    }

    function formatMonitoringRoleLabel(role) {
        const normalizedRole = String(role || '').trim().toLowerCase();

        switch (normalizedRole) {
            case 'super_admin':
                return 'Super Admin';
            case 'admin':
                return 'Admin';
            case 'user':
                return 'User';
            default:
                return normalizedRole
                    ? normalizedRole
                        .split('_')
                        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                        .join(' ')
                    : 'User';
        }
    }

    function hasGlobalMonitoringAccess(user) {
        return !!user && (user.role === 'admin' || user.role === 'super_admin');
    }

    function getProfileInitials(value) {
        const parts = String(value || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean);

        if (!parts.length) {
            return 'RW';
        }

        if (parts.length === 1) {
            return parts[0].slice(0, 2).toUpperCase();
        }

        return parts
            .slice(0, 2)
            .map((part) => part.charAt(0).toUpperCase())
            .join('');
    }

    async function logoutMonitoringUser() {
        try {
            await fetch('/api/monitoring/logout', { method: 'POST' });
        } catch (error) {
            console.error('Monitoring logout error:', error);
        } finally {
            window.location.href = '/monitoring/monitoring-login.html';
        }
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    document.addEventListener('click', closeProfileMenus);
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            closeProfileMenus();
            closePasswordModal();
        }
    });

    window.monitoringSessionReady = loadMonitoringSession();
})();
