/**
 * Test data lives here, not scattered as string literals inside specs, so a
 * form-field change only needs one edit. Product data is *not* duplicated --
 * it's imported straight from the app's own fixture
 * (apps/shopsmart/src/assets/data/products.json), so tests can never drift
 * out of sync with what ShopSmart actually renders.
 */
import products from '../../apps/shopsmart/src/assets/data/products.json';

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

export interface ShippingDetails {
  readonly fullName: string;
  readonly address: string;
  readonly city: string;
  readonly postalCode: string;
  readonly email: string;
  readonly phone: string;
}

export interface PaymentDetails {
  readonly cardNumber: string;
  readonly cardExpiry: string;
  readonly cardCvc: string;
}

export interface Product {
  readonly sku: string;
  readonly name: string;
  readonly category: string;
  readonly price: number;
  readonly rating: number;
  readonly reviews: number;
  readonly img: string;
  readonly description: string;
  readonly specs: readonly string[];
}

export const testUsers: Record<'standard', Credentials> = {
  standard: {
    email: 'demo.user@shopsmart.test',
    password: 'Passw0rd!23',
  },
};

export const shippingDetails: ShippingDetails = {
  fullName: 'Asha Verma',
  address: '221B Residency Road',
  city: 'Bengaluru',
  postalCode: '560025',
  email: 'asha.verma@example.com',
  phone: '+91 90000 12345',
};

export const paymentDetails: PaymentDetails = {
  cardNumber: '4111 1111 1111 1111',
  cardExpiry: '12/28',
  cardCvc: '123',
};

export const contactMessage = {
  name: 'Asha Verma',
  email: 'asha.verma@example.com',
  subject: 'Order question',
  message: 'Could you confirm the delivery window for my last order?',
};

export const shopSmartProducts: readonly Product[] = products;

export function findProduct(sku: string): Product {
  const product = shopSmartProducts.find((p) => p.sku === sku);
  if (!product) {
    throw new Error(`No product with SKU "${sku}" in apps/shopsmart's product fixture`);
  }
  return product;
}
