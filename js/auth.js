/* =====================================================================
   OUTRIGHT TRADING — FIREBASE AUTH
   ---------------------------------------------------------------------
   Real Firebase Authentication:
     - Register: verified with a REAL SMS OTP (Firebase Phone Auth)
     - Login: mobile number OR email + password
     - Continue with Google

   Requires firebase-config.js to be loaded BEFORE this file, with your
   real Firebase project keys filled in (see that file for details).
   ===================================================================== */

/* Change this if most of your customers are not in the Maldives.
   Used when someone types a mobile number without a country code. */
const DEFAULT_COUNTRY_CODE = '+960';

firebase.initializeApp(window.FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

/* ---------------------------------------------------------------------
   Helpers
--------------------------------------------------------------------- */
function isEmailLike(value){
  return /\S+@\S+\.\S+/.test(value);
}

/* Turns "771-2345", "07712345", "+9607712345" etc into a consistent
   E.164-ish string ("+9607712345") so lookups/storage always match. */
function normalizeMobile(raw){
  let v = (raw || '').replace(/[\s\-().]/g, '');
  if(v.startsWith('+')) return v;
  if(v.startsWith('00')) return '+' + v.slice(2);
  if(v.startsWith('0')) return DEFAULT_COUNTRY_CODE + v.slice(1);
  return DEFAULT_COUNTRY_CODE + v;
}

/* Accounts always have a real Firebase Auth "email" under the hood so
   password login works. If the customer didn't give a real email at
   registration, we generate an internal one tied to their mobile —
   they never see or use it directly. */
function internalAuthEmail(normalizedMobile){
  return normalizedMobile.replace('+', '') + '@outright-account.local';
}

/* ---------------------------------------------------------------------
   Simple registration — NO real SMS OTP (avoids requiring the paid
   Blaze plan). Mobile number is stored as profile info only; the
   account itself is created with email + password under the hood
   (using a generated internal email if the customer didn't give a
   real one). This is what's currently wired up to the register form.
--------------------------------------------------------------------- */
async function registerAccount({ name, mobile, email, password }){
  const normalizedMobile = normalizeMobile(mobile);
  const authEmail = email && isEmailLike(email) ? email : internalAuthEmail(normalizedMobile);

  const cred = await auth.createUserWithEmailAndPassword(authEmail, password);
  const user = cred.user;
  if(name) await user.updateProfile({ displayName: name });

  await db.collection('users').doc(user.uid).set({
    name: name || '',
    mobile: normalizedMobile,
    email: email || null,
    authEmail,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  // Lets "login by mobile number" find this account's authEmail later.
  await db.collection('phoneIndex').doc(normalizedMobile).set({ authEmail });

  return user;
}

/* ---------------------------------------------------------------------
   Phone OTP registration — REAL SMS verification. Requires the Blaze
   (pay-as-you-go) plan on Firebase. Not currently wired to the UI;
   kept here in case you upgrade later and want real OTP verification.
--------------------------------------------------------------------- */
let confirmationResult = null;
let recaptchaVerifier = null;

function getRecaptcha(){
  if(!recaptchaVerifier){
    recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
      size: 'invisible'
    });
  }
  return recaptchaVerifier;
}

/* Call this from the register form. Returns a promise; throws on
   invalid number / quota errors so the caller can show a message. */
async function sendRegisterOtp(mobileRaw){
  const mobile = normalizeMobile(mobileRaw);
  confirmationResult = await auth.signInWithPhoneNumber(mobile, getRecaptcha());
  return mobile;
}

/* ---------------------------------------------------------------------
   Phone OTP — step 2: verify the code, finish creating the account
--------------------------------------------------------------------- */
async function confirmRegisterOtp({ code, name, mobile, email, password }){
  if(!confirmationResult) throw new Error('No OTP was requested yet.');
  const cred = await confirmationResult.confirm(code); // signs the user in via phone
  const user = cred.user;

  const authEmail = email && isEmailLike(email) ? email : internalAuthEmail(mobile);
  const emailCred = firebase.auth.EmailAuthProvider.credential(authEmail, password);
  await user.linkWithCredential(emailCred); // now this account can also log in with password

  await db.collection('users').doc(user.uid).set({
    name: name || '',
    mobile,
    email: email || null,
    authEmail,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  // Minimal public lookup doc so "login by mobile number" can find the
  // right account's authEmail WITHOUT exposing the rest of the profile.
  await db.collection('phoneIndex').doc(mobile).set({ authEmail });

  if(user.displayName !== name) await user.updateProfile({ displayName: name });
  return user;
}

/* ---------------------------------------------------------------------
   Login — mobile number OR email + password
--------------------------------------------------------------------- */
async function loginWithIdAndPassword(loginId, password){
  let email = loginId.trim();
  if(!isEmailLike(email)){
    const mobile = normalizeMobile(email);
    const doc = await db.collection('phoneIndex').doc(mobile).get();
    if(!doc.exists) throw { code: 'auth/user-not-found' };
    email = doc.data().authEmail;
  }
  const cred = await auth.signInWithEmailAndPassword(email, password);
  return cred.user;
}

/* ---------------------------------------------------------------------
   Continue with Google
   ---------------------------------------------------------------------
   Uses signInWithRedirect instead of signInWithPopup. GitHub Pages (and
   several other hosts) send a Cross-Origin-Opener-Policy header that
   makes Firebase think the popup was closed the instant it opens, even
   when the sign-in actually succeeded — the popup flashes and nothing
   happens. Redirect avoids that entirely.
--------------------------------------------------------------------- */
function loginWithGoogle(){
  return auth.signInWithRedirect(googleProvider);
}

/* Call this once on page load. If the visitor just came back from the
   Google redirect, this resolves with their user; otherwise resolves
   with null (nothing to do). */
async function handleGoogleRedirectResult(){
  const result = await auth.getRedirectResult();
  if(!result || !result.user) return null;
  const user = result.user;
  await db.collection('users').doc(user.uid).set({
    name: user.displayName || '',
    email: user.email || null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return user;
}

/* ---------------------------------------------------------------------
   Logout
--------------------------------------------------------------------- */
function logoutFirebase(){
  return auth.signOut();
}

/* ---------------------------------------------------------------------
   Keep the existing localStorage flags in sync with the REAL Firebase
   session, so isLoggedIn()/getAuthUser() (already used all over the
   site) stay accurate on every page, including after a refresh.
--------------------------------------------------------------------- */
auth.onAuthStateChanged(user => {
  if(user){
    localStorage.setItem('outrightLoggedIn', '1');
    localStorage.setItem('outrightUser', user.displayName || user.email || 'Customer');
  } else {
    localStorage.removeItem('outrightLoggedIn');
    localStorage.removeItem('outrightUser');
  }
  if(typeof window.onOutrightAuthChanged === 'function') window.onOutrightAuthChanged(user);
});
