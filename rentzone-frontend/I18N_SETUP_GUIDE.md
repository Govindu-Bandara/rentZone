# RentZone Internationalization (i18n) Setup Guide

## ✅ What's Already Set Up

1. **i18n Configuration** - `src/config/i18n.js`
2. **Translation Files**:
   - English: `src/locales/en/translation.json`
   - Sinhala: `src/locales/si/translation.json`
3. **Language Switcher** - `src/components/common/LanguageSwitcher.jsx`

---

## 📋 Integration Steps

### Step 1: Install Package (if not done)
```bash
npm install i18next react-i18next i18next-browser-languagedetector
```

### Step 2: Initialize i18n in `main.jsx`

Add this at the very top of your `src/main.jsx` file, BEFORE creating the React root:

```jsx
import './config/i18n'; // Add this line first
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
// ... other imports
```

### Step 3: Use Translations in Components

#### Simple Text
```jsx
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();

  return (
    <div>
      <h1>{t('common.welcome')}</h1>
      <button>{t('common.save')}</button>
    </div>
  );
}
```

#### Dynamic Text (with variables)
```jsx
function RenterDashboard() {
  const { t } = useTranslation();
  const userName = "Kamal";

  return (
    <h1>{t('renterDashboard.welcome', { name: userName })}</h1>
  );
}
```

#### In JSX Attributes
```jsx
<input placeholder={t('common.search')} />
<button title={t('common.save')} />
```

---

## 🎯 Add Language Switcher to Your App

### Option 1: Add to Navbar
```jsx
import LanguageSwitcher from '../components/common/LanguageSwitcher';

function Navbar() {
  return (
    <nav>
      {/* ... other navbar items ... */}
      <LanguageSwitcher />
    </nav>
  );
}
```

### Option 2: Add to User Profile Settings
```jsx
function UserProfile() {
  const { t } = useTranslation();

  return (
    <div>
      <h2>{t('profile.userProfile')}</h2>
      <LanguageSwitcher />
      {/* ... other profile content ... */}
    </div>
  );
}
```

---

## 📝 Translation Key Structure

Keys are organized hierarchically for easy maintenance:

```
common.* → General UI text (buttons, labels, common actions)
navbar.* → Navigation items
auth.* → Login/Register related
renterDashboard.* → Renter-specific dashboard
ownerDashboard.* → Owner-specific dashboard
property.* → Property details
booking.* → Booking-related text
payment.* → Payment form fields
profile.* → User profile page
messages.* → Messaging features
admin.* → Admin panel
errors.* → Error messages
modals.* → Modal dialogs
```

---

## ➕ Adding New Translations

1. Add the key to `src/locales/en/translation.json`
2. Add the corresponding Sinhala translation to `src/locales/si/translation.json`
3. Use it in your component: `{t('section.key')}`

### Example:
**en/translation.json:**
```json
{
  "newFeature": {
    "title": "My New Feature",
    "description": "This is my new feature"
  }
}
```

**si/translation.json:**
```json
{
  "newFeature": {
    "title": "මගේ නව විශේෂතා",
    "description": "මෙය මගේ නව විශේෂතාවන්"
  }
}
```

**Component:**
```jsx
<h1>{t('newFeature.title')}</h1>
<p>{t('newFeature.description')}</p>
```

---

## 🔄 Language Persistence

The language preference is automatically saved to browser localStorage by `i18next-browser-languagedetector`, so users' language choice persists across sessions.

---

## 🌐 Detect User Language Automatically

Users' browser language is automatically detected. The fallback language is English if their language isn't available.

**Detection order:**
1. User's localStorage preference
2. User's browser language (navigator.language)
3. Fallback: English

---

## 📱 RTL Support (Optional)

If you want to add Arabic or other RTL languages in the future, add this to your CSS:

```css
html[lang="ar"] {
  direction: rtl;
}
```

---

## 🧪 Testing the Setup

1. Install the package: `npm install` (already done)
2. Update `main.jsx` with the import
3. Use `useTranslation()` in a component
4. Switch language using LanguageSwitcher
5. Verify text changes between English and Sinhala

---

## 📚 File Locations

```
src/
├── config/
│   └── i18n.js
├── locales/
│   ├── en/
│   │   └── translation.json
│   └── si/
│       └── translation.json
└── components/common/
    └── LanguageSwitcher.jsx
```

---

## 💡 Tips

- Use meaningful translation key names
- Keep translation.json files in sync
- Add comments in JSON for context-specific translations
- Test both languages before deployment
- Consider using a translation management tool (Crowdin, Lokalise) for larger projects

---

## 🚀 Next Steps

1. Update `src/main.jsx` to import the i18n config
2. Add `<LanguageSwitcher />` to your Navbar/Profile
3. Start replacing hardcoded text with `t('key')` in components
4. Test language switching works correctly

For questions or issues, refer to [react-i18next documentation](https://react.i18next.com/)
