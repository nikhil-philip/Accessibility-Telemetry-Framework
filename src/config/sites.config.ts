/**
 * Route Registry (ARCHITECTURE.md Layer 2). A flat list of every page in
 * scope for scanning -- deliberately just data, no navigation logic, so the
 * accessibility suite and any future CI matrix can iterate it without
 * importing Playwright.
 */
export interface SiteRoute {
  /** Human-readable name, used in test titles and telemetry. */
  readonly name: string;
  /** Path relative to baseURL, e.g. "dashboard.html". */
  readonly path: string;
  /** True if this page assumes a logged-in session (see auth.setup.ts). */
  readonly requiresAuth: boolean;
}

export const SITES: readonly SiteRoute[] = [
  { name: 'Login', path: 'login.html', requiresAuth: false },
  { name: 'Dashboard', path: 'dashboard.html', requiresAuth: true },
  { name: 'Product Listing', path: 'products.html', requiresAuth: false },
  { name: 'Product Details', path: 'product-details.html', requiresAuth: false },
  { name: 'Shopping Cart', path: 'cart.html', requiresAuth: true },
  { name: 'Checkout', path: 'checkout.html', requiresAuth: true },
  { name: 'User Profile', path: 'profile.html', requiresAuth: true },
  { name: 'Contact Us', path: 'contact.html', requiresAuth: false },
];
