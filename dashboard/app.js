// Token Radar's page: renders the ranked board, a filterable table, a per-protocol
// detail drawer with the model's own breakdown, and the live-token view.
//
// The data arrives as window.RADAR from data.js, written by main.ts from the
// same board: rows are compact arrays, [rank, slug, name, category, chains,
// tvl_usd, change_7d, age_days, implied_value_usd, growth_multiplier,
// maturity_multiplier, breadth_multiplier, listed_at, launched_flag], and live
// rows are [slug, name, category, chains, tvl_usd, mcap_usd, change_7d].
// The farm plan is generated here from the row's own record, with the same
// templates the board's farm_steps use, so the page and the board never disagree.

(function () {
  var DATA = window.RADAR;
  if (!DATA) { document.getElementById('board').textContent = 'No radar data.'; return; }

  var META = DATA.meta;
  var ROWS = DATA.rows.map(function (r) {
    return { rank: r[0], slug: r[1], name: r[2], category: r[3], chains: r[4], tvl_usd: r[5], change_7d: r[6], age_days: r[7], implied_value_usd: r[8], growth_multiplier: r[9], maturity_multiplier: r[10], breadth_multiplier: r[11], listed_at: r[12], launched: r[13] === 1, on_watchlist: r[14] === 1 };
  });
  var LIVE = DATA.live.map(function (r) {
    return { slug: r[0], name: r[1], category: r[2], chains: r[3], tvl_usd: r[4], mcap_usd: r[5], change_7d: r[6] };
  });
  var BY_SLUG = {};
  ROWS.forEach(function (r) { BY_SLUG[r.slug] = r; });

  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function fmtUsdFull(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 30) return days + ' days';
    if (days < 365) return (days / 30).toFixed(1) + ' mo';
    return (days / 365).toFixed(1) + ' yrs';
  }
  function fmtDate(s) { return s || 'unknown'; }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) { if (c) node.appendChild(c); });
    }
    return node;
  }

  // The model's own arithmetic, recomputed in the page so the detail drawer can
  // show the waterfall: size x growth x maturity x breadth = implied value.
  function sizeBase(row) {
    var m = META.model;
    return m.base_usd * Math.pow(row.tvl_usd / m.base_tvl_usd, m.size_power);
  }
  function impliedOf(row) {
    var base = sizeBase(row);
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : Math.min(Math.max(row.change_7d, -80), 200);
    var growth = 1 + (g / 100) * 0.8;
    var age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
    var maturity = 0.5 + (Math.min(Math.max(age, 0), 1460) / 1460) * 0.7;
    var breadth = 1 + 0.05 * Math.min(Math.max(row.chains.length - 1, 0), 4);
    return { base: base, growth: growth, maturity: maturity, breadth: breadth, implied: Math.max(1, Math.round(base * growth * maturity * breadth)) };
  }

  // The farm plan, from the row's own record: category, chains, TVL, age.
  function chainOf(p) { return p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasNote(p) {
    var chain = chainOf(p).toLowerCase();
    if (chain.indexOf('ethereum') >= 0) return 'about $5 to $15 of gas for the first transaction on Ethereum';
    if (chain.indexOf('solana') >= 0) return 'under $1 of fees for the first transaction on Solana';
    return 'under $3 of gas for the first transaction';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + '\'s main pool on ' + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + ' of the chain\'s staking asset through ' + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of the protocol\'s yield asset on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(p) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'Swap a small amount through ' + name + ' each week so the wallet shows repeat use, not one deposit.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow a small amount against the deposit once a week and repay it, so the wallet shows both sides of the market.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Check the staking receipt each week and re-stake any rewards instead of letting them sit idle.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a small amount back and forth once a week so the wallet shows repeat crossings.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Open and close one small position a week rather than leaving a single trade open for months.';
    return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
  }
  function riskFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'The pool can lose value to impermanent loss if prices move apart; size the position so a 20% move does not hurt.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'A borrow can be liquidated if collateral falls; keep the loan well below the limit and watch the health factor weekly.';
    if (c.indexOf('bridge') >= 0) return 'Bridged funds depend on the bridge\'s own contracts; never bridge more than you can afford to have delayed.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Staking locks the asset for the unbonding period; know the wait before you stake.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Leverage magnifies losses as well as gains; keep the position small and set a stop.';
    return 'Smart contracts can fail; never farm with funds you cannot afford to lose.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gasNote(p), time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weeklyFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: riskFor(p) + ' Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ];
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
    return s;
  }
  window.__farmSteps = function (slug) { var r = BY_SLUG[slug]; return r ? farmSteps(r).map(stepText) : []; };

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    var out = {};
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv[0]) out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return out;
  }
  function writeHash() {
    var parts = [];
    if (state.tab !== 'pre-token') parts.push('tab=' + state.tab);
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.category !== 'all') parts.push('category=' + encodeURIComponent(state.category));
    if (state.sort !== 'implied') parts.push('sort=' + state.sort);
    if (state.dir !== -1) parts.push('dir=' + state.dir);
    if (state.selected) parts.push('detail=' + state.selected);
    var next = parts.length ? '#' + parts.join('&') : '#';
    if (window.location.hash !== next) window.history.replaceState(null, '', next);
  }
  function applyHash() {
    var h = readHash();
    state.tab = h.tab === 'live' ? 'live' : 'pre-token';
    state.q = h.q || '';
    state.category = h.category || 'all';
    state.sort = h.sort || 'implied';
    state.dir = h.dir === '1' ? 1 : -1;
    state.selected = h.detail || null;
  }

  var maxImplied = ROWS.length ? ROWS[0].implied_value_usd : 1;

  function dial() {
    var top = ROWS.slice(0, 8);
    var minLog = Math.log(top[top.length - 1].implied_value_usd);
    var maxLog = Math.log(maxImplied);
    var cx = 84, cy = 84;
    var svg = '<svg viewBox="0 0 168 168" width="168" height="168" role="img" aria-label="Radar dial: the top 8 protocols as blips">';
    svg += '<circle cx="84" cy="84" r="78" fill="none" stroke="#d2dde5"/>';
    svg += '<circle cx="84" cy="84" r="52" fill="none" stroke="#d2dde5"/>';
    svg += '<circle cx="84" cy="84" r="26" fill="none" stroke="#d2dde5"/>';
    svg += '<line x1="84" y1="6" x2="84" y2="162" stroke="#d2dde5"/><line x1="6" y1="84" x2="162" y2="84" stroke="#d2dde5"/>';
    top.forEach(function (r, i) {
      var angle = -Math.PI / 2 + (i / top.length) * 2 * Math.PI;
      var frac = maxLog === minLog ? 1 : (Math.log(r.implied_value_usd) - minLog) / (maxLog - minLog);
      var rad = 78 - frac * 62;
      var x = (cx + rad * Math.cos(angle)).toFixed(1);
      var y = (cy + rad * Math.sin(angle)).toFixed(1);
      svg += '<circle cx="' + x + '" cy="' + y + '" r="' + (i === 0 ? 7 : 5) + '" fill="#d9481c"/>';
      svg += '<text x="' + (+x + 8) + '" y="' + (+y + 4) + '" font-size="11" fill="#15222e">' + r.rank + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  function header() {
    var watchCount = META.watchlist_size;
    return el('header', { class: 'top' }, [
      el('div', {}, [
        el('div', { class: 'brand-name' }, [el('strong', { text: 'TOKEN RADAR' }), document.createTextNode(' · ' + META.model_version + ' · snapshot ' + META.as_of)]),
        el('h1', {}, [document.createTextNode('The token that isn\u2019t there yet, '), el('em', { text: 'priced.' })]),
        el('p', { class: 'dek', text: META.board_size + ' pre-token protocols ranked by what a token would be worth if their record stayed as it is — and what to do to farm each one before it launches.' }),
      ]),
      el('div', {}, [
        el('div', { class: 'dial', html: dial() }),
        el('div', { class: 'dial-caption', text: 'Top 8 on the dial, by implied value' }),
      ]),
    ]);
  }

  function metaBar() {
    return el('div', { class: 'meta' }, [
      el('span', {}, [document.createTextNode('Snapshot '), el('b', { text: META.as_of })]),
      el('span', {}, [document.createTextNode('Protocols scanned '), el('b', { text: String(META.protocols_total) })]),
      el('span', {}, [document.createTextNode('Watchlist '), el('b', { text: String(META.watchlist_size) })]),
      el('span', {}, [document.createTextNode('Board '), el('b', { text: String(META.board_size) + ' rows' })]),
      el('span', {}, [document.createTextNode('Early finds '), el('b', { text: String(META.early_size) })]),
      el('span', {}, [document.createTextNode('Live tokens set aside '), el('b', { text: String(META.live_size) })]),
    ]);
  }

  function modelStrip() {
    var m = META.model;
    return el('section', { class: 'model', 'aria-label': 'How a value is built' }, [
      el('div', {}, [
        el('h2', { text: 'How a value is built' }),
        el('p', {}, [document.createTextNode('A launch is worth a share of the value already locked in the protocol. Size is concave — each extra dollar of TVL adds less than the last — then momentum, time without a token, and how many chains it runs on do the rest. '), el('b', { text: 'No protocol name is ever special-cased.' })]),
        el('p', {}, [document.createTextNode('Protocols whose token already trades are shown at the market\u2019s own value, in the Live tab, and never ranked. An implied value is this entry\u2019s own claim, never make.fun\u2019s.')]),
      ]),
      el('div', { class: 'factors' }, [
        el('div', { class: 'factor' }, [el('div', { class: 'k', text: 'Size' }), el('div', { class: 'v', text: 'TVL^0.85' }), el('div', { class: 'd', text: '$250M at $1B TVL' })]),
        el('div', { class: 'factor' }, [el('div', { class: 'k', text: 'Momentum' }), el('div', { class: 'v', text: '7-day growth' }), el('div', { class: 'd', text: 'clamped −80% to +200%' })]),
        el('div', { class: 'factor' }, [el('div', { class: 'k', text: 'Time tokenless' }), el('div', { class: 'v', text: '0.50–1.20×' }), el('div', { class: 'd', text: 'over 4 years' })]),
        el('div', { class: 'factor' }, [el('div', { class: 'k', text: 'Breadth' }), el('div', { class: 'v', text: '1.00–1.20×' }), el('div', { class: 'd', text: '+5% a chain, to 5' })]),
      ]),
    ]);
  }

  function spotlight() {
    var top = ROWS.slice(0, 3);
    return el('section', { class: 'spot', 'aria-label': 'Top three' }, top.map(function (r, i) {
      var pct = Math.round((r.implied_value_usd / maxImplied) * 100);
      return el('button', { class: 'card' + (i === 0 ? ' first' : ''), type: 'button', onclick: function () { select(r.slug); } }, [
        el('div', { class: 'rank', text: 'Rank ' + r.rank + (i === 0 ? ' · most valuable launch' : '') }),
        el('div', { class: 'name', text: r.name }),
        el('div', { class: 'value', text: fmtUsd(r.implied_value_usd) }),
        el('div', { class: 'sub', text: fmtUsd(r.tvl_usd) + ' TVL · ' + fmtPct(r.change_7d) + ' in 7 days · ' + fmtAge(r.age_days) + ' tokenless' }),
        el('div', { class: 'bar' }, [el('i', { style: 'width:' + pct + '%' })]),
      ]);
    }));
  }

  function rows() {
    return ROWS.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if ((r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var d = 0;
      if (key === 'implied') d = a.implied_value_usd - b.implied_value_usd;
      else if (key === 'tvl') d = a.tvl_usd - b.tvl_usd;
      else if (key === 'change') d = (a.change_7d || 0) - (b.change_7d || 0);
      else if (key === 'age') d = (a.age_days || 0) - (b.age_days || 0);
      else d = a.rank - b.rank;
      if (d === 0) d = a.slug < b.slug ? -1 : 1;
      return d * state.dir;
    });
  }

  function controls() {
    var categories = Array.from(new Set(ROWS.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', placeholder: 'Search a protocol or a chain…', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { 'aria-label': 'Filter by category' }, [
      el('option', { value: 'all', text: 'All categories' }),
    ].concat(categories.map(function (c) {
      var o = el('option', { value: c, text: c });
      if (c === state.category) o.selected = true;
      return o;
    })));
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var sort = el('select', { 'aria-label': 'Sort the board' }, [
      el('option', { value: 'implied', text: 'Sort: implied value' }),
      el('option', { value: 'tvl', text: 'Sort: TVL' }),
      el('option', { value: 'change', text: 'Sort: 7-day change' }),
      el('option', { value: 'age', text: 'Sort: time tokenless' }),
      el('option', { value: 'rank', text: 'Sort: rank' }),
    ]);
    sort.value = state.sort;
    sort.addEventListener('change', function () { state.sort = sort.value; state.dir = -1; writeHash(); render(); });
    var count = el('span', { class: 'count', text: '' });
    return el('div', { class: 'controls' }, [search, select, el('div', { class: 'tabs' }, [pre, live]), sort, count]);
  }

  function sortHeader(key, label) {
    var b = el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } }, [
      document.createTextNode(label),
      state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null,
    ]);
    return el('th', { 'aria-sort': state.sort === key ? (state.dir < 0 ? 'descending' : 'ascending') : 'none' }, [b]);
  }

  function boardTable() {
    var list = sortedRows(rows());
    var shown = list.length;
    var count = document.querySelector('.count');
    if (count) count.textContent = shown + ' of ' + ROWS.length + ' rows';
    if (!shown) {
      return el('div', { class: 'empty' }, [
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Try a different search or category.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } }),
      ]);
    }
    var head = el('tr', {}, [
      el('th', { text: 'Rank' }),
      el('th', { text: 'Protocol' }),
      el('th', { text: 'Category' }),
      sortHeader('tvl', 'TVL'),
      sortHeader('change', '7-day'),
      el('th', { class: 'hide-narrow', text: 'Tokenless' }),
      sortHeader('implied', 'Implied value'),
    ]);
    var body = el('tbody', {}, list.map(function (r) {
      var pct = Math.round((r.implied_value_usd / maxImplied) * 100);
      var chg = r.change_7d === null ? el('span', { text: '—' }) : el('span', { class: r.change_7d >= 0 ? 'up' : 'down', text: fmtPct(r.change_7d) });
      return el('tr', {
        'aria-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { select(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(r.slug); } },
      }, [
        el('td', { class: 'rk', text: String(r.rank) }),
        el('td', {}, [
          el('div', { class: 'nm' }, [document.createTextNode(r.name), r.on_watchlist ? el('span', { class: 'star', text: ' ★' }) : null]),
          el('div', { class: 'sl', text: r.slug + (r.on_watchlist ? ' · watchlist' : '') + (r.launched ? ' · token launched since snapshot' : '') }),
        ]),
        el('td', {}, [el('span', { class: 'chip', text: r.category || 'Other' })]),
        el('td', { text: fmtUsd(r.tvl_usd) }),
        el('td', {}, [chg]),
        el('td', { class: 'hide-narrow', text: fmtAge(r.age_days) }),
        el('td', {}, [
          el('div', { class: 'val', text: fmtUsd(r.implied_value_usd) }),
          el('div', { class: 'valbar' }, [el('i', { style: 'width:' + pct + '%' })]),
        ]),
      ]);
    }));
    return el('table', { class: 'board' }, [el('thead', {}, [head]), body]);
  }

  function liveTable() {
    var head = el('tr', {}, [
      el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: '7-day' }),
    ]);
    var body = el('tbody', {}, LIVE.map(function (r) {
      return el('tr', {}, [
        el('td', {}, [el('div', { class: 'nm', text: r.name }), el('div', { class: 'sl', text: r.slug })]),
        el('td', {}, [el('span', { class: 'chip', text: r.category || 'Other' })]),
        el('td', { text: fmtUsd(r.tvl_usd) }),
        el('td', { text: fmtUsd(r.mcap_usd) }),
        el('td', {}, [r.change_7d === null ? el('span', { text: '—' }) : el('span', { class: r.change_7d >= 0 ? 'up' : 'down', text: fmtPct(r.change_7d) })]),
      ]);
    }));
    return el('div', {}, [
      el('table', { class: 'board' }, [el('thead', {}, [head]), body]),
      el('p', { class: 'live-note', text: 'These protocols already have a token that trades, so the board shows the market\u2019s own value for them and never ranks them. They are here so a reader can tell a launch that already happened from one still to come.' }),
    ]);
  }

  function select(slug) {
    state.selected = slug;
    writeHash();
    render();
    var d = document.querySelector('.drawer');
    if (d) d.focus();
  }

  function drawer() {
    var r = BY_SLUG[state.selected];
    if (!r) return null;
    var v = impliedOf(r);
    var steps = farmSteps(r);
    var why = 'Rank ' + r.rank + ' of ' + ROWS.length + '. Its size factor is ' + fmtUsd(v.base) + '; growth moves it ×' + v.growth.toFixed(2) + ', time tokenless ×' + v.maturity.toFixed(2) + ', and breadth ×' + v.breadth.toFixed(2) + '.';
    return el('aside', { class: 'drawer', role: 'dialog', 'aria-label': r.name + ' detail', tabindex: '-1' }, [
      el('button', { class: 'close', type: 'button', text: 'Close ×', onclick: function () { state.selected = null; writeHash(); render(); } }),
      el('div', { class: 'rank', text: 'Rank ' + r.rank }),
      el('h2', { text: r.name }),
      el('div', { class: 'sub', text: r.slug + ' · ' + (r.category || 'Other') + ' · ' + r.chains.join(', ') }),
      el('div', { class: 'value', text: fmtUsd(r.implied_value_usd) }),
      el('div', { class: 'sub', text: 'implied launch value · ' + fmtUsd(r.tvl_usd) + ' TVL · ' + fmtPct(r.change_7d) + ' in 7 days' }),
      r.launched ? el('div', { class: 'flag', text: 'This protocol has issued a token since the snapshot — farm it only if the launch is still claimable.' }) : null,
      el('div', { class: 'facts' }, [
        el('div', {}, [el('div', { class: 'k', text: 'TVL' }), el('div', { class: 'v', text: fmtUsdFull(r.tvl_usd) })]),
        el('div', {}, [el('div', { class: 'k', text: '7-day change' }), el('div', { class: 'v', text: fmtPct(r.change_7d) })]),
        el('div', {}, [el('div', { class: 'k', text: 'Time tokenless' }), el('div', { class: 'v', text: fmtAge(r.age_days) })]),
        el('div', {}, [el('div', { class: 'k', text: 'Tracked since' }), el('div', { class: 'v', text: fmtDate(r.listed_at) })]),
        el('div', {}, [el('div', { class: 'k', text: 'Chains' }), el('div', { class: 'v', text: String(r.chains.length) })]),
        el('div', {}, [el('div', { class: 'k', text: 'Token recorded' }), el('div', { class: 'v', text: 'None in the snapshot' })]),
      ]),
      el('div', { class: 'waterfall' }, [
        el('h3', { text: 'How the value is built' }),
        el('div', { class: 'row' }, [el('span', { text: 'Size · $250M × (TVL / $1B)^0.85' }), el('span', { text: fmtUsd(v.base) })]),
        el('div', { class: 'row' }, [el('span', { text: 'Momentum · 7-day growth' }), el('span', { text: '×' + v.growth.toFixed(2) })]),
        el('div', { class: 'row' }, [el('span', { text: 'Time tokenless · ' + fmtAge(r.age_days) }), el('span', { text: '×' + v.maturity.toFixed(2) })]),
        el('div', { class: 'row' }, [el('span', { text: 'Breadth · ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') }), el('span', { text: '×' + v.breadth.toFixed(2) })]),
        el('div', { class: 'row total' }, [el('span', { text: 'Implied value' }), el('span', { text: fmtUsd(r.implied_value_usd) })]),
      ]),
      el('div', { class: 'plan' }, [
        el('h3', { text: 'How to farm it' }),
        el('ol', {}, steps.map(function (s) {
          return el('li', {}, [
            document.createTextNode(s.text + ' '),
            el('span', { class: 'cost', text: 'Cost: ' + s.cost + '. Time: ' + s.time + '.' }),
          ]);
        })),
      ]),
      el('p', { class: 'live-note', text: why }),
    ]);
  }

  function footer() {
    return el('footer', { class: 'foot' }, [
      el('h2', { text: 'How this board was built' }),
      el('p', { text: 'The snapshot is DefiLlama\u2019s protocol list as of ' + META.as_of + ': 758 protocols at or above $5M of TVL. The watchlist is the 40 of them at or above $50M that record no token and are not a wrapped, staked or bridged product of one that trades. This board ranks the whole watchlist plus every pre-token protocol below the floor — ' + META.early_size + ' early finds, 226 rows in all — and leaves out ' + META.left_out_above_floor + ' pre-token protocols above the floor that the same watchlist rule leaves out.' }),
      el('p', { text: META.cross_check }),
      el('p', { text: 'An implied value is this entry\u2019s own claim about what a token would be worth if the protocol\u2019s record stayed as it is. It does not predict whether or when a token is issued. Say a protocol records no token, never that it has none.' }),
    ]);
  }

  function render() {
    var root = document.getElementById('board');
    root.setAttribute('aria-busy', 'false');
    root.textContent = '';
    var shell = el('div', { class: 'shell' }, [
      header(),
      metaBar(),
      el('p', { class: 'check', text: META.cross_check }),
      modelStrip(),
      spotlight(),
      controls(),
      state.tab === 'live' ? liveTable() : boardTable(),
      footer(),
    ]);
    root.appendChild(shell);
    var d = drawer();
    if (d) root.appendChild(d);
  }

  applyHash();
  window.addEventListener('hashchange', function () { applyHash(); render(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) { state.selected = null; writeHash(); render(); }
  });
  render();
})();
