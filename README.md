# Family Winter Olympics Draft (Demo)

This zip contains:
- `index.html`, `styles.css`, `app.js` (GitHub Pages frontend)
- `apps_script_Code.gs` (Google Apps Script backend)
- `DraftData_Demo.xlsx` (example spreadsheet with required tabs and sample rows)

## 1) Create the Google Sheet
1. Upload `DraftData_Demo.xlsx` to Google Drive
2. Open it in Google Sheets (File → Open with → Google Sheets)

## 2) Add Apps Script backend
1. In the Google Sheet: Extensions → Apps Script
2. Replace the default code with the contents of `apps_script_Code.gs`
3. Save
4. Deploy → New deployment → Web app
   - Execute as: Me
   - Who has access: Anyone with the link
5. Copy the Web App URL

## 3) Host the website on GitHub Pages
1. Create a GitHub repo (public or private if you have Pages on private)
2. Upload `index.html`, `styles.css`, `app.js` to the repo (root or `/docs`)
3. Edit `app.js` and set:
   `const API_URL = "YOUR_WEB_APP_URL";`
4. Enable Pages in repo Settings → Pages

## 4) Use it
- Open the GitHub Pages URL
- Click a row in “Available teams” to prefill sport/country
- Select your player + enter your PIN + submit

Demo commissioner PIN: `1234`

Generated: 2026-02-05T05:33:33.793381Z
