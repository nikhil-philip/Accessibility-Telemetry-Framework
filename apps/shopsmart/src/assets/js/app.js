// ShopSmart — shared page behavior (all builds).
// Note: the quick-actions panel and product-details tab panels intentionally
// do NOT toggle aria-hidden in step with their open/visible state until
// Build 5 (see aria-hidden-focus-001/002 in docs/violations/catalog.json).
(function () {
  'use strict';

  function on(el, evt, fn) { if (el) el.addEventListener(evt, fn); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // Header hamburger nav
  var hamburger = document.getElementById('hamburgerBtn');
  var nav = document.getElementById('mainNav');
  on(hamburger, 'click', function () {
    var isOpen = nav.classList.toggle('open');
    hamburger.setAttribute('aria-expanded', String(isOpen));
  });

  // Cart button -> cart page
  on(document.getElementById('cartBtn'), 'click', function () {
    window.location.href = 'cart.html';
  });

  // Generic custom dropdown widgets: <button data-dropdown-trigger="menuId">
  all('[data-dropdown-trigger]').forEach(function (trigger) {
    var menu = document.getElementById(trigger.getAttribute('data-dropdown-trigger'));
    if (!menu) return;
    on(trigger, 'click', function () {
      var isOpen = menu.classList.toggle('open');
      if (trigger.hasAttribute('aria-expanded')) trigger.setAttribute('aria-expanded', String(isOpen));
    });
    all('[role="option"]', menu).forEach(function (opt) {
      on(opt, 'click', function () {
        all('[role="option"]', menu).forEach(function (o) { o.classList.remove('active'); });
        opt.classList.add('active');
        var label = trigger.querySelector('[data-dropdown-label]');
        if (label) label.textContent = opt.textContent;
        menu.classList.remove('open');
        if (trigger.hasAttribute('aria-expanded')) trigger.setAttribute('aria-expanded', 'false');
      });
    });
  });

  // Generic tabs: container [data-tabs] > [role="tab"][data-tab-target="panelId"]
  all('[data-tabs]').forEach(function (tabList) {
    var tabs = all('[role="tab"]', tabList);
    tabs.forEach(function (tab) {
      on(tab, 'click', function () {
        tabs.forEach(function (t) {
          t.classList.remove('active');
          if (t.hasAttribute('aria-selected')) t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        if (tab.hasAttribute('aria-selected')) tab.setAttribute('aria-selected', 'true');
        all('[data-tab-panel]').forEach(function (p) {
          p.classList.remove('active');
          if (p.hasAttribute('aria-hidden')) p.setAttribute('aria-hidden', 'true');
        });
        var panel = document.getElementById(tab.getAttribute('data-tab-target'));
        if (panel) {
          panel.classList.add('active');
          if (panel.hasAttribute('aria-hidden')) panel.setAttribute('aria-hidden', 'false');
        }
      });
    });
  });

  // Generic accordion: .accordion-trigger[aria-controls="panelId"]
  all('.accordion-trigger').forEach(function (trigger) {
    on(trigger, 'click', function () {
      var panel = document.getElementById(trigger.getAttribute('aria-controls'));
      if (!panel) return;
      var isOpen = panel.classList.toggle('open');
      trigger.setAttribute('aria-expanded', String(isOpen));
    });
  });

  // Generic modal open/close: [data-modal-open="modalId"], [data-modal-close]
  all('[data-modal-open]').forEach(function (btn) {
    on(btn, 'click', function () {
      var modal = document.getElementById(btn.getAttribute('data-modal-open'));
      if (modal) modal.classList.add('open');
    });
  });
  all('[data-modal-close]').forEach(function (btn) {
    on(btn, 'click', function () {
      var modal = btn.closest('.modal-overlay');
      if (modal) modal.classList.remove('open');
    });
  });

  // Quantity steppers: [data-qty-decrease="inputId"], [data-qty-increase="inputId"]
  all('[data-qty-decrease]').forEach(function (btn) {
    on(btn, 'click', function () {
      var input = document.getElementById(btn.getAttribute('data-qty-decrease'));
      if (input) input.value = Math.max(1, (parseInt(input.value, 10) || 1) - 1);
    });
  });
  all('[data-qty-increase]').forEach(function (btn) {
    on(btn, 'click', function () {
      var input = document.getElementById(btn.getAttribute('data-qty-increase'));
      if (input) input.value = (parseInt(input.value, 10) || 1) + 1;
    });
  });

  // Dashboard "Quick actions" slide-out panel
  var quickBtn = document.getElementById('quickActionsBtn');
  var quickPanel = document.getElementById('quickActionsPanel');
  function setQuickPanelOpen(isOpen) {
    quickPanel.classList.toggle('open', isOpen);
    quickPanel.setAttribute('aria-hidden', String(!isOpen));
  }
  on(quickBtn, 'click', function () { setQuickPanelOpen(!quickPanel.classList.contains('open')); });
  on(quickPanel && quickPanel.querySelector('[data-panel-close]'), 'click', function () { setQuickPanelOpen(false); });

  // Wishlist heart toggle (Build 4+)
  all('[data-wishlist-toggle]').forEach(function (btn) {
    on(btn, 'click', function (evt) {
      evt.preventDefault();
      btn.classList.toggle('active');
    });
  });
})();
