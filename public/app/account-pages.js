/* PatWaGo Account Pages — commercial account UI renderer/client.
 * New file only. Vanilla browser JS (no build step, no external deps).
 * Exposes window.PatWaGoAccountPages with render functions for:
 *   - onboarding
 *   - auth (register / login)
 *   - trial status / paywall
 *   - checkout
 *   - profile / account
 * plus mount() to wire into a host container and helpers (toast, escapeHtml, jsonFetch).
 * Design matches PatWaGo black/gold system. Mobile-first. Accessible (aria, focus-visible).
 * No inline secrets — all network calls go through the parent app's relative /api/ endpoints.
 */
(function () {
  'use strict';

  var ROOT_ID = 'patwago-account';

  /* ---------- helpers ---------- */

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(message, error) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var node = document.createElement('div');
    node.className = 'toast' + (error ? ' error' : '');
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.textContent = String(message || '');
    document.body.appendChild(node);
    setTimeout(function () { node.remove(); }, 3500);
    return node;
  }

  function jsonFetch(url, options) {
    options = options || {};
    return fetch(url, options).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || payload.ok === false) throw new Error(payload.message || 'Request failed');
        return payload;
      });
    });
  }

  function initials(email) {
    var base = String(email || '?').split('@')[0];
    var parts = base.split(/[.\s_-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (base[0] || '?').toUpperCase();
  }

  function planLabel(plan) {
    var p = String(plan || 'day').toLowerCase();
    var map = { day: 'Day Pass', week: 'Week Pass', trip: 'Trip Pass', month: 'Month Pass', year: 'Annual Pass' };
    return map[p] || (p.charAt(0).toUpperCase() + p.slice(1) + ' Pass');
  }

  function money(amount) {
    var n = Number(amount || 0);
    return n.toFixed(2);
  }

  /* Apple Guideline 3.1.1: the native iOS wrapper (ios/PatWaGoApp) injects
   * window.PatWaGoNative = { platform: 'ios' } before this script runs, via
   * a WKUserScript at document-start, so pass purchases route to Apple
   * In-App Purchase instead of PayPal. On the plain website this stays
   * undefined/false. The server also refuses PayPal pass purchases from
   * any client that sends the X-Patwago-Client: ios-app header (server.js). */
  function isIosNativeApp() {
    return Boolean(window.PatWaGoNative && window.PatWaGoNative.platform === 'ios');
  }

  // currentMount tracks the last mount() call so the native-purchase
  // completion callbacks below (invoked by Swift via evaluateJavaScript,
  // not by any click inside this page) know where to re-render.
  var currentMount = null;

  /* Ask the native shell to run the real StoreKit 2 purchase UI for `plan`.
   * ios/PatWaGoApp/Sources/App/WebView.swift registers "patwagoIAP" as a
   * WKScriptMessageHandler and calls IAPManager.purchase(for:) on receipt.
   * Returns false (and the caller should fall back to an error message) if
   * no native bridge is present — e.g. a bug where isIosNativeApp() is true
   * but the message handler wasn't registered. */
  function requestNativePurchase(plan) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.patwagoIAP) {
      window.webkit.messageHandlers.patwagoIAP.postMessage({ plan: plan });
      return true;
    }
    return false;
  }

  /* Called by IAPManager.swift (via evaluateJavaScript) after StoreKit
   * reports a successful purchase. signedTransactionInfo is the JWS from
   * Transaction.jwsRepresentation; the server independently verifies it
   * (lib/appstore.js) before crediting a pass — the app never trusts its
   * own claim that a purchase succeeded. */
  function handleNativePurchaseComplete(plan, signedTransactionInfo) {
    jsonFetch('/api/appstore/verify-purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTransactionInfo: signedTransactionInfo }),
    }).then(function () {
      toast('Purchase complete. Your pass is active.');
      if (currentMount) bootstrapProfile(currentMount.container, currentMount.opts);
    }).catch(function (err) {
      toast(err.message || 'Your purchase went through with Apple but PatWaGo could not activate it. Contact support.', true);
    });
  }

  /* Called by IAPManager.swift when the user cancels or StoreKit reports a
   * failure — includes plain "user tapped Cancel", which is not an error. */
  function handleNativePurchaseFailed(plan, message) {
    if (message) toast(message, true);
  }

  window.PatWaGoNative = window.PatWaGoNative || {};
  window.PatWaGoNative.onPurchaseComplete = handleNativePurchaseComplete;
  window.PatWaGoNative.onPurchaseFailed = handleNativePurchaseFailed;

  /* ---------- renderers (return HTML strings) ---------- */

  function renderOnboarding() {
    var steps = [
      { n: 1, t: 'Create your account', d: 'Sign up with your email — no credit card needed to start.' },
      { n: 2, t: 'Start your free trial', d: 'Full access to translation, vendors, trips, and Guardian Mode for 7 days.' },
      { n: 3, t: 'Pick a pass', d: 'When the trial ends, choose the Day, Week, or Trip pass that fits your travel.' },
    ];
    var stepsHtml = steps.map(function (s) {
      return '<div class="onboard-step" role="listitem"><div class="num" aria-label="Step ' + s.n + '">' + s.n + '</div><div><strong>' + escapeHtml(s.t) + '</strong><span>' + escapeHtml(s.d) + '</span></div></div>';
    }).join('');

    return '' +
      '<section class="account-shell" aria-label="PatWaGo account onboarding" role="region">' +
        '<div class="account-head">' +
          '<span class="eyebrow">Welcome to PatWaGo</span>' +
          '<h1>Start your Jamaica journey</h1>' +
          '<p>Three quick steps and you\'re ready to translate, book verified vendors, plan trips, and stay safe with Guardian Mode.</p>' +
        '</div>' +
        '<div class="onboard-stepper" role="list" aria-label="Onboarding steps">' + stepsHtml + '</div>' +
        '<button class="btn btn-gold btn-block" data-account-action="auth" aria-label="Create your PatWaGo account">Create account</button>' +
        '<p class="auth-hint" style="margin-top:14px;text-align:center">Already have an account? <a href="#" data-account-action="login" style="color:#ffd400;font-weight:700">Sign in</a></p>' +
      '</section>';
  }

  function renderAuth(opts) {
    opts = opts || {};
    var mode = opts.mode === 'login' ? 'login' : 'register';
    var isRegister = mode === 'register';
    var title = isRegister ? 'Create your account' : 'Welcome back';
    var eyebrow = isRegister ? 'Sign up' : 'Sign in';
    var cta = isRegister ? 'Create account' : 'Sign in';
    var alt = isRegister ? 'Already have an account? Sign in' : 'New to PatWaGo? Create account';
    var altAction = isRegister ? 'login' : 'register';

    var nameField = isRegister
      ? '<div class="field"><label for="pw-name">Name</label><input id="pw-name" name="name" type="text" autocomplete="name" placeholder="Your name" aria-label="Your name" required></div>'
      : '';

    var formId = 'pw-auth-form';

    return '' +
      '<section class="account-shell" aria-label="PatWaGo ' + (isRegister ? 'registration' : 'login') + '" role="region">' +
        '<div class="account-head">' +
          '<span class="eyebrow">' + eyebrow + '</span>' +
          '<h1>' + escapeHtml(title) + '</h1>' +
          '<p>' + (isRegister ? 'Start your 7-day free trial. No credit card required.' : 'Sign in to access your pass, trips, and Guardian Mode.') + '</p>' +
        '</div>' +
        '<div class="auth-card glass">' +
          '<div class="auth-tabs" role="tablist" aria-label="Account mode">' +
            '<button class="auth-tab' + (isRegister ? ' active' : '') + '" role="tab" aria-selected="' + (isRegister ? 'true' : 'false') + '" data-account-mode="register" aria-label="Register a new account">Register</button>' +
            '<button class="auth-tab' + (!isRegister ? ' active' : '') + '" role="tab" aria-selected="' + (!isRegister ? 'true' : 'false') + '" data-account-mode="login" aria-label="Sign in to your account">Sign in</button>' +
          '</div>' +
          '<form id="' + formId + '" class="auth-form" data-account-action="submit-auth" novalidate>' +
            nameField +
            '<div class="field"><label for="pw-email">Email</label><input id="pw-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" aria-label="Email address" required></div>' +
            '<div class="field"><label for="pw-password">Password</label><input id="pw-password" name="password" type="password" autocomplete="' + (isRegister ? 'new-password' : 'current-password') + '" placeholder="At least 8 characters" aria-label="Password" minlength="8" required></div>' +
            (isRegister ? '<div class="field"><label for="pw-confirm">Confirm password</label><input id="pw-confirm" name="confirm" type="password" autocomplete="new-password" placeholder="Re-enter password" aria-label="Confirm password" minlength="8" required></div>' : '') +
            '<p class="auth-hint" id="pw-auth-error" role="alert" hidden></p>' +
            '<button type="submit" class="btn btn-gold btn-block" aria-label="' + escapeHtml(cta) + '">' + escapeHtml(cta) + '</button>' +
          '</form>' +
        '</div>' +
        '<p class="auth-hint" style="margin-top:14px;text-align:center"><a href="#" data-account-action="' + altAction + '" style="color:#ffd400;font-weight:700">' + escapeHtml(alt) + '</a></p>' +
      '</section>';
  }

  function renderTrialStatus(opts) {
    opts = opts || {};
    var days = Number(opts.daysRemaining != null ? opts.daysRemaining : 0);
    var total = Number(opts.totalDays != null ? opts.totalDays : 7);
    var pct = total > 0 ? Math.max(0, Math.min(1, days / total)) : 0;
    var deg = Math.round(pct * 360);

    var plans = opts.plans || [
      { id: 'day', name: 'Day Pass', price: '$9.99', features: ['24-hour full access', 'Translation + vendors', 'Guardian Mode'] },
      { id: 'week', name: 'Week Pass', price: '$29.99', features: ['7 days of access', 'Unlimited itineraries', 'Priority vendor matching'] },
      { id: 'trip', name: 'Trip Pass', price: '$49.99', features: ['Up to 14 days', 'AI voice concierge', 'All premium features'] },
    ];

    var planHtml = plans.map(function (p) {
      var feats = (p.features || []).map(function (f) { return '<li>' + escapeHtml(f) + '</li>'; }).join('');
      return '<div class="plan-card" role="article" aria-label="' + escapeHtml(p.name) + '">' +
        '<div class="plan-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="plan-price">' + escapeHtml(money(p.price.replace ? p.price.replace('$', '') : p.price)) + '</div>' +
        '<ul class="plan-features">' + feats + '</ul>' +
        '<button class="btn btn-gold" data-account-action="checkout" data-plan="' + escapeHtml(p.id) + '" data-amount="' + escapeHtml(String(p.price).replace(/[^0-9.]/g, '')) + '" aria-label="Choose ' + escapeHtml(p.name) + '">Choose ' + escapeHtml(p.name) + '</button>' +
      '</div>';
    }).join('');

    var heading = days <= 0 ? 'Your trial has ended' : (days === 1 ? '1 day left in your trial' : days + ' days left in your trial');

    return '' +
      '<section class="account-shell" aria-label="PatWaGo trial status and upgrade options" role="region">' +
        '<div class="trial-card glass">' +
          '<div class="trial-ring" style="--trial-deg:' + deg + '" role="img" aria-label="' + days + ' of ' + total + ' trial days remaining">' +
            '<div style="display:grid;place-items:center;height:100%;position:relative;z-index:1">' +
              '<strong>' + days + '</strong>' +
              '<span>of ' + total + ' days</span>' +
            '</div>' +
          '</div>' +
          '<h2>' + escapeHtml(heading) + '</h2>' +
          '<p class="muted">' + (days > 0 ? 'Pick a pass to keep full access when your trial ends.' : 'Choose a pass below to restore full access.') + '</p>' +
          '<div class="plan-grid" role="list" aria-label="Available passes">' + planHtml + '</div>' +
        '</div>' +
      '</section>';
  }

  function renderCheckout(opts) {
    opts = opts || {};
    var plan = opts.plan || 'day';
    var amount = money(opts.amount != null ? opts.amount : 0);
    var orderId = opts.orderId || opts.order_id || '';
    var status = opts.status || (orderId ? 'awaiting' : 'awaiting');
    var statusLabel = status === 'completed' ? 'Completed' : 'Awaiting approval';
    var description = opts.description || (planLabel(plan) + ' — full PatWaGo access');

    return '' +
      '<section class="account-shell" aria-label="PatWaGo checkout" role="region">' +
        '<div class="account-head">' +
          '<span class="eyebrow">Checkout</span>' +
          '<h1>Complete your purchase</h1>' +
        '</div>' +
        '<div class="checkout-card glass">' +
          '<span class="checkout-status ' + escapeHtml(status) + '" role="status">' + escapeHtml(statusLabel) + '</span>' +
          '<div class="checkout-row"><span>Pass</span><strong>' + escapeHtml(planLabel(plan)) + '</strong></div>' +
          '<div class="checkout-row"><span>Amount</span><strong>$' + escapeHtml(amount) + '</strong></div>' +
          (orderId ? '<div class="checkout-row"><span>Order</span><strong>' + escapeHtml(orderId) + '</strong></div>' : '') +
          '<div class="checkout-row"><span>Description</span><strong>' + escapeHtml(description) + '</strong></div>' +
          '<div class="checkout-total"><span>Total</span><strong>$' + escapeHtml(amount) + '</strong></div>' +
          (status === 'completed'
            ? '<p class="auth-hint" role="status">Your payment is complete. Your pass is now active.</p>'
            : '<form data-account-action="submit-checkout" data-order-id="' + escapeHtml(orderId) + '" novalidate>' +
              '<div class="field"><label for="pw-buyer">Buyer name or email (optional)</label><input id="pw-buyer" name="buyer" type="text" autocomplete="name" placeholder="You" aria-label="Buyer name or email"></div>' +
              '<button type="submit" class="btn btn-gold btn-block" aria-label="Confirm checkout and pay">Confirm checkout</button>' +
            '</form>') +
          '<div class="checkout-actions">' +
            '<a class="btn btn-ghost" href="/app/account" aria-label="Back to account">Back to account</a>' +
            '<a class="btn btn-ghost" href="/api/health" aria-label="Check API health">API health</a>' +
          '</div>' +
        '</div>' +
      '</section>';
  }

  function renderProfile(opts) {
    opts = opts || {};
    var email = opts.email || 'traveler@example.com';
    var plan = opts.plan || 'day';
    var active = opts.passActive !== false;
    var avatar = initials(email);

    return '' +
      '<section class="account-shell" aria-label="PatWaGo profile and account" role="region">' +
        '<div class="account-head">' +
          '<span class="eyebrow">Your Profile</span>' +
          '<h1>Pass &amp; account</h1>' +
        '</div>' +
        '<div class="profile-card glass">' +
          '<div class="profile-pass">' +
            '<div class="profile-avatar" aria-label="Account avatar" role="img">' + escapeHtml(avatar) + '</div>' +
            '<div class="profile-info"><strong>' + escapeHtml(email) + '</strong><span>' + escapeHtml(planLabel(plan)) + '</span></div>' +
          '</div>' +
          '<div class="profile-pass">' +
            '<span class="pass-badge">' + escapeHtml(planLabel(plan)) + '</span>' +
            (active
              ? '<span class="pass-active" role="status">Active</span>'
              : '<span class="pass-expired" role="status">Expired</span>') +
          '</div>' +
          '<p class="muted" style="color:#a7a79f;margin:0">' + (active ? 'Full access to translation, vendors, trips, and Guardian Mode.' : 'Your pass has expired. Choose a new pass to restore access.') + '</p>' +
          '<div class="profile-links" role="navigation" aria-label="Account quick links">' +
            '<a href="/app/translate" class="glass" aria-label="Translate Patois">🗣️ Translate</a>' +
            '<a href="/app/vendors" class="glass" aria-label="Browse vendors">🏪 Vendors</a>' +
            '<a href="/app/trips" class="glass" aria-label="Plan a trip">🗺️ Trips</a>' +
            '<a href="/app/guardian" class="glass" aria-label="Guardian Mode">🛡️ Guardian</a>' +
            (active
              ? '<button class="glass" data-account-action="manage" aria-label="Manage your pass" style="border:0;color:#f8f5e8;cursor:pointer;font:inherit;text-align:left">Manage pass →</button>'
              : '<button class="btn btn-gold" data-account-action="checkout" data-plan="' + escapeHtml(plan) + '" data-amount="9.99" aria-label="Renew your pass">Renew pass →</button>') +
            '<a href="/" class="glass" aria-label="Back to PatWaGo home">← Home</a>' +
          '</div>' +
          '<button class="btn btn-ghost btn-block" data-account-action="logout" style="margin-top:8px" aria-label="Sign out of your account">Sign out</button>' +
          '<button class="btn btn-ghost btn-block" data-account-action="delete-account" style="margin-top:8px;color:#ff9090" aria-label="Delete your account">Delete account</button>' +
        '</div>' +
      '</section>';
  }

  function renderDeleteConfirm(opts) {
    opts = opts || {};
    var email = opts.email || 'traveler@example.com';
    return '' +
      '<section class="account-shell" aria-label="Delete PatWaGo account" role="region">' +
        '<div class="account-head">' +
          '<span class="eyebrow">Delete account</span>' +
          '<h1>This can&rsquo;t be undone</h1>' +
          '<p>Deleting <strong>' + escapeHtml(email) + '</strong> permanently removes your account, passes, trips, check-ins, and voice history. Confirm your password to continue.</p>' +
        '</div>' +
        '<div class="auth-card glass">' +
          '<form id="pw-delete-form" class="auth-form" data-account-action="submit-delete" novalidate>' +
            '<div class="field"><label for="pw-delete-password">Password</label><input id="pw-delete-password" name="password" type="password" autocomplete="current-password" placeholder="Current password" aria-label="Current password" required></div>' +
            '<p class="auth-hint" id="pw-delete-error" role="alert" hidden></p>' +
            '<button type="submit" class="btn btn-gold btn-block" style="background:#ff9090" aria-label="Permanently delete my account">Permanently delete my account</button>' +
          '</form>' +
        '</div>' +
        '<p class="auth-hint" style="margin-top:14px;text-align:center"><a href="#" data-account-action="cancel-delete" style="color:#ffd400;font-weight:700">Cancel, keep my account</a></p>' +
      '</section>';
  }

  /* ---------- mount: wire renderers into a host container + delegate events ---------- */

  function mount(containerId, opts) {
    opts = opts || {};
    var container = document.getElementById(containerId);
    if (!container) {
      // fall back to body
      container = document.body;
    }
    currentMount = { container: container, opts: opts };
    var state = opts.state || 'onboarding';
    render(container, state, opts);
    if (state === 'profile') bootstrapProfile(container, opts);

    // delegate clicks for account actions
    container.addEventListener('click', function (event) {
      var target = event.target;
      var actionEl = target.closest ? target.closest('[data-account-action]') : null;
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-account-action');
      if (!action) return;
      handleAction(container, action, actionEl, opts, event);
    });

    // delegate form submits
    container.addEventListener('submit', function (event) {
      var form = event.target;
      if (!form || !form.matches || !form.matches('[data-account-action]')) return;
      var action = form.getAttribute('data-account-action');
      handleAction(container, action, form, opts, event);
    });

    return container;
  }

  /* /app/profile mounts state:"profile" with no customer data (the server
   * page is static markup). Load the real signed-in customer before
   * showing pass details or the delete-account action; bounce anonymous
   * visitors to sign in instead of showing a fake account. */
  function bootstrapProfile(container, opts) {
    jsonFetch('/api/account/me').then(function (payload) {
      var data = payload.data || {};
      var customer = data.customer || {};
      var passes = data.passes || [];
      // Mutate the shared opts object (not a copy) so later actions on this
      // page — delete-account, manage, cancel-delete — see the real
      // customer instead of the onboarding-time placeholder.
      opts.email = customer.email;
      opts.plan = passes.length ? passes[0].plan : 'day';
      opts.passActive = Boolean(data.active_pass);
      render(container, 'profile', opts);
    }).catch(function () {
      window.location.href = '/account/login';
    });
  }

  function render(container, state, opts) {
    var html;
    switch (state) {
      case 'auth':
        html = renderAuth(opts);
        break;
      case 'trial':
        html = renderTrialStatus(opts);
        break;
      case 'checkout':
        html = renderCheckout(opts);
        break;
      case 'profile':
        html = renderProfile(opts);
        break;
      case 'delete-confirm':
        html = renderDeleteConfirm(opts);
        break;
      case 'onboarding':
      default:
        html = renderOnboarding();
        break;
    }
    container.innerHTML = html;
    container.setAttribute('data-account-state', state);
    return container;
  }

  function handleAction(container, action, el, opts, event) {
    if (event && event.preventDefault) event.preventDefault();
    switch (action) {
      case 'auth':
        render(container, 'auth', { mode: 'register' });
        break;
      case 'login':
        render(container, 'auth', { mode: 'login' });
        break;
      case 'register':
        render(container, 'auth', { mode: 'register' });
        break;
      case 'checkout': {
        var plan = el.getAttribute('data-plan') || 'day';
        var amount = el.getAttribute('data-amount') || '9.99';
        if (isIosNativeApp()) {
          // Apple Guideline 3.1.1: no external (PayPal) purchase path for
          // digital passes inside the native iOS app — hand off to
          // StoreKit via the native bridge; handleNativePurchaseComplete
          // picks the flow back up once Apple confirms the purchase.
          if (!requestNativePurchase(plan)) {
            toast('In-App Purchase is unavailable in this build.', true);
          }
          break;
        }
        // ask parent to create an order, then render checkout
        var onCheckout = opts.onCheckout || createOrderAndCheckout;
        Promise.resolve(onCheckout(plan, amount)).then(function (order) {
          render(container, 'checkout', {
            plan: order.plan || plan,
            amount: order.amount != null ? order.amount : amount,
            orderId: order.orderId || order.order_id || order.id,
            status: order.status,
          });
        }).catch(function (err) {
          toast(err.message || 'Could not start checkout', true);
        });
        break;
      }
      case 'submit-auth': {
        var data = readForm(el);
        if (!data.email || !data.password) {
          showFormError(el, 'Email and password are required.');
          return;
        }
        if (data.confirm != null && data.confirm !== data.password) {
          showFormError(el, 'Passwords do not match.');
          return;
        }
        var endpoint = data.name ? '/api/account/register' : '/api/account/login';
        jsonFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }).then(function () {
          toast(data.name ? 'Account created.' : 'Signed in.');
          if (opts.onAuth) opts.onAuth(data);
          render(container, 'profile', { email: data.email, plan: 'day', passActive: true });
        }).catch(function (err) {
          showFormError(el, err.message || 'Authentication failed.');
        });
        break;
      }
      case 'submit-checkout': {
        var orderId = el.getAttribute('data-order-id');
        var body = readForm(el);
        jsonFetch('/api/paypal/orders/' + encodeURIComponent(orderId) + '/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then(function (payload) {
          var order = (payload && payload.data) || {};
          toast('Payment complete. Your pass is active.');
          render(container, 'checkout', {
            plan: order.plan,
            amount: order.amount,
            orderId: order.id || orderId,
            status: 'completed',
          });
          if (opts.onPaid) opts.onPaid(order);
        }).catch(function (err) {
          toast(err.message || 'Payment failed', true);
        });
        break;
      }
      case 'manage':
        render(container, 'trial', opts);
        break;
      case 'logout':
        if (opts.onLogout) opts.onLogout();
        render(container, 'onboarding', {});
        toast('Signed out.');
        break;
      case 'delete-account':
        render(container, 'delete-confirm', opts);
        break;
      case 'cancel-delete':
        render(container, 'profile', opts);
        break;
      case 'submit-delete': {
        var deleteData = readForm(el);
        if (!deleteData.password) {
          showFormError(el, 'Enter your password to confirm.');
          return;
        }
        jsonFetch('/api/account/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: deleteData.password }),
        }).then(function () {
          toast('Your account and data have been deleted.');
          if (opts.onLogout) opts.onLogout();
          render(container, 'onboarding', {});
        }).catch(function (err) {
          showFormError(el, err.message || 'Could not delete account.');
        });
        break;
      }
      default:
        break;
    }
  }

  function createOrderAndCheckout(plan, amount) {
    var headers = { 'Content-Type': 'application/json' };
    if (isIosNativeApp()) headers['X-Patwago-Client'] = 'ios-app';
    return jsonFetch('/api/paypal/purchase-pass', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ plan: plan, amount: Number(amount), description: planLabel(plan) }),
    }).then(function (payload) {
      var order = (payload && payload.data) || {};
      return {
        plan: order.plan || plan,
        amount: order.amount != null ? order.amount : amount,
        orderId: order.id,
        status: 'awaiting',
      };
    });
  }

  function readForm(form) {
    var data = {};
    if (form.elements) {
      for (var i = 0; i < form.elements.length; i++) {
        var field = form.elements[i];
        if (!field.name) continue;
        if (field.type === 'checkbox') data[field.name] = field.checked;
        else if (field.type === 'radio' && !field.checked) continue;
        else data[field.name] = field.value;
      }
    } else if (typeof FormData !== 'undefined') {
      data = Object.fromEntries(new FormData(form).entries());
    }
    return data;
  }

  function showFormError(form, message) {
    var errEl = form.querySelector('#pw-auth-error, .auth-error, [role="alert"]');
    if (errEl) {
      errEl.textContent = message;
      errEl.hidden = false;
    } else {
      toast(message, true);
    }
  }

  /* ---------- expose ---------- */

  window.PatWaGoAccountPages = {
    renderOnboarding: renderOnboarding,
    renderAuth: renderAuth,
    renderTrialStatus: renderTrialStatus,
    renderCheckout: renderCheckout,
    renderProfile: renderProfile,
    renderDeleteConfirm: renderDeleteConfirm,
    isIosNativeApp: isIosNativeApp,
    requestNativePurchase: requestNativePurchase,
    mount: mount,
    toast: toast,
    escapeHtml: escapeHtml,
    jsonFetch: jsonFetch,
  };
})();
