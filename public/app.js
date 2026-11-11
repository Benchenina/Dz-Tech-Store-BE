/* ==========================================================================
   WAMD Commerce - API console client
   Vanilla JavaScript. All dynamic user content is inserted with textContent.
   ========================================================================== */

(() => {
  'use strict';

  const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:5000' : '';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const STORAGE = {
    token: 'wamd.token',
    tokenSource: 'wamd.tokenSource',
    user: 'wamd.user',
    theme: 'wamd.theme',
  };

  const state = {
    token: storageGet(STORAGE.token) || '',
    tokenSource: storageGet(STORAGE.tokenSource) || 'jwt',
    user: safeParse(storageGet(STORAGE.user)),
    authMode: 'login',
    products: [],
    search: '',
    selectedId: null,
    editingId: null,
    deletingId: null,
    sendBearer: true,
    limits: {
      generalMax: 100,
      loginMax: 5,
      windowMinutes: 15,
    },
    stress: {
      running: false,
      cancel: false,
      total: 0,
      success: 0,
      unauthorized: 0,
      limited: 0,
    },
  };

  const el = {};

  /* ---------------------------------------------------------------------- */
  /* Utilities                                                              */
  /* ---------------------------------------------------------------------- */

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (_error) {
      /* Storage can be unavailable in private browsing. */
    }
  }

  function safeParse(value) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  function svgIcon(name, className = 'icon') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(number);
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  function productId(product) {
    return String(product.id || product._id || '');
  }

  function isSafeImageUrl(value) {
    if (!value || typeof value !== 'string') return false;
    try {
      const url = new URL(value, window.location.href);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_error) {
      return false;
    }
  }

  function initials(name) {
    if (!name) return 'OA';
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('');
  }

  function base64UrlDecode(input) {
    let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function decodeJwt(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    try {
      return {
        header: JSON.parse(base64UrlDecode(parts[0])),
        payload: JSON.parse(base64UrlDecode(parts[1])),
        signature: parts[2],
      };
    } catch (_error) {
      return null;
    }
  }

  function claimValue(value) {
    if (Array.isArray(value)) return value.join(', ');
    if (value && typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function expiryLabel(exp) {
    if (!exp) return { text: 'No expiry claim', className: '' };
    const expiresAt = Number(exp) * 1000;
    if (!Number.isFinite(expiresAt)) return { text: 'No expiry claim', className: '' };

    const diff = expiresAt - Date.now();
    const exact = formatDate(new Date(expiresAt).toISOString());

    if (diff <= 0) {
      return { text: 'Expired', className: 'is-expired', title: `Expired on ${exact}` };
    }

    const minutes = Math.ceil(diff / 60000);
    if (minutes < 60) {
      return {
        text: `Expires in ${minutes} min`,
        className: 'is-valid',
        title: `Expires on ${exact}`,
      };
    }

    const hours = Math.ceil(minutes / 60);
    return {
      text: `Expires in ${hours} h`,
      className: 'is-valid',
      title: `Expires on ${exact}`,
    };
  }

  async function request(path, options = {}) {
    const {
      method = 'GET',
      body,
      auth = false,
      token,
      timeout = 15000,
      signal,
    } = options;

    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const bearerToken = token !== undefined ? token : state.token;
    if (auth && bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

    const controller = signal ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal || (controller ? controller.signal : undefined),
      });

      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (_error) {
          data = text;
        }
      }

      return {
        ok: response.ok,
        status: response.status,
        data,
        headers: response.headers,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function errorMessage(result) {
    const data = result && result.data;
    if (data && typeof data === 'object') {
      if (Array.isArray(data.details) && data.details.length > 0) {
        return data.details
          .map((item) => item.message || item.field)
          .filter(Boolean)
          .join(' ');
      }
      if (data.message) return data.message;
      if (data.error) return data.error;
    }
    if (typeof data === 'string' && data.trim()) return data.trim().slice(0, 200);
    return `The API returned HTTP ${result ? result.status : 'unknown'}.`;
  }

  function rateLimitMessage(result) {
    const data = result && result.data;
    const retry = data && Number(data.retryAfter);
    const base = errorMessage(result);
    return Number.isFinite(retry) && retry > 0 ? `${base} Retry in ${retry} s.` : base;
  }

  function notify(type, title, message) {
    const icons = {
      success: 'check',
      error: 'warning',
      warning: 'warning',
      info: 'activity',
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const iconWrap = document.createElement('span');
    iconWrap.className = 'toast-icon';
    iconWrap.appendChild(svgIcon(icons[type] || 'activity'));

    const body = document.createElement('div');
    body.className = 'toast-body';
    const heading = document.createElement('strong');
    heading.textContent = title;
    body.appendChild(heading);
    if (message) {
      const paragraph = document.createElement('p');
      paragraph.textContent = message;
      body.appendChild(paragraph);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.appendChild(svgIcon('x'));

    const dismiss = () => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 180);
    };

    close.addEventListener('click', dismiss);
    toast.append(iconWrap, body, close);

    // Keep the stack compact so notifications never cover the entire dashboard.
    while (el.toastHost.children.length >= 4) {
      el.toastHost.firstElementChild.remove();
    }

    el.toastHost.appendChild(toast);
    setTimeout(dismiss, 5200);
  }

  /* ---------------------------------------------------------------------- */
  /* Theme                                                                  */
  /* ---------------------------------------------------------------------- */

  function applyTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    storageSet(STORAGE.theme, next);
    el.themeToggle.setAttribute(
      'aria-label',
      next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
    );
  }

  function initTheme() {
    const stored = storageGet(STORAGE.theme);
    if (stored === 'dark' || stored === 'light') {
      applyTheme(stored);
      return;
    }
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  }

  /* ---------------------------------------------------------------------- */
  /* Health                                                                 */
  /* ---------------------------------------------------------------------- */

  function setApiStatus(status, text, title) {
    el.apiStatus.dataset.state = status;
    el.apiStatusText.textContent = text;
    if (title) el.apiStatus.title = title;
  }

  async function checkHealth() {
    try {
      const result = await request('/api/health', { timeout: 5000 });
      if (result.ok && result.data && result.data.status === 'ok') {
        setApiStatus(
          'online',
          'API online',
          `MongoDB ${result.data.database || 'unknown'}; uptime ${result.data.uptime || 0} s`
        );
        if (result.data.rateLimit) {
          state.limits.generalMax = Number(result.data.rateLimit.generalMax) || 100;
          state.limits.loginMax = Number(result.data.rateLimit.loginMax) || 5;
          state.limits.windowMinutes = Number(result.data.rateLimit.windowMinutes) || 15;
          renderLimitInfo();
        }
        return;
      }
      setApiStatus('offline', 'API degraded', `HTTP ${result.status}`);
    } catch (error) {
      setApiStatus('offline', 'API offline', error.message);
    }
  }

  function renderLimitInfo() {
    const { generalMax, loginMax, windowMinutes } = state.limits;
    el.limitBadge.textContent = `${loginMax} login attempts / ${windowMinutes} min`;
    el.limitHint.textContent =
      `General API: ${generalMax} requests / ${windowMinutes} min. ` +
      `Login: ${loginMax} attempts / ${windowMinutes} min. ` +
      'Reset is available in development from the loopback interface.';
  }

  /* ---------------------------------------------------------------------- */
  /* Authentication                                                         */
  /* ---------------------------------------------------------------------- */

  function setAuthMode(mode) {
    state.authMode = mode;
    const isRegister = mode === 'register';

    el.loginTab.classList.toggle('is-active', !isRegister);
    el.registerTab.classList.toggle('is-active', isRegister);
    el.loginTab.setAttribute('aria-selected', String(!isRegister));
    el.registerTab.setAttribute('aria-selected', String(isRegister));

    el.nameField.hidden = !isRegister;
    el.authName.required = isRegister;
    el.authSubmitLabel.textContent = isRegister ? 'Create account' : 'Sign in';
    el.authPassword.autocomplete = isRegister ? 'new-password' : 'current-password';
    el.authPassword.placeholder = isRegister ? 'At least 8 characters' : 'Your password';
  }

  function persistUser(user) {
    state.user = user || null;
    storageSet(STORAGE.user, user ? JSON.stringify(user) : null);
  }

  function setSession(token, source, user) {
    state.token = (token || '').trim();
    state.tokenSource = source || 'jwt';
    persistUser(user || null);

    storageSet(STORAGE.token, state.token);
    storageSet(STORAGE.tokenSource, state.tokenSource);
    updateSessionUI();
    updateAuthNote();
  }

  function clearSession(showToast = true) {
    state.token = '';
    state.tokenSource = 'jwt';
    persistUser(null);
    storageSet(STORAGE.token, null);
    storageSet(STORAGE.tokenSource, null);
    el.tokenInput.value = '';
    updateSessionUI();
    updateAuthNote();
    if (showToast) notify('info', 'Session cleared', 'The stored bearer token was removed.');
  }

  function renderClaims(payload, source) {
    el.tokenClaims.replaceChildren();

    const claims = [
      ['sub', payload.sub || payload.id],
      ['name', payload.name],
      ['email', payload.email],
      ['iss', payload.iss],
      ['aud', payload.aud],
      ['provider', source],
    ].filter(([, value]) => value !== undefined && value !== null && value !== '');

    if (claims.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'claim';
      empty.textContent = 'No recognizable claims';
      el.tokenClaims.appendChild(empty);
      return;
    }

    for (const [label, value] of claims) {
      const chip = document.createElement('span');
      chip.className = 'claim';
      const key = document.createElement('strong');
      key.textContent = `${label}:`;
      chip.append(key, document.createTextNode(` ${claimValue(value)}`));
      chip.title = `${label}: ${claimValue(value)}`;
      el.tokenClaims.appendChild(chip);
    }
  }

  function updateSessionUI() {
    const hasToken = Boolean(state.token);
    el.sessionEmpty.hidden = hasToken;
    el.sessionPanel.hidden = !hasToken;
    el.providerBadge.hidden = !hasToken;

    if (!hasToken) return;

    const decoded = decodeJwt(state.token);
    const profile = state.user || (decoded ? decoded.payload : {});
    const name = profile.name || 'Unverified token';
    const email = profile.email || 'No email claim';
    const provider =
      state.tokenSource === 'oauth'
        ? 'OAuth2'
        : state.tokenSource === 'oauth2-mock'
          ? 'OAuth2 mock'
          : 'JWT';

    el.userAvatar.textContent = initials(profile.name);
    el.userName.textContent = name;
    el.userEmail.textContent = email;
    el.sessionProvider.textContent = provider;
    el.providerBadge.textContent = provider;
    el.providerBadge.className =
      state.tokenSource === 'jwt' ? 'pill pill-accent' : 'pill pill-warning';

    el.tokenPreview.textContent =
      state.token.length > 28
        ? `${state.token.slice(0, 12)}...${state.token.slice(-8)}`
        : state.token;
    el.tokenPreview.title = state.token;

    const expiry = decoded ? expiryLabel(decoded.payload.exp) : null;
    el.tokenExpiry.textContent = expiry ? expiry.text : 'Opaque token';
    el.tokenExpiry.className = `token-expiry${expiry && expiry.className ? ` ${expiry.className}` : ''}`;
    if (expiry && expiry.title) el.tokenExpiry.title = expiry.title;

    el.tokenTypeBadge.textContent = decoded ? 'JWT' : 'OAuth2';
    el.tokenTypeBadge.className = decoded ? 'pill pill-accent' : 'pill pill-warning';

    const codeDetails = el.jwtHeader.closest('details');
    if (decoded) {
      el.jwtHeader.textContent = JSON.stringify(decoded.header, null, 2);
      el.jwtPayload.textContent = JSON.stringify(decoded.payload, null, 2);
      if (codeDetails) codeDetails.hidden = false;
      el.opaqueNote.hidden = true;
      renderClaims(decoded.payload, state.tokenSource);
    } else {
      el.jwtHeader.textContent = '-';
      el.jwtPayload.textContent = '-';
      if (codeDetails) codeDetails.hidden = true;
      el.opaqueNote.hidden = false;
      el.tokenClaims.replaceChildren();
      const note = document.createElement('span');
      note.className = 'claim';
      note.textContent = 'Claims resolved server-side';
      el.tokenClaims.appendChild(note);
    }
  }

  function refreshExpiry() {
    if (!state.token) return;
    const decoded = decodeJwt(state.token);
    if (!decoded) return;
    const expiry = expiryLabel(decoded.payload.exp);
    el.tokenExpiry.textContent = expiry.text;
    el.tokenExpiry.className = `token-expiry${expiry.className ? ` ${expiry.className}` : ''}`;
    if (expiry.title) el.tokenExpiry.title = expiry.title;
  }

  function updateAuthNote() {
    if (!el.productAuthNote) return;
    if (state.sendBearer && state.token) {
      el.productAuthNote.textContent = 'Protected request with Bearer token';
    } else if (state.sendBearer) {
      el.productAuthNote.textContent = 'Protected request without a token: expect 401';
    } else {
      el.productAuthNote.textContent = 'Bearer token disabled: protected writes will return 401';
    }
  }

  async function login(email, password) {
    return request('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    el.authForm.classList.remove('was-validated');

    if (!el.authForm.checkValidity()) {
      el.authForm.classList.add('was-validated');
      el.authForm.reportValidity();
      return;
    }

    const email = el.authEmail.value.trim();
    const password = el.authPassword.value;
    const isRegister = state.authMode === 'register';

    el.authSubmit.disabled = true;
    el.authSubmitLabel.textContent = isRegister ? 'Creating account...' : 'Signing in...';

    try {
      if (isRegister) {
        const result = await request('/api/auth/register', {
          method: 'POST',
          body: {
            name: el.authName.value.trim(),
            email,
            password,
          },
        });

        if (result.status === 409) {
          notify('warning', 'Email already registered', errorMessage(result));
          return;
        }

        if (!result.ok) {
          const type = result.status === 429 ? 'warning' : 'error';
          notify(type, 'Registration failed', result.status === 429 ? rateLimitMessage(result) : errorMessage(result));
          return;
        }

        notify('success', 'Account created', 'Signing in with the new credentials.');
      }

      const result = await login(email, password);

      if (result.status === 401) {
        notify('error', 'Sign in failed', errorMessage(result));
        return;
      }

      if (result.status === 429) {
        notify('warning', 'Login rate limit reached', rateLimitMessage(result));
        return;
      }

      if (!result.ok || !result.data || !result.data.token) {
        notify('error', 'Sign in failed', errorMessage(result));
        return;
      }

      setSession(result.data.token, 'jwt', result.data.user);
      el.authPassword.value = '';
      el.tokenInput.value = '';
      setAuthMode('login');
      notify('success', 'Signed in', `Welcome, ${result.data.user.name}.`);
    } catch (error) {
      notify('error', 'Network error', error.message);
    } finally {
      el.authSubmit.disabled = false;
      el.authSubmitLabel.textContent =
        state.authMode === 'register' ? 'Create account' : 'Sign in';
    }
  }

  async function verifySession() {
    if (!state.token) {
      notify('warning', 'No token', 'Sign in or paste a token before verifying.');
      return;
    }

    el.verifyToken.disabled = true;
    try {
      const result = await request('/api/auth/me', { auth: true });

      if (result.status === 401) {
        notify('error', 'Token rejected', errorMessage(result));
        return;
      }

      if (result.status === 429) {
        notify('warning', 'Rate limit reached', rateLimitMessage(result));
        return;
      }

      if (!result.ok || !result.data || !result.data.user) {
        notify('error', 'Verification failed', errorMessage(result));
        return;
      }

      const user = result.data.user;
      state.tokenSource =
        user.provider === 'jwt'
          ? 'jwt'
          : user.provider === 'oauth2-mock'
            ? 'oauth2-mock'
            : 'oauth';
      storageSet(STORAGE.tokenSource, state.tokenSource);
      persistUser({
        id: user.id,
        name: user.name,
        email: user.email,
        provider: user.provider,
      });
      updateSessionUI();
      notify(
        'success',
        'Token verified',
        `${user.name || user.email || user.id} - provider ${user.provider}`
      );
    } catch (error) {
      notify('error', 'Verification failed', error.message);
    } finally {
      el.verifyToken.disabled = false;
    }
  }

  async function copyToken() {
    if (!state.token) return;
    try {
      await navigator.clipboard.writeText(state.token);
      notify('success', 'Token copied', 'The bearer token is now on your clipboard.');
    } catch (_error) {
      notify('warning', 'Clipboard unavailable', 'Select the token preview and copy it manually.');
    }
  }

  function usePastedToken() {
    const token = el.tokenInput.value.trim();
    if (!token) {
      notify('warning', 'Token required', 'Paste a JWT or OAuth2 access token first.');
      return;
    }

    const decoded = decodeJwt(token);
    setSession(token, decoded ? 'jwt' : 'oauth', decoded ? decoded.payload : null);
    el.tokenInput.value = '';
    notify(
      'info',
      'Token loaded',
      decoded
        ? 'JWT payload decoded locally. Use Verify for server-side validation.'
        : 'Opaque token loaded. Use Verify to resolve it through the OAuth2 validator.'
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Products                                                               */
  /* ---------------------------------------------------------------------- */

  function buildEmptyState(iconName, title, text) {
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';
    const iconWrap = document.createElement('span');
    iconWrap.className = 'empty-icon';
    iconWrap.appendChild(svgIcon(iconName));
    const heading = document.createElement('h3');
    heading.textContent = title;
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    wrap.append(iconWrap, heading, paragraph);
    return wrap;
  }

  function renderProductList() {
    const query = state.search.trim().toLowerCase();
    const filtered = state.products.filter((product) => {
      if (!query) return true;
      return [product.name, product.category, product.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });

    el.productCount.textContent = String(state.products.length);
    el.visibleCount.textContent = `${filtered.length} shown`;
    el.productList.replaceChildren();

    if (filtered.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'list-empty';
      empty.textContent =
        state.products.length === 0
          ? 'No products in the catalogue. Use New product to create one.'
          : 'No product matches this search.';
      el.productList.appendChild(empty);
      return;
    }

    for (const product of filtered) {
      const id = productId(product);
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `product-item${id === state.selectedId ? ' is-selected' : ''}`;
      button.setAttribute('aria-current', id === state.selectedId ? 'true' : 'false');

      const thumb = document.createElement('span');
      thumb.className = 'product-thumb';
      thumb.appendChild(svgIcon('image'));
      if (isSafeImageUrl(product.imageUrl)) {
        const image = document.createElement('img');
        image.src = product.imageUrl;
        image.alt = '';
        image.loading = 'lazy';
        image.addEventListener('error', () => image.remove());
        thumb.appendChild(image);
      }

      const body = document.createElement('span');
      body.className = 'product-item-body';
      const name = document.createElement('span');
      name.className = 'product-item-name';
      name.textContent = product.name;
      const meta = document.createElement('span');
      meta.className = 'product-item-meta';
      const category = document.createElement('span');
      category.textContent = product.category || 'General';
      const price = document.createElement('span');
      price.className = 'product-item-price';
      price.textContent = money(product.price);
      meta.append(category, price);
      body.append(name, meta);

      button.append(thumb, body);
      button.addEventListener('click', () => selectProduct(id));
      item.appendChild(button);
      el.productList.appendChild(item);
    }
  }

  function detailCell(label, value) {
    const cell = document.createElement('div');
    cell.className = 'detail-cell';
    const key = document.createElement('span');
    key.textContent = label;
    const content = document.createElement('strong');
    content.textContent = value || '-';
    content.title = value || '-';
    cell.append(key, content);
    return cell;
  }

  function actionButton(label, iconName, classes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = classes;
    button.append(svgIcon(iconName), document.createTextNode(` ${label}`));
    return button;
  }

  function renderProductDetail() {
    el.productDetail.replaceChildren();

    if (!state.products.length) {
      el.productDetail.appendChild(
        buildEmptyState(
          'bag',
          'Catalogue is empty',
          'Create the first product with the New product button. The seeded catalogue is inserted automatically when the collection is empty.'
        )
      );
      return;
    }

    let product = state.products.find((item) => productId(item) === state.selectedId);
    if (!product) {
      product = state.products[0];
      state.selectedId = productId(product);
      renderProductList();
    }

    const id = productId(product);
    const top = document.createElement('div');
    top.className = 'detail-top';

    const media = document.createElement('div');
    media.className = 'detail-media';
    media.appendChild(svgIcon('image'));
    if (isSafeImageUrl(product.imageUrl)) {
      const image = document.createElement('img');
      image.src = product.imageUrl;
      image.alt = product.name;
      image.addEventListener('error', () => image.remove());
      media.appendChild(image);
    }

    const info = document.createElement('div');
    info.className = 'detail-info';

    const category = document.createElement('span');
    category.className = 'pill pill-neutral';
    category.textContent = product.category || 'General';

    const heading = document.createElement('h3');
    heading.textContent = product.name;

    const price = document.createElement('p');
    price.className = 'detail-price';
    price.textContent = money(product.price);

    const tags = document.createElement('div');
    tags.className = 'detail-tags';
    const stockPill = document.createElement('span');
    const stock = Number(product.stock) || 0;
    stockPill.className = `pill ${stock > 0 ? 'pill-success' : 'pill-danger'}`;
    stockPill.textContent = stock > 0 ? `${stock} in stock` : 'Out of stock';
    const idPill = document.createElement('span');
    idPill.className = 'pill pill-neutral';
    idPill.textContent = id.slice(-8);
    idPill.title = id;
    tags.append(stockPill, idPill);

    const actions = document.createElement('div');
    actions.className = 'button-row';
    const edit = actionButton('Edit', 'edit', 'button button-secondary button-sm');
    edit.addEventListener('click', () => openProductDialog(product));
    const remove = actionButton('Delete', 'trash', 'button button-danger button-sm');
    remove.addEventListener('click', () => openDeleteDialog(product));
    actions.append(edit, remove);

    info.append(category, heading, price, tags, actions);
    top.append(media, info);

    const description = document.createElement('p');
    description.className = 'detail-description';
    description.textContent = product.description || 'No description provided.';

    const grid = document.createElement('div');
    grid.className = 'detail-grid';
    grid.append(
      detailCell('Product ID', id),
      detailCell('Category', product.category || 'General'),
      detailCell('Price', money(product.price)),
      detailCell('Stock', String(stock)),
      detailCell('Created', formatDate(product.createdAt)),
      detailCell('Updated', formatDate(product.updatedAt))
    );

    const jsonDetails = document.createElement('details');
    jsonDetails.className = 'json-details';
    const summary = document.createElement('summary');
    const summaryText = document.createElement('span');
    summaryText.textContent = 'Raw JSON response';
    summary.append(summaryText, svgIcon('code'));
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(product, null, 2);
    jsonDetails.append(summary, pre);

    el.productDetail.append(top, description, grid, jsonDetails);
  }

  function selectProduct(id) {
    state.selectedId = id;
    renderProductList();
    renderProductDetail();
  }

  async function loadProducts(options = {}) {
    el.catalogueStatus.textContent = 'Loading';
    el.refreshProducts.disabled = true;

    try {
      const result = await request('/api/products');

      if (!result.ok || !Array.isArray(result.data)) {
        el.catalogueStatus.textContent = result.status === 429 ? 'Rate limited' : 'Unavailable';
        if (result.status === 429) {
          notify('warning', 'Catalogue rate limited', rateLimitMessage(result));
        } else {
          notify('error', 'Could not load products', errorMessage(result));
        }
        renderProductList();
        return;
      }

      state.products = result.data;
      el.catalogueStatus.textContent = 'Live';

      const requested = options.selectId;
      const exists = state.products.some((product) => productId(product) === requested);
      if (requested && exists) {
        state.selectedId = requested;
      } else if (!state.products.some((product) => productId(product) === state.selectedId)) {
        state.selectedId = state.products.length ? productId(state.products[0]) : null;
      }

      renderProductList();
      renderProductDetail();
    } catch (error) {
      el.catalogueStatus.textContent = 'Offline';
      notify('error', 'Network error', error.message);
      renderProductList();
    } finally {
      el.refreshProducts.disabled = false;
    }
  }

  function openProductDialog(product = null) {
    state.editingId = product ? productId(product) : null;

    el.productForm.reset();
    el.productFormError.hidden = true;
    el.productFormErrorText.textContent = '';

    if (product) {
      el.productDialogTitle.textContent = 'Edit product';
      el.productDialogSubtitle.textContent = 'Update the document through PUT /api/products/:id';
      el.saveProductLabel.textContent = 'Save changes';
      el.productName.value = product.name || '';
      el.productDescription.value = product.description || '';
      el.productPrice.value = product.price ?? '';
      el.productStock.value = product.stock ?? 0;
      el.productCategory.value = product.category || '';
      el.productImageUrl.value = product.imageUrl || '';
    } else {
      el.productDialogTitle.textContent = 'New product';
      el.productDialogSubtitle.textContent = 'Create a document through POST /api/products';
      el.saveProductLabel.textContent = 'Create product';
      el.productStock.value = '0';
    }

    updateAuthNote();
    el.productDialog.showModal();
    setTimeout(() => el.productName.focus(), 30);
  }

  function closeProductDialog() {
    el.productDialog.close();
    state.editingId = null;
  }

  function showProductFormError(message) {
    el.productFormErrorText.textContent = message;
    el.productFormError.hidden = false;
  }

  async function handleProductSubmit(event) {
    event.preventDefault();
    el.productFormError.hidden = true;

    if (!el.productForm.checkValidity()) {
      el.productForm.reportValidity();
      return;
    }

    const payload = {
      name: el.productName.value.trim(),
      description: el.productDescription.value.trim(),
      price: Number(el.productPrice.value),
      category: el.productCategory.value.trim() || 'General',
      imageUrl: el.productImageUrl.value.trim(),
      stock: el.productStock.value === '' ? 0 : Number(el.productStock.value),
    };

    if (!Number.isFinite(payload.price) || payload.price < 0) {
      showProductFormError('Price must be a finite number greater than or equal to 0.');
      return;
    }

    if (!Number.isInteger(payload.stock) || payload.stock < 0) {
      showProductFormError('Stock must be a non-negative integer.');
      return;
    }

    const editingId = state.editingId;
    const method = editingId ? 'PUT' : 'POST';
    const path = editingId ? `/api/products/${editingId}` : '/api/products';
    const useAuth = state.sendBearer && Boolean(state.token);

    el.saveProduct.disabled = true;
    el.saveProductLabel.textContent = editingId ? 'Saving...' : 'Creating...';

    try {
      const result = await request(path, {
        method,
        body: payload,
        auth: useAuth,
      });

      if (result.status === 401) {
        showProductFormError(
          state.token
            ? 'The API rejected the bearer token. Verify the session or sign in again.'
            : 'Authentication required. Sign in first or disable Bearer mode to see the 401 response.'
        );
        notify('error', 'Unauthorized', errorMessage(result));
        return;
      }

      if (result.status === 429) {
        showProductFormError(rateLimitMessage(result));
        notify('warning', 'Rate limit reached', rateLimitMessage(result));
        return;
      }

      if (!result.ok) {
        showProductFormError(errorMessage(result));
        notify('error', editingId ? 'Update failed' : 'Creation failed', errorMessage(result));
        return;
      }

      const savedId = productId(result.data);
      el.productDialog.close();
      state.editingId = null;
      notify(
        'success',
        editingId ? 'Product updated' : 'Product created',
        `${result.data.name} - ${money(result.data.price)}`
      );
      await loadProducts({ selectId: savedId });
    } catch (error) {
      showProductFormError(error.message);
      notify('error', 'Network error', error.message);
    } finally {
      el.saveProduct.disabled = false;
      el.saveProductLabel.textContent = editingId ? 'Save changes' : 'Create product';
    }
  }

  function openDeleteDialog(product) {
    state.deletingId = productId(product);
    el.confirmMessage.textContent = `"${product.name}" will be permanently removed from the catalogue. This action cannot be undone.`;
    el.confirmDialog.showModal();
  }

  async function confirmDeleteProduct() {
    const id = state.deletingId;
    if (!id) return;

    const useAuth = state.sendBearer && Boolean(state.token);
    el.confirmDelete.disabled = true;

    try {
      const result = await request(`/api/products/${id}`, {
        method: 'DELETE',
        auth: useAuth,
      });

      el.confirmDialog.close();
      state.deletingId = null;

      if (result.status === 401) {
        notify(
          'error',
          'Unauthorized',
          state.token
            ? errorMessage(result)
            : 'No token was sent. Sign in and keep the Bearer toggle enabled.'
        );
        return;
      }

      if (result.status === 429) {
        notify('warning', 'Rate limit reached', rateLimitMessage(result));
        return;
      }

      if (result.status === 404) {
        notify('warning', 'Product not found', errorMessage(result));
        await loadProducts();
        return;
      }

      if (!result.ok) {
        notify('error', 'Delete failed', errorMessage(result));
        return;
      }

      state.selectedId = null;
      notify('success', 'Product deleted', result.data.message || 'The document was removed.');
      await loadProducts();
    } catch (error) {
      el.confirmDialog.close();
      state.deletingId = null;
      notify('error', 'Network error', error.message);
    } finally {
      el.confirmDelete.disabled = false;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Rate-limit stress tester                                               */
  /* ---------------------------------------------------------------------- */

  function resetStressStats() {
    state.stress.total = 0;
    state.stress.success = 0;
    state.stress.unauthorized = 0;
    state.stress.limited = 0;
    renderStressStats();
  }

  function renderStressStats(completed = 0, expected = 0) {
    el.statTotal.textContent = String(state.stress.total);
    el.statSuccess.textContent = String(state.stress.success);
    el.statUnauthorized.textContent = String(state.stress.unauthorized);
    el.statLimited.textContent = String(state.stress.limited);

    const percent = expected > 0 ? Math.min(100, Math.round((completed / expected) * 100)) : 0;
    el.stressProgress.style.width = `${percent}%`;
    el.stressProgressBar.setAttribute('aria-valuenow', String(percent));
    el.stressProgressBar.classList.toggle('is-complete', percent === 100);
  }

  function clearStressLog() {
    el.stressLog.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'log-empty';
    empty.id = 'stressLogEmpty';
    empty.textContent = 'No requests yet. Start a test to observe HTTP statuses.';
    el.stressLog.appendChild(empty);
  }

  function statusClass(status) {
    if (status === 429) return 'status-429';
    if (status >= 200 && status < 300) return 'status-2xx';
    if (status >= 400 && status < 500) return 'status-4xx';
    if (status >= 500) return 'status-5xx';
    return 'status-4xx';
  }

  function appendStressLog(index, method, path, result, elapsedMs) {
    const placeholder = el.stressLog.querySelector('#stressLogEmpty');
    if (placeholder) placeholder.remove();

    const row = document.createElement('div');
    row.className = 'log-row';

    const idx = document.createElement('span');
    idx.className = 'log-index';
    idx.textContent = String(index);

    const methodCell = document.createElement('span');
    methodCell.className = 'log-method';
    methodCell.textContent = method;

    const pathCell = document.createElement('span');
    pathCell.className = 'log-path';
    pathCell.textContent = path;
    pathCell.title = path;

    const code = document.createElement('span');
    code.className = `log-code ${statusClass(result.status)}`;
    code.textContent = String(result.status);

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = `${Math.round(elapsedMs)} ms`;

    row.append(idx, methodCell, pathCell, code, time);

    let noteText = '';
    if (result.status === 429) {
      const retry = result.data && result.data.retryAfter;
      noteText = retry
        ? `Rate limited. Retry-After ${retry} s. ${errorMessage(result)}`
        : `Rate limited. ${errorMessage(result)}`;
    } else if (result.status === 401) {
      noteText = `Unauthorized. ${errorMessage(result)}`;
    } else if (result.status >= 400) {
      noteText = errorMessage(result);
    } else if (!result.ok) {
      noteText = errorMessage(result);
    }

    if (noteText) {
      const note = document.createElement('span');
      note.className = 'log-note';
      note.textContent = noteText;
      note.title = noteText;
      row.appendChild(note);
    }

    el.stressLog.appendChild(row);
    el.stressLog.scrollTop = el.stressLog.scrollHeight;
  }

  function setStressRunning(running) {
    state.stress.running = running;
    el.startStressLabel.textContent = running ? 'Stop test' : 'Start test';
    el.startStress.classList.toggle('button-danger', running);
    el.startStress.classList.toggle('button-primary', !running);
    const use = el.startStress.querySelector('use');
    if (use) use.setAttribute('href', running ? '#i-stop' : '#i-play');

    el.stressTarget.disabled = running;
    el.stressCount.disabled = running;
    el.stressDelay.disabled = running;
    el.resetLimits.disabled = running;
    el.clearStress.disabled = running;
  }

  async function startStressTest() {
    if (state.stress.running) {
      state.stress.cancel = true;
      el.startStressLabel.textContent = 'Stopping...';
      return;
    }

    const target = el.stressTarget.value;
    const count = Math.max(1, Math.min(140, Number(el.stressCount.value) || 1));
    const delay = Math.max(0, Math.min(2000, Number(el.stressDelay.value) || 0));

    el.stressCount.value = String(count);
    el.stressDelay.value = String(delay);

    state.stress.cancel = false;
    resetStressStats();
    clearStressLog();
    renderStressStats(0, count);
    setStressRunning(true);
    el.stressStatus.textContent = `Running 0 / ${count}`;

    const method = target === 'login' ? 'POST' : 'GET';
    const path = target === 'login' ? '/api/auth/login' : '/api/products';
    const body =
      target === 'login'
        ? { email: 'stress.tester@ensta.dz', password: 'incorrect-password' }
        : undefined;

    let completed = 0;

    for (let index = 1; index <= count; index += 1) {
      if (state.stress.cancel) break;

      const started = performance.now();
      let result;

      try {
        result = await request(path, {
          method,
          body,
          timeout: 10000,
        });
      } catch (error) {
        result = {
          ok: false,
          status: 0,
          data: { message: error.name === 'AbortError' ? 'Request timed out.' : error.message },
        };
      }

      const elapsed = performance.now() - started;
      state.stress.total += 1;
      if (result.status >= 200 && result.status < 300) state.stress.success += 1;
      else if (result.status === 401) state.stress.unauthorized += 1;
      else if (result.status === 429) state.stress.limited += 1;

      completed = index;
      appendStressLog(index, method, path, result, elapsed);
      renderStressStats(completed, count);
      el.stressStatus.textContent = `Running ${completed} / ${count}`;

      if (delay > 0 && index < count) await sleep(delay);
    }

    const cancelled = state.stress.cancel;
    setStressRunning(false);
    el.stressStatus.textContent = cancelled
      ? `Stopped after ${completed} requests`
      : `Completed - ${state.stress.limited} rate limited`;

    if (!cancelled) {
      renderStressStats(count, count);
      notify(
        state.stress.limited > 0 ? 'warning' : 'success',
        'Stress test complete',
        `${state.stress.limited} of ${state.stress.total} responses were 429 Too Many Requests.`
      );
    }
  }

  async function resetRateLimitCounters() {
    el.resetLimits.disabled = true;
    try {
      const result = await request('/api/dev/reset-rate-limits', { method: 'POST' });

      if (result.status === 404 || result.status === 403) {
        notify(
          'warning',
          'Reset unavailable',
          'The development reset endpoint is disabled or the request is not from loopback.'
        );
        return;
      }

      if (!result.ok) {
        notify('error', 'Reset failed', errorMessage(result));
        return;
      }

      el.stressStatus.textContent = 'Counters reset';
      notify('success', 'Rate-limit counters reset', 'Both limiter stores are empty again.');
      await checkHealth();
    } catch (error) {
      notify('error', 'Reset failed', error.message);
    } finally {
      el.resetLimits.disabled = false;
    }
  }

  function updateStressDefaults() {
    if (state.stress.running) return;
    if (el.stressTarget.value === 'login') {
      el.stressCount.value = '8';
    } else {
      el.stressCount.value = String(Math.min(140, state.limits.generalMax + 5));
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Event wiring                                                           */
  /* ---------------------------------------------------------------------- */

  function cacheElements() {
    const ids = [
      'apiStatus',
      'apiStatusText',
      'themeToggle',
      'providerBadge',
      'loginTab',
      'registerTab',
      'authForm',
      'nameField',
      'authName',
      'authEmail',
      'authPassword',
      'authSubmit',
      'authSubmitLabel',
      'passwordToggle',
      'sessionEmpty',
      'sessionPanel',
      'userAvatar',
      'userName',
      'userEmail',
      'sessionProvider',
      'tokenPreview',
      'tokenExpiry',
      'copyToken',
      'verifyToken',
      'clearSession',
      'tokenTypeBadge',
      'tokenClaims',
      'jwtHeader',
      'jwtPayload',
      'opaqueNote',
      'tokenInput',
      'useTokenButton',
      'productCount',
      'bearerToggle',
      'refreshProducts',
      'newProductButton',
      'productSearch',
      'visibleCount',
      'catalogueStatus',
      'productList',
      'productDetail',
      'limitBadge',
      'stressTarget',
      'stressCount',
      'stressDelay',
      'startStress',
      'startStressLabel',
      'resetLimits',
      'clearStress',
      'limitHint',
      'statTotal',
      'statSuccess',
      'statUnauthorized',
      'statLimited',
      'stressProgressBar',
      'stressProgress',
      'stressStatus',
      'stressLog',
      'productDialog',
      'productForm',
      'productDialogTitle',
      'productDialogSubtitle',
      'closeProductDialog',
      'productName',
      'productDescription',
      'productPrice',
      'productStock',
      'productCategory',
      'productImageUrl',
      'productFormError',
      'productFormErrorText',
      'productAuthNote',
      'cancelProduct',
      'saveProduct',
      'saveProductLabel',
      'confirmDialog',
      'confirmMessage',
      'cancelDelete',
      'confirmDelete',
      'toastHost',
    ];

    for (const id of ids) {
      el[id] = document.getElementById(id);
    }
  }

  function bindEvents() {
    el.themeToggle.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });

    el.loginTab.addEventListener('click', () => setAuthMode('login'));
    el.registerTab.addEventListener('click', () => setAuthMode('register'));
    el.authForm.addEventListener('submit', handleAuthSubmit);

    el.passwordToggle.addEventListener('click', () => {
      const showing = el.authPassword.type === 'text';
      el.authPassword.type = showing ? 'password' : 'text';
      el.passwordToggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      const use = el.passwordToggle.querySelector('use');
      if (use) use.setAttribute('href', showing ? '#i-eye' : '#i-eye-off');
    });

    el.copyToken.addEventListener('click', copyToken);
    el.verifyToken.addEventListener('click', verifySession);
    el.clearSession.addEventListener('click', () => clearSession());
    el.useTokenButton.addEventListener('click', usePastedToken);

    el.bearerToggle.addEventListener('change', () => {
      state.sendBearer = el.bearerToggle.checked;
      updateAuthNote();
    });

    el.refreshProducts.addEventListener('click', () => loadProducts());
    el.newProductButton.addEventListener('click', () => openProductDialog());
    el.productSearch.addEventListener('input', () => {
      state.search = el.productSearch.value;
      renderProductList();
    });

    el.productForm.addEventListener('submit', handleProductSubmit);
    el.productForm.addEventListener('input', () => {
      el.productFormError.hidden = true;
    });
    el.closeProductDialog.addEventListener('click', closeProductDialog);
    el.cancelProduct.addEventListener('click', closeProductDialog);

    el.productDialog.addEventListener('click', (event) => {
      if (event.target === el.productDialog) closeProductDialog();
    });

    el.confirmDelete.addEventListener('click', confirmDeleteProduct);
    el.cancelDelete.addEventListener('click', () => {
      el.confirmDialog.close();
      state.deletingId = null;
    });
    el.confirmDialog.addEventListener('click', (event) => {
      if (event.target === el.confirmDialog) {
        el.confirmDialog.close();
        state.deletingId = null;
      }
    });

    el.stressTarget.addEventListener('change', updateStressDefaults);
    el.startStress.addEventListener('click', startStressTest);
    el.resetLimits.addEventListener('click', resetRateLimitCounters);
    el.clearStress.addEventListener('click', () => {
      if (state.stress.running) return;
      clearStressLog();
      resetStressStats();
      el.stressProgress.style.width = '0%';
      el.stressStatus.textContent = 'Idle';
    });
  }

  function init() {
    cacheElements();
    initTheme();
    bindEvents();
    setAuthMode('login');
    updateSessionUI();
    updateAuthNote();
    renderLimitInfo();
    clearStressLog();
    checkHealth();
    loadProducts();
    setInterval(checkHealth, 30000);
    setInterval(refreshExpiry, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
