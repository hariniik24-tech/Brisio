# Brisio Mobile (Expo)

This folder contains the iOS/Android app for Brisio.

## Local development

1. Install dependencies:

```bash
npm install
```

2. Start the Expo dev server:

```bash
npm start
```

3. Start backend API from the parent project folder:

```bash
cd ..
npm start
```

## Backend URL

The app reads API base URL from `app.json`:

```json
"extra": {
  "apiBaseUrl": "http://localhost:3000"
}
```

For real iPhone testing, replace localhost with your Mac's LAN IP (same Wi-Fi network), for example:

```json
"apiBaseUrl": "http://192.168.1.20:3000"
```

## iOS build pipeline (EAS)

1. Install EAS CLI:

```bash
npm install -g eas-cli
```

2. Login:

```bash
eas login
```

3. Configure Expo project if needed:

```bash
eas init
```

4. Create a development build:

```bash
eas build --platform ios --profile development
```

5. Create a production build:

```bash
eas build --platform ios --profile production
```

6. Submit to App Store Connect:

```bash
eas submit --platform ios
```

## iOS app metadata

- App Name: Brisio
- Bundle Identifier: com.brisio.app
- Build Number: managed via EAS auto increment
