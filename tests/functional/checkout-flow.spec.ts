import { test, expect } from '../../src/fixtures';
import { shippingDetails, paymentDetails, findProduct } from '../../src/utils/testData';

/**
 * This framework is not accessibility-only -- it's a general QA automation
 * base. This spec demonstrates the same Page Object Model, fixtures, and
 * test-data layer used by the accessibility suite, applied to an ordinary
 * functional flow instead.
 */
test.describe('Checkout flow', () => {
  test('adds a product to the cart and completes checkout', async ({
    productListingPage,
    cartPage,
    checkoutPage,
  }) => {
    const product = findProduct('SKU-1002'); // Bluetooth Speaker: a plain "Add to cart" button, no scoping edge cases

    await productListingPage.open();
    await productListingPage.addToCart(product.name);

    await cartPage.open();
    await expect(cartPage.heading).toBeVisible();
    // ShopSmart's cart renders fixed demo line items rather than a real
    // persisted cart (it has no backend -- see apps/shopsmart's design).
    // This checks the cart page itself is populated and navigable, not
    // that the specific item "added" above appears; against a real
    // backend, this would instead assert cartPage.row(product.name).
    await expect(cartPage.rows.first()).toBeVisible();

    await cartPage.proceedToCheckoutLink.click();
    await expect(checkoutPage.heading).toBeVisible();

    await checkoutPage.fillShippingDetails(shippingDetails);
    await checkoutPage.fillPaymentDetails(paymentDetails);
    await checkoutPage.placeOrder();

    await expect(checkoutPage.orderConfirmModal).toContainText('Confirm your order');
    await checkoutPage.confirmOrder();
  });
});
