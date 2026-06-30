# POS integration

The affiliate Firebase project remains independent from Simple POS and SimplePay. Integration happens only for
confirmed orders, so the three projects do not need continuous cross-project listeners.

## Ingest a paid POS order

Call `ingestPosOrder` only after SimplePay or an authorized payment process confirms payment.

Required data:

- `externalOrderId`: stable idempotency key
- `posOrderId`
- `paymentStatus`: `confirmed`
- `paymentReference`
- `amount`
- `userId` or exact `customerPhone`

Optional data:

- `planId` (defaults to `plan_rm180`)
- `branchId`
- `referralCode`
- `paymentMethod`
- `createdAt`

The function reads the current affiliate plan from `amsystem/main`. The POS amount must exactly match that plan,
so the affiliate system remains the price authority. The current default plan is RM180.

If a referral code is supplied, it must match the buyer's already-fixed referrer. POS data cannot silently replace
an existing referral relationship.

## Reverse a refunded POS order

Call `reversePosOrder` with:

- `externalOrderId`
- `refundReference`
- `reason`

If no reward value has been released and the buyer still has enough points, the function reverses points,
entitlements, pending rewards and consumed repeat-pool credit in one transaction.

If rewards have been confirmed/released, or the buyer no longer holds enough points, related rewards are frozen and
an `amsystemReversalCases` document is created with `review-required`. This prevents a refund from silently creating
negative reward balances.

## Identity limitation

Automatic matching currently accepts an affiliate `userId` or an exact unique phone number. Duplicate or missing
phone matches are rejected. A shared cross-system identity map should be added before large-scale use.

## Deployment order

1. Deploy the updated affiliate functions.
2. Deploy `firestore.rules`.
3. Test duplicate ingest, wrong price, wrong referral, paid order confirmation and both reversal paths.
4. Connect the integration worker only after SimplePay payment confirmation is trusted.

Do not place service-account JSON files or private keys in this repository.

`TEST_INSTANT_MODE` is disabled in both the browser fallback and Cloud Functions. Repeat rewards therefore follow
the normal 7, 14 and 30 day release schedule instead of becoming withdrawable immediately.
