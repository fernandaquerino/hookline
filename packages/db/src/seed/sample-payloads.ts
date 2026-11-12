/**
 * Made-up sample payloads for local development. They imitate the shape of provider webhooks but
 * contain no real people, accounts or customer data.
 */
export const githubPushPayload = {
  ref: 'refs/heads/main',
  before: '0000000000000000000000000000000000000000',
  after: '1111111111111111111111111111111111111111',
  repository: { id: 1, name: 'example-repo', full_name: 'example-org/example-repo' },
  pusher: { name: 'example-user' },
  commits: [{ id: '1111111', message: 'Fix typo in docs', author: { name: 'Example User' } }],
};

export const githubPingPayload = {
  zen: 'Keep it logically awesome.',
  hook_id: 123456,
  repository: { id: 1, name: 'example-repo', full_name: 'example-org/example-repo' },
};

export const stripeCheckoutPayload = {
  id: 'evt_test_000000000001',
  object: 'event',
  type: 'checkout.session.completed',
  livemode: false,
  data: {
    object: {
      id: 'cs_test_000000000001',
      object: 'checkout.session',
      amount_total: 4200,
      currency: 'usd',
      customer: 'cus_test_example',
      payment_status: 'paid',
    },
  },
};

export const orderCreatedForm = 'order_id=ord_1001&status=created&total=19.99&currency=EUR';
