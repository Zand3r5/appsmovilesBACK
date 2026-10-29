# Reward vouchers in Apple Wallet and Google Wallet

A redeemed reward is a single-use voucher, not a booked movie showing or seat. The Wallet barcode contains the existing redemption code. Staff must validate it online in WhatNext before delivering a reward. Downloading or saving a pass never spends points again.

The integrations are implemented, but no Apple/Google issuer accounts or real signing credentials have been connected. Buttons show a setup message until their provider is configured. Wallet saving is an explicit user action: the app cannot silently add a pass to someone's wallet.

## Apple Wallet

1. Enroll in the Apple Developer Program, then create a **Pass Type ID** and its signing certificate. These are distinct from the APNs credentials used by app push notifications. Follow [Apple's identifier/certificate instructions](https://developer.apple.com/help/account/capabilities/create-wallet-identifiers-and-certificates).
2. Export the signing certificate and matching private key as PEM files. Download the current matching Apple Worldwide Developer Relations intermediate certificate and provide it as PEM. Keep private keys on the server; `credentials/` is ignored by Git and Docker builds.
3. Set these variables in `.env` for local tests, or the production server environment:

```env
WALLET_PUBLIC_BASE_URL=https://your-api.example.com
WALLET_APPLE_PASS_TYPE_ID=pass.YOUR_REGISTERED_IDENTIFIER
WALLET_APPLE_TEAM_ID=YOUR_APPLE_TEAM_ID
WALLET_APPLE_CERT_PATH=credentials/pass-cert.pem
WALLET_APPLE_KEY_PATH=credentials/pass-key.pem
WALLET_APPLE_WWDR_PATH=credentials/wwdr.pem
WALLET_APPLE_KEY_PASSPHRASE=
```

Use the real registered values. The public base is the API server origin, **without `/api`**. In production it must use HTTPS. For a local Safari test it can be the computer's LAN HTTP address, reachable by the phone. Restart the API after configuring it.

The backend creates a signed `.pkpass` coupon with the reward, holder, expiry and QR code. It opens through a short-lived browser download link bound to the current login session; expired links can be regenerated from Mis canjes. Saving uses the system browser/Wallet sheet, so it does not require adding a Wallet-specific native package to Expo Go. This is separate from remote push, which still requires a development build.

See [Apple's pass-building reference](https://developer.apple.com/documentation/walletpasses/building-a-pass). Test on a real iPhone: redeem a reward, save it, scan the code, use it once and confirm reuse is rejected by the server. Test signing-certificate expiration and missing credentials as well.

## Google Wallet (Android)

1. Create a Google Wallet API issuer account and a Google Cloud project. Enable the Google Wallet API.
2. Create a service account and grant it the required Developer access to your issuer in the Google Pay & Wallet console. Download the service-account JSON key into the server's ignored credentials folder. Follow [Google's authentication instructions](https://developers.google.com/wallet/generic/getting-started/auth/rest).
3. Create a **GenericClass** for WhatNext using [Google's setup examples](https://developers.google.com/wallet/generic). Choose an ID of the form `ISSUER_ID.whatnext_rewards`. Set the exact same ID below; issuing a voucher references this existing class.

```env
WALLET_GOOGLE_ISSUER_ID=YOUR_NUMERIC_ISSUER_ID
WALLET_GOOGLE_CLASS_ID=YOUR_NUMERIC_ISSUER_ID.whatnext_rewards
WALLET_GOOGLE_CREDENTIALS_PATH=credentials/google-wallet.json
WALLET_GOOGLE_ORIGINS=https://your-web-app.example.com
WALLET_LOGO_URL=https://your-public-logo.example.com/whatnext.png
```

The logo is optional in the implementation. For web issuance, provide the actual allowed web origins, not placeholder examples. Restart the API. The backend signs an RS256 Save to Google Wallet link with a stable GenericObject ID for each redemption. The user signs into Google and confirms saving; retrying does not create a second redemption or charge points again.

Start with the issuer's allowed test accounts. Google issuer demo mode restricts who can save passes; complete publishing approval before offering them broadly. See [Google's issuance guide](https://developers.google.com/wallet/generic/web).

## Docker credentials

The API service mounts `credentials/` at `/run/secrets/whatnext` read-only. Set production file paths to that directory, for example `/run/secrets/whatnext/pass-key.pem` and `/run/secrets/whatnext/google-wallet.json`. Make credential files readable by the container's node user without making private keys publicly accessible. Credential files are excluded from the Docker build; the worker does not need access to Wallet keys.

## API and validity

- `GET /api/wallet/status`: authenticated setup availability, no secrets.
- `POST /api/rewards/redemptions/:id/wallet` with `{ "provider": "apple" }` or `"google"`: owner-only export of an active, unexpired voucher. Returns `{ provider, url, expiresIn }`.
- `GET /api/wallet/apple/:id.pkpass?ticket=...`: short-lived, session-bound signed download; browser links cannot authenticate ordinary API requests.
- Used, canceled, refunded and expired vouchers cannot be newly exported. Owner cancellation removes the voucher from Mis canjes and restores its verified original points atomically; the audit record remains. Staff validation and atomic single-use checks remain authoritative.

**Current limitation:** passes already saved to Wallet do not automatically update their appearance after use or refund. Apple pass-update web services/APNs and Google object-update synchronization are not implemented in this phase. A saved pass or screenshot is never sufficient proof that a code is valid. Staff must check its current server status. The Google save JWT expires after ten minutes and Apple download links after two minutes; these expiration times do not shorten the voucher's own validity.

Automated tests verify points accounting, ownership, JWT signatures, Apple package manifest and detached signature using temporary test certificates. Those certificates are not Apple-issued and cannot produce a pass accepted by a real Wallet. Real device acceptance and Google issuer approval still require the accounts above.
