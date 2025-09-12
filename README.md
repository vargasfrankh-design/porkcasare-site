PorKCasare - Repo listo para GitHub + Netlify Functions

Contenido:
- Frontend: index.html, register.html, login.html, distribuidor.html, admin.html, style.css, images/
- src/: frontend JS modules that interact with Firebase and Netlify Functions.
- netlify/functions/create-preference.js : Netlify Function (server-side) to create Mercado Pago preferences using MP_ACCESS_TOKEN env var.
- netlify/functions/get-payment.js : Netlify Function to verify payment and update Firestore using Firebase Admin SDK. Requires FIREBASE_ADMIN_SA env var (base64).
- package.json : includes dependency firebase-admin for Netlify Functions.

IMPORTANT - Environment variables (set in Netlify Site > Site settings > Build & deploy > Environment):
- MP_ACCESS_TOKEN = your Mercado Pago ACCESS TOKEN (TEST or LIVE). DO NOT put live token in frontend.
- MP_PUBLIC_KEY = your Mercado Pago public key (optional, for client-side widgets).
- FIREBASE_ADMIN_SA = Base64-encoded Firebase Service Account JSON (required if you use get-payment function).

Steps to deploy:
1. Create GitHub repo and push this folder.
2. In Netlify, "New site from Git" -> connect GitHub -> select this repo.
3. In Netlify site settings, add the required environment variables.
4. Deploy. Functions will be available under /.netlify/functions/*
