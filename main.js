// ============================================================
// FIREBASE IMPORTS
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, where, getDoc, getDocs, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyB71i5ocb2DJ16p_us8RjY0Z-TjHnKTTm8",
  authDomain: "hbike-fc55e.firebaseapp.com",
  projectId: "hbike-fc55e",
  storageBucket: "hbike-fc55e.firebasestorage.app",
  messagingSenderId: "972722419806",
  appId: "1:972722419806:web:344ef684000c3774989ccf",
  measurementId: "G-FNMK00MV48"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ============================================================
// GLOBAL STATE
// ============================================================
let currentUser = null;      // firebase auth user
let currentUserData = null;  // firestore user doc (with role)
let currentRole = null;
let slides = [];
let currentSlide = 0;
let slideIntervalId = null;
let currentView = "grid";

// ============================================================
// UTILITIES
// ============================================================
const $ = (id) => document.getElementById(id);
const show = (el) => el?.classList.remove("hidden");
const hide = (el) => el?.classList.add("hidden");

function hideAllViews() {
  ["mainSite", "authView", "userDashboard", "adminDashboard", "superDashboard"]
    .forEach(id => hide($(id)));
}

function showMainSite() {
  hideAllViews();
  show($("mainSite"));
}

function goHome() {
  hideAllViews();
  show($("mainSite"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.goHome = goHome;

// ============================================================
// AUTH UI — OPEN / CLOSE
// ============================================================
$("openAuthBtn")?.addEventListener("click", () => {
  hideAllViews();
  show($("authView"));
});
window.closeAuth = () => {
  hideAllViews();
  if (currentUser) routeToDashboard();
  else showMainSite();
};

// Tab toggling inside auth view
$("tabLogin")?.addEventListener("click", () => {
  $("tabLogin").classList.add("active");
  $("tabSignup").classList.remove("active");
  $("authTitle").textContent = "Login";
  show($("loginForm"));
  hide($("signupForm"));
});
$("tabSignup")?.addEventListener("click", () => {
  $("tabSignup").classList.add("active");
  $("tabLogin").classList.remove("active");
  $("authTitle").textContent = "Create Account";
  show($("signupForm"));
  hide($("loginForm"));
});

// ============================================================
// CURRENCY — Tsh 50,000,250
// ============================================================
const CURRENCY_PREFIX = "Tsh ";

/**
 * Format any number-ish value as "Tsh 50,000,250".
 * Accepts:
 *   - number:        50000250
 *   - string:        "50000250" | "50,000,250" | "$50,000,250" | "Tsh 50,000,250"
 *   - decimals:      "50000250.75"  (rounded to 2 places)
 * @param {string|number} value
 * @param {boolean} withPrefix   include "Tsh " prefix (default true)
 * @returns {string}
 */
function formatMoney(value, withPrefix = true) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    if (!isFinite(value)) return "";
  }

  // Keep only digits and one dot
  const raw = String(value).replace(/[^0-9.]/g, "");
  if (!raw) return "";

  // Split integer / decimal
  const [intPart, decPart] = raw.split(".");

  // Strip leading zeros (but keep at least one digit)
  const cleanInt = intPart.replace(/^0+(?=\d)/, "") || "0";

  // Add thousand separators
  const formattedInt = cleanInt.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // Decimals (max 2, no trailing .00)
  let formatted = formattedInt;
  if (decPart) {
    const trimmed = decPart.slice(0, 2);
    if (trimmed && trimmed !== "00") formatted += "." + trimmed;
  }

  return withPrefix ? CURRENCY_PREFIX + formatted : formatted;
}

/**
 * Parse any money string back to a number.
 * "Tsh 50,000,250" → 50000250
 */
function parseMoney(value) {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const clean = String(value).replace(/[^0-9.]/g, "");
  return parseFloat(clean) || 0;
}

window.formatMoney = formatMoney;
window.parseMoney  = parseMoney;

// ============================================================
// REGISTRATION (with confirm password & terms)
// ============================================================
$("signupForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const username = $("signupUsername").value.trim();
  const phone = $("signupPhone").value.trim();
  const email = $("signupEmail").value.trim();
  const password = $("signupPassword").value;
  const confirm = $("signupConfirm").value;
  const terms = $("signupTerms").checked;
  
  const errEl = $("signupError");
  const okEl = $("signupSuccess");
  errEl.textContent = "";
  toast(`Welcome! You're registered as ${role}.`, "success");
  
  // --- Validation ---
  if (!username || username.length < 3) {
    errEl.textContent = "Username must be at least 3 characters.";
    return;
  }
  if (!/^\+?[0-9]{7,15}$/.test(phone.replace(/[\s-]/g, ""))) {
    errEl.textContent = "Enter a valid phone number.";
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = "Enter a valid email address.";
    return;
  }
  if (password.length < 6) {
    errEl.textContent = "Password must be at least 6 characters.";
    return;
  }
  if (password !== confirm) {
    errEl.textContent = "Passwords do not match.";
    return;
  }
  if (!terms) {
    errEl.textContent = "You must accept the Terms & Conditions.";
    return;
  }
  
  try {
    // Check username & phone uniqueness
    const usersRef = collection(db, "users");
    const [uSnap, pSnap] = await Promise.all([
      getDocs(query(usersRef, where("username", "==", username))),
      getDocs(query(usersRef, where("phone", "==", phone)))
    ]);
    if (!uSnap.empty) { errEl.textContent = "Username already taken."; return; }
    if (!pSnap.empty) { errEl.textContent = "Phone number already registered."; return; }
    
    // Create auth user
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    
    // Determine role
    const allUsers = await getDocs(collection(db, "users"));
    const role = allUsers.empty ? "superadmin" : "user";
    
    // Write user doc
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      username,
      phone,
      email,
      role,
      active: true,
      acceptedTerms: true,
      createdAt: serverTimestamp()
    });
    
    okEl.textContent = `Account created! You are registered as ${role}.`;
    $("signupForm").reset();
    
    // Reset eye icons
    document.querySelectorAll(".toggle-eye").forEach(btn => {
      btn.textContent = "👁️";
      btn.classList.remove("showing");
    });
    
    setTimeout(() => routeToDashboard(), 800);
  } catch (err) {
    console.error(err);
    errEl.textContent = err.message.replace("Firebase: ", "");
  }
});

// ============================================================
// LOGIN — accepts Username, Phone Number, OR Email
// ============================================================
$("loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const identifier = $("loginIdentifier").value.trim();
  const password = $("loginPassword").value;
  const errEl = $("loginError");
  errEl.textContent = "";
  
  if (!identifier || !password) {
    errEl.textContent = "Please fill in all fields.";
    return;
  }
  
  try {
    // 1) Try to find user by username, phone, OR email
    const usersRef = collection(db, "users");
    
    // Detect which type identifier is (email has @, phone is digits/+)
    const isEmail = identifier.includes("@");
    const isPhone = /^\+?[0-9\s-]{7,}$/.test(identifier) && !isEmail;
    
    let snap;
    
    if (isEmail) {
      snap = await getDocs(query(usersRef, where("email", "==", identifier.toLowerCase())));
    } else if (isPhone) {
      // normalize phone: strip spaces/dashes
      const normalized = identifier.replace(/[\s-]/g, "");
      snap = await getDocs(query(usersRef, where("phone", "==", normalized)));
      // fallback: try original formatting too
      if (snap.empty) {
        snap = await getDocs(query(usersRef, where("phone", "==", identifier)));
      }
    } else {
      // username
      snap = await getDocs(query(usersRef, where("username", "==", identifier)));
    }
    
    // 2) If identifier didn't match username, try other types as fallback
    if (snap.empty) {
      const tries = [
        query(usersRef, where("username", "==", identifier)),
        query(usersRef, where("email", "==", identifier.toLowerCase())),
        query(usersRef, where("phone", "==", identifier)),
        query(usersRef, where("phone", "==", identifier.replace(/[\s-]/g, "")))
      ];
      for (const q of tries) {
        const s = await getDocs(q);
        if (!s.empty) { snap = s; break; }
      }
    }
    
    if (snap.empty) {
      errEl.textContent = "No account found with that username, phone, or email.";
      return;
    }
    
    const userDoc = snap.docs[0].data();
    
    // 3) Check if account is active
    if (userDoc.active === false) {
      errEl.textContent = "Account deactivated. Please contact support.";
      return;
    }
    
   // 4) Sign in using the actual email on file
await signInWithEmailAndPassword(auth, userDoc.email, password);
toast("Logged in successfully.", "success");
    
    // Reset form + eye icon
    $("loginForm").reset();
    const eyeBtn = document.querySelector('#loginForm .toggle-eye');
    if (eyeBtn) {
      eyeBtn.textContent = "👁️";
      eyeBtn.classList.remove("showing");
    }
    // onAuthStateChanged will handle role-based dashboard redirect
  } catch (err) {
    console.error("Login error:", err);
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
      errEl.textContent = "Incorrect password. Please try again.";
    } else if (err.code === "auth/too-many-requests") {
      errEl.textContent = "Too many attempts. Try again later.";
    } else {
      errEl.textContent = "Login failed. Please try again.";
    }
  }
});

// ============================================================
// LOGOUT
// ============================================================
async function logoutUser() {
  await signOut(auth);
  currentUser = null; currentUserData = null; currentRole = null;
  hide($("dashboardBtn"));
  hide($("logoutBtn"));
  show($("openAuthBtn"));
  goHome();
  toast("You've been logged out.", "info");
}

window.logoutUser = logoutUser;
$("logoutBtn")?.addEventListener("click", logoutUser);

// ============================================================
// AUTH STATE — ROUTE TO DASHBOARD BY ROLE
// ============================================================
// ============================================================
// AUTH STATE — route by role + update navbar
// ============================================================
onAuthStateChanged(auth, async (user) => {
  // ---- LOGGED OUT ----
  if (!user) {
    currentUser = null;
    currentUserData = null;
    currentRole = null;
    
    hide($("userLinks"));
    hide($("dashLink"));
    hide($("logoutLink"));
    show($("authLinks"));
    
    // Return to public site if a dashboard was showing
    const anyDashOpen = ["userDashboard", "adminDashboard", "superDashboard"]
      .some(id => !$(id).classList.contains("hidden"));
    if (anyDashOpen) showMainSite();
    return;
  }
  
  // ---- LOGGED IN ----
  currentUser = user;
  
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) {
    // user doc missing — sign them out to avoid half-broken state
    await signOut(auth);
    return;
  }
  
  currentUserData = snap.data();
  currentRole = currentUserData.role;
  
  // ---- Update navbar ----
  hide($("authLinks"));
  show($("userLinks"));
  show($("dashLink"));
  show($("logoutLink"));
  
  // Show username in navbar
  const navUser = $("navUsername");
  if (navUser) navUser.textContent = currentUserData.username || "User";
  
  // Dashboard button → route by role
  $("dashboardBtn").onclick = () => routeToDashboard();
  
  const navAv = $("navAvatar");
if (navAv) {
  if (currentUserData.avatar) {
    navAv.src = currentUserData.avatar;
    navAv.style.display = "inline-block";
  } else {
    navAv.style.display = "none";
  }
}
  // ---- Auto-route to role dashboard after login ----
  // This fires on both initial page load (if logged in) AND after fresh login.
  routeToDashboard();
});

function routeToDashboard() {
  hideAllViews();
  if (currentRole === "superadmin") {
    renderSuperAdmin();
    show($("superDashboard"));
  } else if (currentRole === "admin") {
    show($("adminDashboard"));
    renderAdminDashboard();
  } else {
    renderUserDashboard();
    show($("userDashboard"));
  }
}
window.routeToDashboard = routeToDashboard;

// ============================================================
// USER DASHBOARD
// ============================================================
let _profileEditing = false;

function renderUserDashboard() {
  if (!currentUserData) return;

  const name = currentUserData.username || "User";
  const initial = name.charAt(0).toUpperCase();

  // Header / sidebar names + avatars
  $("udName").textContent = name;
  $("udSideName").textContent = name;
  $("udAvatar").textContent = initial;
  $("udSideAvatar").textContent = initial;

  // Fill profile panel
  fillProfilePanel();

  // Wire events once
  if (!renderUserDashboard._wired) {
    renderUserDashboard._wired = true;
    wireUserDashboardNav();
    wireProfileEvents();
    loadUserCart();
    loadUserBills();
    loadUserProgress();
    loadProfileStats();
  }
}

// ============================================================
// PROFILE — view-only renderer
// ============================================================
function fillProfilePanel() {
  const u = currentUserData || {};
  const name = u.username || "User";
  const initial = (u.fullName || name).charAt(0).toUpperCase();

  // Header
  $("profileHeaderName").textContent  = u.fullName || name;
  $("profileHeaderEmail").textContent = u.email || "—";
  $("profileHeaderRole").textContent  = u.role || "user";

  // Avatar
  const img = $("profileAvatarImg");
  const ini = $("profileAvatarInitial");
  if (u.avatar) {
    img.src = u.avatar;
    img.style.display = "block";
    ini.style.display = "none";
  } else {
    img.style.display = "none";
    ini.style.display = "flex";
    ini.textContent = initial;
  }

  // Read-only view rows
  $("pvUsername").textContent = u.username || "—";
  $("pvFullName").textContent = u.fullName || "—";
  $("pvPhone").textContent    = u.phone || "—";
  $("pvEmail").textContent    = u.email || "—";
  $("pvAddress").textContent  = u.address || "—";
  $("pvCity").textContent     = u.city || "—";
  $("pvCountry").textContent  = u.country || "—";
  $("pvBio").textContent      = u.bio || "—";

  // Joined date
  $("pvJoined").textContent = u.createdAt?.toDate
    ? u.createdAt.toDate().toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric"
      })
    : "—";

  // Status pill
  const statusEl = $("pvStatus");
  const active = u.active !== false;
  statusEl.textContent = active ? "Active" : "Deactivated";
  statusEl.className = "status-pill " + (active ? "active" : "inactive");
}

// ============================================================
// EDIT PROFILE — open / close / save
// ============================================================
function openEditProfileModal() {
  const u = currentUserData || {};

  $("epUsername").value = u.username || "";
  $("epFullName").value = u.fullName || "";
  $("epPhone").value    = u.phone || "";
  $("epEmail").value    = u.email || "";
  $("epAddress").value  = u.address || "";
  $("epCity").value     = u.city || "";
  $("epCountry").value  = u.country || "";
  $("epBio").value      = u.bio || "";

  $("epError").textContent = "";

  $("editProfileModal").classList.add("active");
  document.body.style.overflow = "hidden";

  setTimeout(() => $("epFullName")?.focus(), 100);
}

window.closeEditProfileModal = () => {
  $("editProfileModal").classList.remove("active");
  document.body.style.overflow = "";
};

// Close on backdrop click + Escape
$("editProfileModal")?.addEventListener("click", (e) => {
  if (e.target.id === "editProfileModal") closeEditProfileModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("editProfileModal")?.classList.contains("active")) {
    closeEditProfileModal();
  }
});

// Save changes
$("editProfileForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("epError");
  errEl.textContent = "";

  const fullName = $("epFullName").value.trim();
  const phone    = $("epPhone").value.trim();
  const address  = $("epAddress").value.trim();
  const city     = $("epCity").value.trim();
  const country  = $("epCountry").value.trim();
  const bio      = $("epBio").value.trim();

  // Validation
  if (fullName && fullName.length < 2) {
    errEl.textContent = "Full name must be at least 2 characters.";
    return;
  }
  if (phone && !/^\+?[0-9\s\-]{7,20}$/.test(phone)) {
    errEl.textContent = "Enter a valid phone number.";
    return;
  }

  // Phone uniqueness check (if changed)
  if (phone && phone !== (currentUserData.phone || "")) {
    try {
      const q = query(collection(db, "users"), where("phone", "==", phone));
      const snap = await getDocs(q);
      const taken = snap.docs.some(d => d.id !== currentUser.uid);
      if (taken) {
        errEl.textContent = "That phone number is already registered.";
        return;
      }
    } catch (err) {
      console.error("Phone check failed:", err);
    }
  }

  // Disable button during save
  const btn = $("epSaveBtn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      fullName, phone, address, city, country, bio,
      updatedAt: serverTimestamp()
    });

    // Refresh local cache
    currentUserData = {
      ...currentUserData,
      fullName, phone, address, city, country, bio
    };
    fillProfilePanel();
    closeEditProfileModal();
    toast("✅ Profile updated.", "success");
  } catch (err) {
    console.error(err);
    errEl.textContent = "Failed to save. Please try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// ============================================================
// EDIT MODE
// ============================================================
function setProfileEditing(on) {
  _profileEditing = !!on;

  // Toggle disabled state
  ["pfFullName", "pfPhone", "pfAddress", "pfCity", "pfCountry", "pfBio"]
    .forEach(id => { const el = $(id); if (el) el.disabled = !on; });

  // Show/hide actions
  $("profileFormActions").classList.toggle("hidden", !on);
  $("profileEditBtn").classList.toggle("hidden", on);

  if (on) $("pfFullName").focus();
}

function wireProfileEvents() {
  // Open edit modal
  $("profileEditBtn")?.addEventListener("click", openEditProfileModal);
  
  // Avatar upload
  $("profileAvatarBtn")?.addEventListener("click", () => {
    $("profileAvatarInput")?.click();
  });
  
  $("profileAvatarInput")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 2 * 1024 * 1024) {
      toast("Image must be under 2 MB.", "warning");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast("Please choose an image file.", "warning");
      return;
    }
    
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result;
      try {
        await updateDoc(doc(db, "users", currentUser.uid), {
          avatar: dataUrl,
          updatedAt: serverTimestamp()
        });
        currentUserData.avatar = dataUrl;
        fillProfilePanel();
        toast("✅ Photo updated.", "success");
      } catch (err) {
        console.error(err);
        toast("Failed to upload photo.", "error");
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  });
  
  // Change password modal
  $("openChangePasswordBtn")?.addEventListener("click", () => {
    $("changePasswordForm").reset();
    $("cpError").textContent = "";
    $("changePasswordModal").classList.add("active");
    document.body.style.overflow = "hidden";
  });
  
  // Request deactivation
  $("requestDeactivateBtn")?.addEventListener("click", requestDeactivation);
}

// ============================================================
// CHANGE PASSWORD
// ============================================================
window.closeChangePasswordModal = () => {
  $("changePasswordModal").classList.remove("active");
  document.body.style.overflow = "";
};

$("changePasswordForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("cpError");
  errEl.textContent = "";

  const current = $("cpCurrent").value;
  const next    = $("cpNew").value;
  const confirm = $("cpConfirm").value;

  if (!current || !next || !confirm) {
    errEl.textContent = "All fields are required.";
    return;
  }
  if (next.length < 6) {
    errEl.textContent = "New password must be at least 6 characters.";
    return;
  }
  if (next !== confirm) {
    errEl.textContent = "New passwords do not match.";
    return;
  }
  if (next === current) {
    errEl.textContent = "New password must differ from the current one.";
    return;
  }

  try {
    // Re-authenticate first (required by Firebase)
    const cred = EmailAuthProvider.credential(
      currentUser.email,
      current
    );
    await reauthenticateWithCredential(currentUser, cred);

    // Update password
    await updatePassword(currentUser, next);

    toast("✅ Password updated.", "success");
    closeChangePasswordModal();
  } catch (err) {
    console.error("Change password error:", err);
    if (err.code === "auth/wrong-password") {
      errEl.textContent = "Current password is incorrect.";
    } else if (err.code === "auth/weak-password") {
      errEl.textContent = "New password is too weak.";
    } else if (err.code === "auth/requires-recent-login") {
      errEl.textContent = "Please log out and log back in, then try again.";
    } else {
      errEl.textContent = "Failed: " + (err.message || "unknown error");
    }
  }
});

// ============================================================
// PROFILE STATS (cart, orders, shipments)
// ============================================================
function loadProfileStats() {
  if (!currentUser) return;

  onSnapshot(query(collection(db, "carts"), where("userId", "==", currentUser.uid)),
    (snap) => { const el = $("profileStatCart"); if (el) el.textContent = snap.size; });

  onSnapshot(query(collection(db, "orders"), where("userId", "==", currentUser.uid)),
    (snap) => { const el = $("profileStatOrders"); if (el) el.textContent = snap.size; });

  onSnapshot(query(collection(db, "progress"), where("userId", "==", currentUser.uid)),
    (snap) => {
      const active = snap.docs.filter(d => (d.data().stage || 1) < 5).length;
      const el = $("profileStatProgress"); if (el) el.textContent = active;
    });
}

// ============================================================
// REQUEST ACCOUNT DEACTIVATION
// ============================================================
async function requestDeactivation() {
  const ok = confirm(
    "Send a deactivation request to the admin?\n\n" +
    "Your account will stay active until an admin reviews it. " +
    "Orders and bills will not be deleted."
  );
  if (!ok) return;

  try {
    await addDoc(collection(db, "deactivationRequests"), {
      userId: currentUser.uid,
      username: currentUserData.username || "",
      phone: currentUserData.phone || "",
      email: currentUserData.email || "",
      reason: "User requested deactivation",
      status: "pending",
      createdAt: serverTimestamp()
    });
    toast("📨 Request sent. Admin will review shortly.", "success", 4500);
  } catch (err) {
    console.error(err);
    toast("Failed to send request.", "error");
  }
}

// ---- Sidebar open/close ----
function wireUserDashboardNav() {
  const sidebar  = $("udSidebar");
  const backdrop = $("udBackdrop");

  const open = () => { sidebar.classList.add("open"); backdrop.classList.add("open"); };
  const close = () => { sidebar.classList.remove("open"); backdrop.classList.remove("open"); };

  $("udMenuBtn").onclick  = open;
  $("udCloseBtn").onclick = close;
  backdrop.onclick        = close;

  // Nav buttons
  document.querySelectorAll("#userDashboard .ud-nav-btn").forEach(btn => {
    btn.onclick = () => {
      udGo(btn.dataset.ud);
      if (window.innerWidth < 900) close();
    };
  });
}

// ---- Switch panel ----
window.udGo = (panel) => {
  document.querySelectorAll("#userDashboard .ud-nav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.ud === panel);
  });
  document.querySelectorAll("#userDashboard .ud-panel").forEach(p => {
    p.classList.toggle("active", p.id === "ud-" + panel);
  });
  document.querySelector("#userDashboard .ud-content")?.scrollIntoView({ behavior: "smooth" });
};

// ============================================================
// ADMIN DASHBOARD
// ============================================================
function renderAdminDashboard() {
  if (!currentUserData) return;

  const name = currentUserData.username || "Admin";
  const initial = name.charAt(0).toUpperCase();

  // Header / sidebar
  $("adName").textContent = name;
  $("adSideName").textContent = name;
  $("adAvatar").textContent = initial;
  $("adSideAvatar").textContent = initial;

if (!renderAdminDashboard._wired) {
  renderAdminDashboard._wired = true;
  wireAdminNav();
  setupProductsAdmin();
  setupSlidesAdmin();
  setupAboutContactAdmin();
  setupAdminStats();
  setupPaymentsAdmin();
  setupOrdersAdmin();
  setupProgressAdmin();
  setupOrderCounters();
  setupFooterAdmin(); // ← NEW
}
}

// ---- Sidebar open/close ----
function wireAdminNav() {
  const sidebar  = $("adSidebar");
  const backdrop = $("adBackdrop");

  const open  = () => { sidebar.classList.add("open");  backdrop.classList.add("open"); };
  const close = () => { sidebar.classList.remove("open"); backdrop.classList.remove("open"); };

  $("adMenuBtn").onclick  = open;
  $("adCloseBtn").onclick = close;
  backdrop.onclick        = close;

  document.querySelectorAll("#adminDashboard .ud-nav-btn").forEach(btn => {
    btn.onclick = () => {
      adGo(btn.dataset.ad);
      if (window.innerWidth < 900) close();
    };
  });
}

// ---- Panel switcher ----
window.adGo = (panel) => {
  document.querySelectorAll("#adminDashboard .ud-nav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.ad === panel);
  });
  document.querySelectorAll("#adminDashboard .ud-panel").forEach(p => {
    p.classList.toggle("active", p.id === "ad-" + panel);
  });
  document.querySelector("#adminDashboard .ud-content")?.scrollIntoView({ behavior: "smooth" });
};

// ---- Live stats ----
function setupAdminStats() {
  onSnapshot(collection(db, "products"), (s) => {
    $("adStatProducts").textContent = s.size;
    $("adProductCount").textContent = s.size;
  });
  onSnapshot(collection(db, "slides"), (s) => {
    $("adStatSlides").textContent = s.size;
    $("adSlideCount").textContent = s.size;
  });
  onSnapshot(collection(db, "users"), (s) => {
    $("adStatUsers").textContent = s.size;
  });
}

// ---- PRODUCTS ADMIN ----
function setupProductsAdmin() {
  const form = $("productForm");
  
  // Shipping radio toggle
  document.querySelectorAll('input[name="shippingType"]').forEach(r => {
    r.addEventListener("change", () => {
      const isPaid = document.querySelector('input[name="shippingType"]:checked').value === "paid";
      $("shippingAmountWrap").classList.toggle("hidden", !isPaid);
      if (!isPaid) $("shippingAmount").value = "";
    });
  });
  
  // Media type toggle
  document.querySelectorAll('input[name="mediaType"]').forEach(r => {
    r.addEventListener("change", updateMediaField);
  });
  
  // Live YouTube preview
  $("productMediaUrl")?.addEventListener("input", updateYoutubePreview);
  
  // Submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const id = $("productId").value;
    const shippingType = document.querySelector('input[name="shippingType"]:checked').value;
    const mediaType = document.querySelector('input[name="mediaType"]:checked').value;
    const mediaUrl = $("productMediaUrl").value.trim();
    
    if (shippingType === "paid" && !$("shippingAmount").value.trim()) {
      toast("Enter a shipping amount.", "warning");
      $("shippingAmount").focus();
      return;
    }
    
    if (mediaType === "youtube" && !extractYoutubeId(mediaUrl)) {
      toast("Invalid YouTube URL.", "error");
      return;
    }
    
    const data = {
      name: $("productName").value.trim(),
      price: $("productPrice").value.trim(),
      shippingType,
      shippingFee: shippingType === "free" ? "Free" : $("shippingAmount").value.trim(),
      mediaType,
      mediaUrl,
      // Backwards-compatible fields
      image: mediaType === "image" ? mediaUrl : "",
      video: mediaType === "video" ? mediaUrl : "",
      youtube: mediaType === "youtube" ? mediaUrl : "",
      description: $("productDesc").value.trim(),
      active: $("productActive").checked
    };
    
    try {
      if (id) {
        await updateDoc(doc(db, "products", id), data);
        toast("Product updated.", "success");
      } else {
        await addDoc(collection(db, "products"), data);
        toast("Product added.", "success");
      }
      resetProductForm();
    } catch (err) {
      console.error(err);
      toast("Failed to save product.", "error");
    }
  });
  
  // Live list
  onSnapshot(collection(db, "products"), (snap) => {
    const list = $("adminProductList");
    list.innerHTML = "";
    $("adProductCount").textContent = snap.size;
    
    if (snap.empty) {
      list.innerHTML = '<p class="ud-empty">No products yet. Add your first one above.</p>';
      return;
    }
    
    snap.forEach(d => {
      const p = d.data();
      const thumb = p.mediaType === "youtube" ?
        `https://img.youtube.com/vi/${extractYoutubeId(p.youtube || p.mediaUrl)}/default.jpg` :
        (p.image || "");
      const mediaBadge = p.mediaType === "youtube" ? "▶️ YouTube" :
        p.mediaType === "video" ? "🎥 Video" :
        "🖼️ Image";
      const shipLabel = p.shippingType === "free" ? "🆓 Free ship" : `🚚 ${p.shippingFee || ""}`;
      
      const div = document.createElement("div");
      div.className = "ad-item";
      div.innerHTML = `
        <img class="ad-item-thumb" src="${thumb}" alt="">
        <div class="ad-item-body">
          <h5>
            ${p.name}
            <span class="ad-badge ${p.active ? 'on' : 'off'}">${p.active ? 'Active' : 'Inactive'}</span>
          </h5>
          <p>
            <span class="price">${p.price}</span> ·
            ${shipLabel} ·
            ${mediaBadge}
          </p>
        </div>
        <div class="ad-item-actions">
          <button class="btn-edit" onclick="editProduct('${d.id}')">Edit</button>
          <button class="btn-toggle" onclick="toggleProduct('${d.id}', ${p.active})">${p.active ? "Disable" : "Enable"}</button>
          <button class="btn-delete" onclick="deleteProduct('${d.id}')">Delete</button>
        </div>`;
      list.appendChild(div);
    });
  });
}

window.resetProductForm = () => {
  $("productForm").reset();
  $("productId").value = "";
  $("productActive").checked = true;
  $("adProductFormTitle").textContent = "➕ Add New Product";
  $("productForm").querySelector(".btn-primary").textContent = "💾 Save Product";
};

window.editProduct = async (id) => {
  const snap = await getDoc(doc(db, "products", id));
  if (!snap.exists()) {
    toast("Product not found.", "error");
    return;
  }
  const d = snap.data();
  
  // ---- Basic fields ----
  $("productId").value = id;
  $("productName").value = d.name || "";
  $("productPrice").value = d.price || "";
  $("productDesc").value = d.description || "";
  $("productActive").checked = d.active !== false;
  
  // ---- Shipping ----
  const shipType =
    d.shippingType ||
    (d.shippingFee && d.shippingFee !== "Free" ? "paid" : "free");
  
  const shipRadio = document.querySelector(
    `input[name="shippingType"][value="${shipType}"]`
  );
  if (shipRadio) shipRadio.checked = true;
  
  $("shippingAmountWrap").classList.toggle("hidden", shipType !== "paid");
  $("shippingAmount").value = shipType === "paid" ? (d.shippingFee || "") : "";
  
  // ---- Media ----
  const mediaType =
    d.mediaType ||
    (d.video ? "video" : d.youtube ? "youtube" : "image");
  
  const mediaRadio = document.querySelector(
    `input[name="mediaType"][value="${mediaType}"]`
  );
  if (mediaRadio) mediaRadio.checked = true;
  
  // Restore the correct URL in the new unified field
  const mediaUrl =
    d.mediaUrl ||
    d.image ||
    d.video ||
    d.youtube ||
    "";
  $("productMediaUrl").value = mediaUrl;
  
  // Refresh label + YouTube preview
  if (typeof updateMediaField === "function") updateMediaField();
  
  // ---- UI feedback ----
  $("adProductFormTitle").textContent = "✏️ Edit Product";
  const submitBtn = $("productForm").querySelector(".btn-primary");
  if (submitBtn) submitBtn.textContent = "💾 Update Product";
  
  adGo("products");
  $("productForm").scrollIntoView({ behavior: "smooth", block: "start" });
  toast("Editing: " + (d.name || "product"), "info", 2500);
};

window.deleteProduct = async (id) => {
  if (!confirm("Delete this product permanently?")) return;
  try {
    await deleteDoc(doc(db, "products", id));
    toast("Product deleted.", "success");
  } catch (e) { toast("Delete failed.", "error"); }
};

// ============================================================
// PRODUCT CARD — toggle inline details on mobile
// ============================================================
window.toggleProductDetails = (productId, btn) => {
  const card = document.querySelector(`.product-card[data-product-id="${productId}"]`);
  if (!card) return;
  
  const desc = card.querySelector(".product-desc-wrap");
  if (!desc) return;
  
  const isOpen = desc.classList.toggle("open");
  
  // Swap arrow + label
  const label = btn.querySelector(".label");
  const arrow = btn.querySelector(".arrow");
  if (label) label.textContent = isOpen ? "Hide Details" : "More Details";
  if (arrow) arrow.textContent = isOpen ? "▴" : "▾";
  
  // Recalculate any lazy stuff (optional)
  card.classList.toggle("details-open", isOpen);
};

window.resetProductForm = () => {
  $("productForm").reset();
  $("productId").value = "";
  $("productActive").checked = true;
};

window.deleteProduct = async (id) => {
  if (confirm("Delete this product?")) await deleteDoc(doc(db, "products", id));
};
window.toggleProduct = async (id, cur) => {
  await updateDoc(doc(db, "products", id), { active: !cur });
};

// ---- SLIDES ADMIN ----
function setupSlidesAdmin() {
  const form = $("slideForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("slideId").value;
    const data = {
      title: $("slideTitle").value.trim(),
      price: $("slidePrice").value.trim(),
      image: $("slideImage").value.trim(),
      video: $("slideVideo").value.trim(),
      description: $("slideDesc").value.trim(),
      active: $("slideActive").checked
    };
    try {
      if (id) {
        await updateDoc(doc(db, "slides", id), data);
        toast("Slide updated.", "success");
      } else {
        await addDoc(collection(db, "slides"), data);
        toast("Slide added.", "success");
      }
      resetSlideForm();
    } catch (err) {
      console.error(err);
      toast("Failed to save slide.", "error");
    }
  });
  
  onSnapshot(collection(db, "slides"), (snap) => {
    const list = $("adminSlideList");
    list.innerHTML = "";
    if (snap.empty) {
      list.innerHTML = '<p class="ud-empty">No slides yet. Add your first one above.</p>';
      return;
    }
    snap.forEach(d => {
      const s = d.data();
      const div = document.createElement("div");
      div.className = "ad-item";
      div.innerHTML = `
        <img class="ad-item-thumb" src="${s.image || ''}" alt="">
        <div class="ad-item-body">
          <h5>
            ${s.title}
            <span class="ad-badge ${s.active ? 'on' : 'off'}">${s.active ? 'Active' : 'Inactive'}</span>
          </h5>
          <p><span class="price">${s.price}</span> · ${s.description?.slice(0, 50) || ""}${s.description?.length > 50 ? "…" : ""}</p>
        </div>
        <div class="ad-item-actions">
          <button class="btn-edit" onclick="editSlide('${d.id}')">Edit</button>
          <button class="btn-toggle" onclick="toggleSlide('${d.id}', ${s.active})">${s.active ? "Disable" : "Enable"}</button>
          <button class="btn-delete" onclick="deleteSlide('${d.id}')">Delete</button>
        </div>`;
      list.appendChild(div);
    });
  });
}

window.resetSlideForm = () => {
  $("slideForm").reset();
  $("slideId").value = "";
  $("slideActive").checked = true;
  $("adSlideFormTitle").textContent = "➕ Add New Slide";
  $("slideForm").querySelector(".btn-primary").textContent = "💾 Save Slide";
};

window.deleteSlide = async (id) => {
  if (!confirm("Delete this slide permanently?")) return;
  try {
    await deleteDoc(doc(db, "slides", id));
    toast("Slide deleted.", "success");
  } catch (e) { toast("Delete failed.", "error"); }
};

window.toggleSlide = async (id, cur) => {
  try {
    await updateDoc(doc(db, "slides", id), { active: !cur });
    toast(`Slide ${!cur ? "activated" : "deactivated"}.`, "success");
  } catch (e) { toast("Update failed.", "error"); }
};

// ============================================================
// ABOUT & CONTACT ADMIN
// ============================================================
function setupAboutContactAdmin() {
  // ============================================================
  // ABOUT (unchanged)
  // ============================================================
  const aboutForm = document.getElementById("aboutForm");
  if (aboutForm) {
    aboutForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id          = document.getElementById("aboutId").value;
      const title       = document.getElementById("aboutTitleInput").value.trim();
      const description = document.getElementById("aboutDescInput").value.trim();
      const image       = document.getElementById("aboutImageInput").value.trim();
      const active      = document.getElementById("aboutActiveInput").checked;

      if (!title || !description) {
        toast("Title and description are required.", "warning");
        return;
      }
      const data = { title, description, image, active, updatedAt: serverTimestamp() };
      try {
        if (id) {
          await updateDoc(doc(db, "aboutItems", id), data);
          toast("About item updated.", "success");
        } else {
          data.createdAt = serverTimestamp();
          await addDoc(collection(db, "aboutItems"), data);
          toast("About item added.", "success");
        }
        resetAboutForm();
      } catch (err) {
        console.error(err);
        toast("Save failed: " + (err.code || err.message), "error");
      }
    });
  }

  onSnapshot(collection(db, "aboutItems"), (snap) => {
    const list = document.getElementById("adminAboutList");
    if (!list) return;
    list.innerHTML = "";
    const cnt = document.getElementById("adAboutCount");
    if (cnt) cnt.textContent = snap.size;
    if (snap.empty) {
      list.innerHTML = '<p class="ud-empty">No About items yet.</p>';
      return;
    }
    snap.forEach(d => {
      const a = d.data();
      const div = document.createElement("div");
      div.className = "ad-item";
      div.innerHTML = `
        ${a.image ? `<img class="ad-item-thumb" src="${a.image}" alt="">` : ""}
        <div class="ad-item-body">
          <h5>${a.title} <span class="ad-badge ${a.active ? 'on' : 'off'}">${a.active ? 'Active' : 'Inactive'}</span></h5>
          <p>${(a.description || "").slice(0, 80)}${a.description?.length > 80 ? "…" : ""}</p>
        </div>
        <div class="ad-item-actions">
          <button class="btn-edit" onclick="editAbout('${d.id}')">Edit</button>
          <button class="btn-toggle" onclick="toggleAbout('${d.id}', ${a.active})">${a.active ? "Disable" : "Enable"}</button>
          <button class="btn-delete" onclick="deleteAbout('${d.id}')">Delete</button>
        </div>`;
      list.appendChild(div);
    });
  });

  // ============================================================
  // CONTACT ITEMS (new)
  // ============================================================
  const contactItemForm = document.getElementById("contactItemForm");
  const typeRadios      = document.querySelectorAll('input[name="contactType"]');

  typeRadios.forEach(r => {
    r.addEventListener("change", updateContactFormFields);
  });

  // ============================================================
// CONTACT FORM — SAVE with auto-fill for next entry
// ============================================================
if (contactItemForm) {
  contactItemForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const id       = document.getElementById("contactId").value;
    const type     = document.querySelector('input[name="contactType"]:checked').value;
    const platform = type === "social" ? document.getElementById("contactPlatform").value : "";
    const label    = document.getElementById("contactLabelInput").value.trim();
    const value    = document.getElementById("contactValueInput").value.trim();
    const icon     = document.getElementById("contactIconInput").value.trim();
    const active   = document.getElementById("contactActiveInput").checked;

    if (!label || !value) {
      toast("Label and value are required.", "warning");
      return;
    }

    const data = {
      type, platform, label, value, icon, active,
      updatedAt: serverTimestamp()
    };

    try {
      if (id) {
        await updateDoc(doc(db, "contacts", id), data);
        toast("Contact updated.", "success");
        // After EDIT, fully reset back to add-new mode
        resetContactForm();
      } else {
        data.createdAt = serverTimestamp();
        data.order = Date.now();
        await addDoc(collection(db, "contacts"), data);
        toast("Contact added.", "success");
        // After ADD, keep type/platform/label for fast re-entry
        keepContactFormForNext(type, platform, label);
      }
    } catch (err) {
      console.error(err);
      toast("Save failed: " + (err.code || err.message), "error");
    }
  });
}

  onSnapshot(collection(db, "contacts"), (snap) => {
    const list = document.getElementById("adminContactList");
    if (!list) return;
    list.innerHTML = "";
    const cnt = document.getElementById("adContactCount");
    if (cnt) cnt.textContent = snap.size;

    if (snap.empty) {
      list.innerHTML = '<p class="ud-empty">No contact items yet. Add your first one above.</p>';
      return;
    }

    snap.forEach(d => {
      const c = d.data();
      const icon = c.icon || defaultContactIcon(c);
      const div = document.createElement("div");
      div.className = "ad-item";
      div.innerHTML = `
        <div class="contact-icon" style="width:44px;height:44px;border-radius:50%;background:#f0f9ff;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">${icon}</div>
        <div class="ad-item-body">
          <h5>${c.label} <span class="ad-badge ${c.active ? 'on' : 'off'}">${c.active ? 'Active' : 'Inactive'}</span></h5>
          <p>${c.value}${c.platform ? ` · ${c.platform}` : ""}</p>
        </div>
        <div class="ad-item-actions">
          <button class="btn-edit" onclick="editContact('${d.id}')">Edit</button>
          <button class="btn-toggle" onclick="toggleContact('${d.id}', ${c.active})">${c.active ? "Disable" : "Enable"}</button>
          <button class="btn-delete" onclick="deleteContact('${d.id}')">Delete</button>
        </div>`;
      list.appendChild(div);
    });
  });

  // ============================================================
  // MAP URL (separate)
  // ============================================================
  const mapForm = document.getElementById("contactMapForm");
  if (mapForm) {
    mapForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const mapUrl = document.getElementById("contactMapInput").value.trim();
      try {
        await setDoc(doc(db, "settings", "contact"), { mapUrl, updatedAt: serverTimestamp() }, { merge: true });
        toast("Map location saved.", "success");
      } catch (err) {
        console.error(err);
        toast("Failed to save map.", "error");
      }
    });

    onSnapshot(doc(db, "settings", "contact"), (d) => {
      if (d.exists() && document.getElementById("contactMapInput")) {
        document.getElementById("contactMapInput").value = d.data().mapUrl || "";
      }
    });
  }
}

// ---- Update contact form fields when type changes ----
function updateContactFormFields() {
  const type = document.querySelector('input[name="contactType"]:checked')?.value || "phone";
  const platformWrap  = document.getElementById("socialPlatformWrap");
  const labelField    = document.getElementById("contactLabelField");
  const labelInput    = document.getElementById("contactLabelInput");
  const valueField    = document.getElementById("contactValueField");
  const valueInput    = document.getElementById("contactValueInput");
  const iconHint      = document.getElementById("contactIconHint");

  if (!labelInput || !valueInput) return;

  // Reset toggles
  platformWrap.classList.add("hidden");

  if (type === "phone") {
    labelField.textContent = "Label";
    labelInput.placeholder = "e.g. Call Us";
    valueField.textContent = "Phone Number";
    valueInput.placeholder = "e.g. +255 700 000 000";
    iconHint.textContent = "Leave blank to use 📞 automatically";
  } else if (type === "email") {
    labelField.textContent = "Label";
    labelInput.placeholder = "e.g. Email Us";
    valueField.textContent = "Email Address";
    valueInput.placeholder = "e.g. info@business.com";
    iconHint.textContent = "Leave blank to use ✉️ automatically";
  } else if (type === "social") {
    platformWrap.classList.remove("hidden");
    labelField.textContent = "Label";
    labelInput.placeholder = "e.g. Follow Us";
    valueField.textContent = "Link URL";
    valueInput.placeholder = "e.g. https://instagram.com/yourbusiness";
    iconHint.textContent = "Leave blank to use the platform's icon automatically";
  } else {
    // other
    labelField.textContent = "Label";
    labelInput.placeholder = "e.g. Working Hours";
    valueField.textContent = "Value";
    valueInput.placeholder = "e.g. Mon–Sat · 8am–6pm";
    iconHint.textContent = "Paste an emoji, HTML entity, or <i class=\"fa fa-...\"></i>";
  }
}

// ---- Build clickable link for a contact item ----
function buildContactLink(c) {
  if (c.type === "phone") return `tel:${c.value.replace(/[^\d+]/g, "")}`;
  if (c.type === "email") return `mailto:${c.value}`;
  if (c.type === "social" || c.type === "other") {
    if (/^https?:\/\//i.test(c.value)) return c.value;
  }
  return "#";
}

// ---- Reset contact form ----
window.resetContactForm = () => {
  const form = document.getElementById("contactItemForm");
  if (form) form.reset();
  const idEl = document.getElementById("contactId");
  if (idEl) idEl.value = "";
  document.querySelector('input[name="contactType"][value="phone"]').checked = true;
  document.getElementById("contactActiveInput").checked = true;
  const title = document.getElementById("adContactFormTitle");
  if (title) title.textContent = "➕ Add Contact Item";
  const btn = document.querySelector("#contactItemForm .btn-primary");
  if (btn) btn.textContent = "💾 Save Contact";
  updateContactFormFields();
};

// ---- Edit contact ----
window.editContact = async (id) => {
  try {
    const snap = await getDoc(doc(db, "contacts", id));
    if (!snap.exists()) { toast("Not found.", "error"); return; }
    const c = snap.data();

    document.getElementById("contactId").value = id;
    document.querySelector(`input[name="contactType"][value="${c.type || 'phone'}"]`).checked = true;
    document.getElementById("contactLabelInput").value = c.label || "";
    document.getElementById("contactValueInput").value = c.value || "";
    document.getElementById("contactIconInput").value  = c.icon || "";
    document.getElementById("contactActiveInput").checked = c.active !== false;

    if (c.type === "social" && c.platform) {
      document.getElementById("contactPlatform").value = c.platform;
    }

    updateContactFormFields();

    document.getElementById("adContactFormTitle").textContent = "✏️ Edit Contact Item";
    const btn = document.querySelector("#contactItemForm .btn-primary");
    if (btn) btn.textContent = "💾 Update Contact";

    adGo("contact");
    document.getElementById("contactItemForm").scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Editing: " + c.label, "info", 2000);
  } catch (err) {
    console.error(err);
    toast("Load failed.", "error");
  }
};

// ============================================================
// KEEP CONTACT FORM READY FOR NEXT ENTRY
// After saving, keep type + platform + label pre-filled so the
// admin can add another entry of the same kind quickly.
// ============================================================
window.keepContactFormForNext = (type, platform, label) => {
  // 1. Clear the hidden ID (so the next save creates a NEW doc)
  const idEl = document.getElementById("contactId");
  if (idEl) idEl.value = "";

  // 2. Keep the selected type
  const typeRadio = document.querySelector(`input[name="contactType"][value="${type}"]`);
  if (typeRadio) typeRadio.checked = true;

  // 3. Keep the platform if social
  if (type === "social" && platform) {
    const platSel = document.getElementById("contactPlatform");
    if (platSel) platSel.value = platform;
  }

  // 4. Keep the label, clear the value
  const labelEl = document.getElementById("contactLabelInput");
  const valueEl = document.getElementById("contactValueInput");
  const iconEl  = document.getElementById("contactIconInput");

  if (labelEl) {
    labelEl.value = "";                       // clear
    labelEl.placeholder = label + " (next)";  // hint
    labelEl.dataset.lastLabel = label;
  }
  if (valueEl) valueEl.value = "";
  if (iconEl)  iconEl.value  = "";

  // 5. Keep the Active checkbox checked
  const activeEl = document.getElementById("contactActiveInput");
  if (activeEl) activeEl.checked = true;

  // 6. Update form field labels + hints for the current type
  if (typeof updateContactFormFields === "function") {
    updateContactFormFields();
  }

  // 7. Restore form title to "Add" (in case it was edit mode)
  const titleEl = document.getElementById("adContactFormTitle");
  if (titleEl) titleEl.textContent = "➕ Add Contact Item";

  // 8. Reset submit button text
  const btn = document.querySelector("#contactItemForm .btn-primary");
  if (btn) btn.textContent = "💾 Save Contact";

  // 9. Auto-focus the value input (unless on mobile where it pops keyboard abruptly)
  if (valueEl && window.innerWidth >= 900) {
    valueEl.focus();
  }

  // 10. Scroll form into view
  const formEl = document.getElementById("contactItemForm");
  if (formEl) formEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
};

// ---- Toggle active ----
window.toggleContact = async (id, cur) => {
  try {
    await updateDoc(doc(db, "contacts", id), { active: !cur });
    toast(`Contact ${!cur ? "activated" : "deactivated"}.`, "success");
  } catch (err) { toast("Update failed.", "error"); }
};

// ---- Delete ----
window.deleteContact = async (id) => {
  if (!confirm("Delete this contact item permanently?")) return;
  try {
    await deleteDoc(doc(db, "contacts", id));
    toast("Contact deleted.", "success");
  } catch (err) { toast("Delete failed.", "error"); }
};


// ============================================================
// Small action hint shown under each card
// ============================================================
function actionHint(c) {
  if (c.type === "phone") return "Tap to call";
  if (c.type === "email") return "Tap to email";
  if (c.type === "social") return "Tap to open";
  if (/^https?:\/\//i.test(c.value || "")) return "Tap to open";
  return "Tap to copy";
}

// ============================================================
// Fallbacks (in case main helpers are missing)
// ============================================================
function fallbackContactIcon(c) {
  if (c.icon) return c.icon;
  if (c.type === "phone") return "📞";
  if (c.type === "email") return "✉️";
  if (c.type === "social") {
    const map = {
      facebook: "📘", instagram: "📷", whatsapp: "💬", tiktok: "🎵",
      twitter: "🐦", youtube: "▶️", linkedin: "💼", telegram: "✈️",
      snapchat: "👻", pinterest: "📌", other: "🔗"
    };
    return map[c.platform] || "🔗";
  }
  return "🔧";
}



function fallbackContactLink(c) {
  if (c.type === "phone") return "tel:" + String(c.value || "").replace(/[^\d+]/g, "");
  if (c.type === "email") return "mailto:" + c.value;
  if (/^https?:\/\//i.test(c.value || "")) return c.value;
  return "#";
}

// ---- About form reset ----
window.resetAboutForm = () => {
  const form = document.getElementById("aboutForm");
  if (form) form.reset();
  const idEl = document.getElementById("aboutId");
  if (idEl) idEl.value = "";
  const activeEl = document.getElementById("aboutActiveInput");
  if (activeEl) activeEl.checked = true;
  const titleEl = document.getElementById("adAboutFormTitle");
  if (titleEl) titleEl.textContent = "➕ Add About Item";
  const btn = document.querySelector("#aboutForm .btn-primary");
  if (btn) btn.textContent = "💾 Save Item";
};

// ---- Edit About item ----
window.editAbout = async (id) => {
  try {
    const snap = await getDoc(doc(db, "aboutItems", id));
    if (!snap.exists()) { toast("Item not found.", "error"); return; }
    const a = snap.data();

    document.getElementById("aboutId").value         = id;
    document.getElementById("aboutTitleInput").value = a.title || "";
    document.getElementById("aboutDescInput").value  = a.description || "";
    document.getElementById("aboutImageInput").value = a.image || "";
    document.getElementById("aboutActiveInput").checked = a.active !== false;

    document.getElementById("adAboutFormTitle").textContent = "✏️ Edit About Item";
    const btn = document.querySelector("#aboutForm .btn-primary");
    if (btn) btn.textContent = "💾 Update Item";

    adGo("about");
    document.getElementById("aboutForm").scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Editing: " + (a.title || "item"), "info", 2000);
  } catch (err) {
    console.error(err);
    toast("Failed to load item.", "error");
  }
};

// ---- Toggle active ----
window.toggleAbout = async (id, cur) => {
  try {
    await updateDoc(doc(db, "aboutItems", id), { active: !cur });
    toast(`Item ${!cur ? "activated" : "deactivated"}.`, "success");
  } catch (err) {
    toast("Update failed.", "error");
  }
};

// ---- Delete item ----
window.deleteAbout = async (id) => {
  if (!confirm("Delete this About item permanently?")) return;
  try {
    await deleteDoc(doc(db, "aboutItems", id));
    toast("Item deleted.", "success");
  } catch (err) {
    toast("Delete failed.", "error");
  }
};


// ============================================================
// SUPERADMIN DASHBOARD
// ============================================================
function renderSuperAdmin() {
  // Users list with role management
  onSnapshot(collection(db, "users"), (snap) => {
    const list = $("userManagementList");
    list.innerHTML = "";
    let count = 0;
    snap.forEach(d => {
      count++;
      const u = d.data();
      const div = document.createElement("div");
      div.className = "admin-item";
      div.innerHTML = `
        <span>${u.username} (${u.role}) — ${u.phone}</span>
        <div class="actions">
          <select onchange="changeUserRole('${d.id}', this.value)" style="padding:0.4rem;border-radius:6px;">
            <option value="user" ${u.role === "user" ? "selected" : ""}>User</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
            <option value="superadmin" ${u.role === "superadmin" ? "selected" : ""}>Superadmin</option>
          </select>
          <button class="btn-toggle" onclick="toggleUserActive('${d.id}', ${u.active !== false})">${u.active !== false ? "Deactivate" : "Activate"}</button>
        </div>`;
      list.appendChild(div);
    });
    $("statUsers").textContent = count;
  });

  onSnapshot(collection(db, "products"), (s) => $("statProducts").textContent = s.size);
  onSnapshot(collection(db, "slides"), (s) => $("statSlides").textContent = s.size);
}

window.changeUserRole = async (uid, role) => {
  await updateDoc(doc(db, "users", uid), { role });
  toast(`Role updated to ${role}.`, "success");
};
window.toggleUserActive = async (uid, cur) => {
  await updateDoc(doc(db, "users", uid), { active: !cur });
};

// ============================================================
// PUBLIC SITE — PRODUCTS
// ============================================================
function loadPublicProducts() {
  const q = query(collection(db, "products"), where("active", "==", true));
  onSnapshot(q, (snap) => {
    const container = $("productContainer");
    if (!container) return;
    container.innerHTML = "";
    if (snap.empty) {
      container.innerHTML = "<p style='text-align:center;grid-column:1/-1'>No products available yet.</p>";
      return;
    }
    snap.forEach(d => renderProduct({ id: d.id, ...d.data() }));
  });
}

function renderProduct(product) {
  const container = $("productContainer");
  const card = document.createElement("div");
  card.className = "product-card";
  card.dataset.productId = product.id;
  
  // ---- Media ----
  let mediaHtml = "";
  const type = product.mediaType || (product.video ? "video" : product.youtube ? "youtube" : "image");
  const url = product.mediaUrl || product.image || product.video || product.youtube;
  
  if (type === "youtube") {
    const ytId = extractYoutubeId(url);
    mediaHtml = ytId ?
      `<iframe class="product-yt" src="https://www.youtube.com/embed/${ytId}" frameborder="0" allowfullscreen></iframe>` :
      `<img src="" alt="${product.name}">`;
  } else if (type === "video") {
    mediaHtml = `<video src="${url}" autoplay muted loop playsinline></video>`;
  } else {
    mediaHtml = `<img src="${url}" alt="${product.name}">`;
  }
  
  const shipLabel = product.shippingType === "free" ?
    "🆓 Free Shipping" :
    product.shippingFee ? `🚚 Shipping: ${product.shippingFee}` : "";
  
  card.innerHTML = `
    <div class="product-media">
      ${mediaHtml}
    </div>

    <div class="product-info">
      <h3>${product.name}</h3>

      <p class="price">${product.price}</p>
      ${shipLabel ? `<p class="ship-tag">${shipLabel}</p>` : ""}

      <!-- Collapsible description -->
      <div class="product-desc-wrap">
        <div class="product-desc formatted" id="desc-${product.id}">
          ${formatDescription(product.description)}
        </div>
      </div>

      <!-- Mobile-only toggle -->
      <button
        type="button"
        class="btn-more-details"
        onclick="toggleProductDetails('${product.id}', this)">
        <span class="label">More Details</span>
        <span class="arrow">▾</span>
      </button>

      <div class="product-actions">
        <button class="btn-add-cart"   onclick='openProductModalById("${product.id}", "cart")'>🛒 Add to Cart</button>
        <button class="btn-place-order" onclick='openProductModalById("${product.id}", "order")'>⚡ Place Order</button>
      </div>
    </div>
  `;
  container.appendChild(card);
}

let _allPublicProducts = [];
onSnapshot(query(collection(db, "products"), where("active", "==", true)), (snap) => {
  _allPublicProducts = [];
  snap.forEach(d => _allPublicProducts.push({ id: d.id, ...d.data() }));
});

window.openProductModalById = (id) => {
  const p = _allPublicProducts.find(x => x.id === id);
  if (!p) return;
  openProductModal(p);
};

window.openProductModal = (product, intent) => {
  $("modalTitle").textContent = product.name;
  $("modalPrice").textContent = product.price;
$("modalDesc").innerHTML = formatDescription(product.description);
  
  // Shipping tag
  const shipTag = $("modalShipTag");
  if (product.shippingType === "free") {
    shipTag.textContent = "🆓 Free Shipping";
    shipTag.style.display = "inline-block";
  } else if (product.shippingFee) {
    shipTag.textContent = `🚚 Shipping: ${product.shippingFee}`;
    shipTag.style.display = "inline-block";
  } else {
    shipTag.style.display = "none";
  }
  
  const img = $("modalImage");
  const vid = $("modalVideo");
  const mediaWrap = document.querySelector(".modal-media");
  mediaWrap.querySelector(".modal-yt")?.remove();
  
  const type = product.mediaType || (product.video ? "video" : product.youtube ? "youtube" : "image");
  const url = product.mediaUrl || product.image || product.video || product.youtube;
  
  img.style.display = "none";
  vid.style.display = "none";
  vid.pause();
  vid.src = "";
  
  if (type === "youtube") {
    const ytId = extractYoutubeId(url);
    if (ytId) {
      const iframe = document.createElement("iframe");
      iframe.className = "modal-yt";
      iframe.src = `https://www.youtube.com/embed/${ytId}?autoplay=1`;
      iframe.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture";
      iframe.allowFullscreen = true;
      iframe.style.cssText = "width:100%;aspect-ratio:16/9;border:none;border-radius:8px;margin-bottom:1rem;";
      mediaWrap.appendChild(iframe);
    }
  } else if (type === "video") {
    vid.style.display = "block";
    vid.src = url;
    vid.play().catch(() => {});
  } else {
    img.style.display = "block";
    img.src = url;
  }
  
  // Reset quantity each time modal opens
  setModalQty(1);
  
  // Bind modal buttons — pass the current quantity
  $("modalAddCart").onclick = () => addToCart(product.id, _modalQty);
  $("modalPlaceOrder").onclick = () => placeOrder(product.id, _modalQty);
  
  // Highlight the button the user tapped on the card
  const addBtn = $("modalAddCart");
  const orderBtn = $("modalPlaceOrder");
  addBtn.classList.remove("pulse-highlight");
  orderBtn.classList.remove("pulse-highlight");
  
  if (intent === "cart") addBtn.classList.add("pulse-highlight");
  if (intent === "order") orderBtn.classList.add("pulse-highlight");
  
  $("productModal").classList.add("active");
};

window.closeProductModal = () => {
  $("productModal").classList.remove("active");
  const vid = $("modalVideo");
  if (vid) { vid.pause(); vid.src = ""; }
  document.querySelectorAll(".modal-yt").forEach(el => el.remove());
};

// View toggle
$("gridViewBtn")?.addEventListener("click", () => {
  currentView = "grid";
  $("productContainer").className = "product-grid";
  $("gridViewBtn").classList.add("active");
  $("listViewBtn").classList.remove("active");
});
$("listViewBtn")?.addEventListener("click", () => {
  currentView = "list";
  $("productContainer").className = "product-list";
  $("listViewBtn").classList.add("active");
  $("gridViewBtn").classList.remove("active");
});

// ============================================================
// PUBLIC SITE — SLIDES
// ============================================================
function loadSlides() {
  const q = query(collection(db, "slides"), where("active", "==", true));
  onSnapshot(q, (snap) => {
    slides = [];
    snap.forEach(d => slides.push({ id: d.id, ...d.data() }));
    renderSlides();
    startAutoSlide();
  });
}

function renderSlides() {
  const container = $("slideshow");
  const dots = $("slideDots");
  if (!container) return;
  container.innerHTML = "";
  dots.innerHTML = "";
  if (!slides.length) {
    container.innerHTML = "<div class='slide active'><div class='slide-info'><h2>Welcome</h2></div></div>";
    return;
  }
  slides.forEach((slide, i) => {
    const div = document.createElement("div");
    div.className = "slide" + (i === 0 ? " active" : "");
    div.innerHTML = `
      ${slide.video
        ? `<video src="${slide.video}" autoplay muted loop playsinline></video>`
        : `<img src="${slide.image}" alt="${slide.title}">`}
      <div class="slide-info">
        <h2>${slide.title}</h2>
        <p class="price-tag">${slide.price}</p>
        <button class="btn-order" onclick='openSlideModalById("${slide.id}")'>More Details</button>
      </div>`;
    container.appendChild(div);

    const dot = document.createElement("span");
    dot.className = "dot" + (i === 0 ? " active" : "");
    dot.onclick = () => goToSlide(i);
    dots.appendChild(dot);
  });
  currentSlide = 0;
}

window.changeSlide = (dir) => {
  if (!slides.length) return;
  currentSlide = (currentSlide + dir + slides.length) % slides.length;
  goToSlide(currentSlide);
};

function goToSlide(i) {
  currentSlide = i;
  document.querySelectorAll("#slideshow .slide").forEach((s, idx) => s.classList.toggle("active", idx === i));
  document.querySelectorAll("#slideDots .dot").forEach((d, idx) => d.classList.toggle("active", idx === i));
  startAutoSlide();
}

function startAutoSlide() {
  clearInterval(slideIntervalId);
  if (slides.length > 1) slideIntervalId = setInterval(() => changeSlide(1), 5000);
}

window.openSlideModalById = (id) => {
  const s = slides.find(x => x.id === id);
  if (!s) return;
  openProductModal({
    name: s.title,
    price: s.price,
    description: s.description,
    image: s.image,
    video: s.video
  });
};

// ============================================================
// ABOUT — render (2 per row + link mode + more details)
// ============================================================
function loadAboutContact() {
  const q = query(collection(db, "aboutItems"), where("active", "==", true));
  
  onSnapshot(q, (snap) => {
    const container = document.getElementById("aboutContainer");
    if (!container) return;
    container.innerHTML = "";
    
    if (snap.empty) {
      container.innerHTML = '<p class="about-desc">No About information available yet.</p>';
      return;
    }
    
    // ---- Collect + sort ----
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    items.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    
    // If only one item, apply a full-width variant
    container.classList.toggle("single", items.length === 1);
    
    // ---- Render each ----
    items.forEach(item => {
      const card = buildAboutCard(item);
      container.appendChild(card);
    });
  }, (err) => {
    console.error("About listener error:", err.code, err.message);
    const container = document.getElementById("aboutContainer");
    if (container) {
      container.innerHTML = '<p class="about-desc">Failed to load about info.</p>';
    }
  });
}

// ============================================================
// BUILD A SINGLE ABOUT CARD
// ============================================================
function buildAboutCard(a) {
  const card = document.createElement("div");
  card.className = "about-card";
  
  // ---- Detect link mode ----
  // Link can come from:
  //   • a.link        (explicit field)
  //   • a.url         (alias)
  //   • a.title containing a URL isn't typical — so we keep it simple
  const link = (a.link || a.url || "").trim();
  const isLink = /^https?:\/\//i.test(link) || /^#/.test(link);
  if (isLink) card.classList.add("link-mode");
  
  // ---- Image ----
  let imageHtml = "";
  if (a.image) {
    const img = document.createElement("img");
    img.className = "about-card-img";
    img.src = a.image;
    img.alt = a.title || "";
    img.loading = "lazy";
    imageHtml = img.outerHTML;
  }
  
  // ---- Title ----
  const titleText = escapeHtml(a.title || "");
  const titleHtml = isLink ?
    `<a href="${link}" ${link.startsWith("http") ? 'target="_blank" rel="noopener noreferrer"' : ""}>${titleText}</a>` :
    titleText;
  
  // ---- Description ----
  const rawDesc = a.description || "";
  const formatted = formatDescription(rawDesc);
  
  // Long-text detection:
  //   • more than 220 characters, OR
  //   • more than 4 rendered "lines" worth (rough estimate)
  const cleanText = String(rawDesc).replace(/\s+/g, " ").trim();
  const isLong = cleanText.length > 220;
  
  // ---- Assemble card ----
  card.innerHTML = `
    ${imageHtml}
    <div class="about-card-body">
      <h3>${titleHtml}</h3>

      <div class="about-desc-wrap ${isLong ? "long collapsed" : "short"}">
        <div class="about-desc formatted">${formatted}</div>
      </div>

      ${isLong ? `
        <button
          type="button"
          class="btn-about-more"
          data-about-id="${a.id}">
          <span class="label">More Details</span>
          <span class="arrow">▾</span>
        </button>` : ""}
    </div>
  `;
  
  // ---- Link mode: whole card clickable (except the More Details button) ----
  if (isLink) {
    card.addEventListener("click", (e) => {
      // If user tapped the More Details button or its children, ignore
      if (e.target.closest(".btn-about-more")) return;
      
      // Don't double-navigate if they tapped the title anchor
      if (e.target.closest("a")) return;
      
      if (link.startsWith("http")) {
        window.open(link, "_blank", "noopener,noreferrer");
      } else {
        // Same-page anchor
        const target = document.querySelector(link);
        if (target) target.scrollIntoView({ behavior: "smooth" });
      }
    });
  }
  
  // ---- Wire the More Details button ----
  const moreBtn = card.querySelector(".btn-about-more");
  if (moreBtn) {
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleAboutDetails(card, moreBtn);
    });
  }
  
  return card;
}

// ============================================================
// TOGGLE — expand/collapse long about description
// ============================================================
function toggleAboutDetails(card, btn) {
  const wrap = card.querySelector(".about-desc-wrap");
  if (!wrap) return;
  
  const expanded = wrap.classList.toggle("expanded");
  wrap.classList.toggle("collapsed", !expanded);
  
  const label = btn.querySelector(".label");
  const arrow = btn.querySelector(".arrow");
  if (label) label.textContent = expanded ? "Hide" : "More Details";
  if (arrow) arrow.textContent = expanded ? "▴" : "▾";
}

// expose for good measure
window.toggleAboutDetails = toggleAboutDetails;

// ============================================================
// INIT
// ============================================================
loadPublicProducts();
loadSlides();
loadAboutContact();
loadContacts();          // ← this line
showMainSite();
// ============================================================
// PASSWORD EYE TOGGLE
// ============================================================
window.togglePassword = (inputId, btn) => {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  btn.textContent = isHidden ? "🙈" : "👁️";
  btn.classList.toggle("showing", isHidden);
  btn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
};

// ============================================================
// TERMS MODAL (simple inline)
// ============================================================
window.openTerms = (e) => {
  e.preventDefault();
  const modal = document.createElement("div");
  modal.className = "terms-modal";
  modal.innerHTML = `
    <div class="terms-card">
      <button class="terms-close" onclick="this.closest('.terms-modal').remove()">&times;</button>
      <h3>Terms &amp; Conditions</h3>
      <p>Welcome to MyBusiness. By creating an account, you agree to the following terms:</p>
      <p><strong>1. Account Use.</strong> You are responsible for maintaining the confidentiality of your login credentials.</p>
      <p><strong>2. Data.</strong> We store your username, phone number, and email to provide our services.</p>
      <p><strong>3. Content.</strong> You may not misuse the platform for illegal activity.</p>
      <p><strong>4. Termination.</strong> We reserve the right to suspend accounts violating these terms.</p>
      <p><strong>5. Updates.</strong> These terms may change; continued use implies acceptance.</p>
    </div>
  `;
  document.body.appendChild(modal);
};

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
/**
 * Show a toast notification.
 * @param {string} message   Text to display
 * @param {string} type      'success' | 'error' | 'warning' | 'info'
 * @param {number} duration  Milliseconds before auto-dismiss (default 4000)
 */
function toast(message, type = "info", duration = 4000) {
  const container = document.getElementById("toastContainer");
  if (!container) { console.warn("Toast container not found"); return; }

  const icons = {
    success: "✅",
    error:   "❌",
    warning: "⚠️",
    info:    "ℹ️"
  };

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");

  el.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message"></span>
    <button class="toast-close" aria-label="Dismiss">&times;</button>
  `;

  // Use textContent to prevent HTML injection
  el.querySelector(".toast-message").textContent = message;

  // set animation duration on progress bar
  el.style.setProperty("--toast-duration", duration + "ms");
  el.querySelector(".toast-close").addEventListener("click", () => dismissToast(el));

  container.appendChild(el);

  // Trigger enter animation
  requestAnimationFrame(() => el.classList.add("show"));

  // Auto-dismiss
  const timer = setTimeout(() => dismissToast(el), duration);
  el._timer = timer;

  // Pause on hover (desktop nicety)
  el.addEventListener("mouseenter", () => clearTimeout(el._timer));
  el.addEventListener("mouseleave", () => {
    el._timer = setTimeout(() => dismissToast(el), 2000);
  });

  // Set progress animation duration dynamically
  el.style.animationDuration = duration + "ms";
  const style = document.createElement("style");
  style.textContent = `.toast::after { animation-duration: ${duration}ms; }`;
  el.appendChild(style);
}

function dismissToast(el) {
  if (!el || el._dismissed) return;
  el._dismissed = true;
  clearTimeout(el._timer);
  el.classList.remove("show");
  el.classList.add("hide");
  setTimeout(() => el.remove(), 300);
}

// Expose globally so you can call window.toast(...) from anywhere
window.toast = toast;

// ============================================================
// USER CART
// ============================================================
function loadUserCart() {
  if (!currentUser) return;
  const q = query(collection(db, "carts"), where("userId", "==", currentUser.uid));
  onSnapshot(q, (snap) => {
    const list = $("udCartList");
    list.innerHTML = "";
    let total = 0;
    let count = 0;

    if (snap.empty) {
      list.innerHTML = '<p class="ud-empty">Your cart is empty.</p>';
      $("udCartTotalWrap").style.display = "none";
    } else {
      snap.forEach(d => {
  const c = d.data();
  count++;
  const price = parseFloat(String(c.price).replace(/[^0-9.]/g, "")) || 0;
  const shipFee = c.shippingType === "paid" ?
    (parseFloat(String(c.shippingFee).replace(/[^0-9.]/g, "")) || 0) :
    0;
  total += (price * (c.qty || 1)) + shipFee;
  
  const div = document.createElement("div");
  div.className = "ud-item";
  div.innerHTML = `
    <img src="${c.image || ''}" alt="" style="width:52px;height:52px;object-fit:cover;border-radius:8px;">
    <div class="ud-item-info">
      <h5>${c.name}</h5>
      <p>Qty: ${c.qty || 1}${shipFee ? ` · 🚚 +${c.shippingFee}` : " · 🆓 Free ship"}</p>
    </div>
    <div style="text-align:right">
      <p class="ud-item-price">${c.price}</p>
      <div class="ud-item-actions">
        <button onclick="udRemoveFromCart('${d.id}')" title="Remove">&times;</button>
      </div>
    </div>`;
  list.appendChild(div);
});
      $("udCartTotal").textContent = "$" + total.toFixed(2);
      $("udCartTotalWrap").style.display = "flex";
    }

    $("udCartCount").textContent  = count;
    $("udStatCart").textContent   = count;
  });
}

window.udRemoveFromCart = async (id) => {
  try {
    await deleteDoc(doc(db, "carts", id));
    toast("Removed from cart.", "info");
  } catch (e) { toast("Failed to remove.", "error"); }
};

window.udCheckout = async () => {
  toast("Checkout coming soon!", "info");
};

// ============================================================
// MY BILLS — receipts, invoices, downloadable docs
// ============================================================
function loadUserBills() {
  if (!currentUser) return;
  const q = query(collection(db, "orders"), where("userId", "==", currentUser.uid));
  onSnapshot(q, (snap) => {
    const list = $("udBillsList");
    list.innerHTML = "";
    let pending = 0;
    
    if (snap.empty) {
      list.innerHTML = '<p class="ud-empty">No bills yet.</p>';
      $("udStatBills").textContent = 0;
      return;
    }
    
    const orders = [];
    snap.forEach(d => orders.push({ id: d.id, ...d.data() }));
    orders.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    
    orders.forEach(o => {
      if (o.status === "pending") pending++;
      
      const badgeClass = o.status === "approved" ? "on" : o.status === "rejected" ? "off" : "warn";
      const badgeText = o.status === "approved" ? "✅ Approved" :
        o.status === "rejected" ? "❌ Rejected" : "⏳ Pending approval";
      
      const itemsHtml = (o.items || []).map(it => `
        <div class="bill-item">
          ${it.image ? `<img src="${it.image}" alt="">` : ""}
          <div class="bill-item-info">
            <p><strong>${it.name}</strong></p>
            <p>Qty: ${it.qty} · ${it.price}</p>
          </div>
        </div>`).join("");
      
      const div = document.createElement("div");
      div.className = "ud-item bill-card";
      div.innerHTML = `
        <div class="bill-head">
          <div>
            <h5>Order ${o.reference || o.id.slice(0,8).toUpperCase()}</h5>
            <p class="bill-date">${o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString() : ""}</p>
          </div>
          <span class="ad-badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="bill-items">${itemsHtml}</div>
        <div class="bill-total">
          <span>Total</span>
          <strong>$${(o.grandTotal || 0).toFixed(2)}</strong>
        </div>
        <div class="bill-actions">
          ${o.status === "approved" ? `
            <button class="btn-primary" onclick="showReceipt('${o.id}')">🧾 Receipt</button>
            <button class="btn-secondary" onclick="showInvoice('${o.id}')">📄 Invoice</button>
            ${(o.deliveryDocs || []).length ? `<button class="btn-secondary" onclick="showDeliveryDocs('${o.id}')">📦 Delivery Docs</button>` : ""}
            <button class="btn-secondary" onclick="downloadAll('${o.id}')">⬇️ Download All</button>
          ` : `<p class="bill-wait">Payment will be verified by admin. Documents available after approval.</p>`}
        </div>`;
      list.appendChild(div);
    });
    
    $("udStatBills").textContent = pending;
  });
}

// ---------- Receipt ----------
window.showReceipt = async (orderId) => {
  const snap = await getDoc(doc(db, "orders", orderId));
  if (!snap.exists()) return toast("Not found.", "error");
  const o = snap.data();
  
  const userBlock = await buildUserDetailsBlock(o);
  
  const rows = (o.items || []).map(it => `
    <tr>
      <td>${it.image ? `<img src="${it.image}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:8px;">` : ""}${it.name}</td>
      <td>${it.qty}</td>
      <td>${it.price}</td>
      <td>$${((parseFloat(String(it.price).replace(/[^0-9.]/g,"")) || 0) * it.qty).toFixed(2)}</td>
    </tr>`).join("");
  
  openDocWindow("Receipt — " + (o.reference || orderId.slice(0, 8)), `
    <div class="doc-wrap">
      <div class="doc-head">
        <h1>🧾 RECEIPT</h1>
        <p class="doc-ref">Ref: ${o.reference || orderId.slice(0,8).toUpperCase()}</p>
        <p class="doc-date">${o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString() : ""}</p>
      </div>

      ${userBlock}

      <div class="doc-party">
        <p><strong>Paid via:</strong> ${o.paymentMethodName || "—"} (${o.paymentType || ""})</p>
        <p><strong>Payer:</strong> ${o.payerName || ""} · ${o.payerPhone || ""}</p>
      </div>

      <table class="doc-table">
        <thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="doc-totals">
        <p>Subtotal: $${(o.subtotal || 0).toFixed(2)}</p>
        <p>Shipping: $${(o.shipTotal || 0).toFixed(2)}</p>
        <h3>Total: $${(o.grandTotal || 0).toFixed(2)}</h3>
        <span class="paid-stamp">✅ PAID</span>
      </div>

      <div class="doc-foot">
        <p>Approved on ${o.approvedAt?.toDate ? o.approvedAt.toDate().toLocaleString() : ""}</p>
        <p>Thank you for your business!</p>
      </div>
    </div>
  `, { filename: "Receipt_" + (o.reference || orderId.slice(0, 8)) });
};

// ---------- Invoice ----------
window.showInvoice = async (orderId) => {
  const snap = await getDoc(doc(db, "orders", orderId));
  if (!snap.exists()) return toast("Not found.", "error");
  const o = snap.data();
  
  const userBlock = await buildUserDetailsBlock(o);
  
  const rows = (o.items || []).map(it => `
    <tr>
      <td>${it.name}</td>
      <td>${it.qty}</td>
      <td>${it.price}</td>
      <td>$${((parseFloat(String(it.price).replace(/[^0-9.]/g,"")) || 0) * it.qty).toFixed(2)}</td>
    </tr>`).join("");
  
  openDocWindow("Invoice — " + (o.reference || orderId.slice(0, 8)), `
    <div class="doc-wrap">
      <div class="doc-head">
        <h1>📄 INVOICE</h1>
        <p class="doc-ref">Invoice #${o.reference || orderId.slice(0,8).toUpperCase()}</p>
        <p class="doc-date">${o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString() : ""}</p>
      </div>

      ${userBlock}

      <table class="doc-table">
        <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="doc-totals">
        <p>Subtotal: $${(o.subtotal || 0).toFixed(2)}</p>
        <p>Shipping: $${(o.shipTotal || 0).toFixed(2)}</p>
        <h3>Total Due: $${(o.grandTotal || 0).toFixed(2)}</h3>
        <span class="paid-stamp">PAID — ${o.paymentMethodName || ""}</span>
      </div>
    </div>
  `, { filename: "Invoice_" + (o.reference || orderId.slice(0, 8)) });
};

// ---------- Delivery docs ----------
window.showDeliveryDocs = async (orderId) => {
  const snap = await getDoc(doc(db, "orders", orderId));
  if (!snap.exists()) return;
  const o = snap.data();
  
  const userBlock = await buildUserDetailsBlock(o);
  const docs = o.deliveryDocs || [];
  
  openDocWindow("Delivery Documents — " + (o.reference || orderId.slice(0, 8)), `
    <div class="doc-wrap">
      <h1>📦 Delivery Documents</h1>
      <p class="doc-ref">Order: ${o.reference || orderId.slice(0,8).toUpperCase()}</p>

      ${userBlock}

      ${docs.length === 0
        ? "<p>No delivery documents uploaded yet.</p>"
        : docs.map(d => `
          <div class="doc-block">
            <h3>${d.title || "Document"}</h3>
            ${d.image ? `<img src="${d.image}" style="max-width:100%;border-radius:8px;">` : ""}
            ${d.note ? `<p>${d.note}</p>` : ""}
          </div>`).join("")}
    </div>
  `, { filename: "DeliveryDocs_" + (o.reference || orderId.slice(0, 8)) });
};



// ---------- Download everything ----------
window.downloadAll = async (orderId) => {
  const snap = await getDoc(doc(db, "orders", orderId));
  if (!snap.exists()) return toast("Not found.", "error");
  const o = snap.data();
  
  // Build a single HTML file with everything
  const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Order ${o.reference}</title>
<style>
  body{font-family:Arial,sans-serif;padding:30px;color:#1e293b}
  h1{color:#0f172a}
  table{width:100%;border-collapse:collapse;margin:20px 0}
  th,td{border:1px solid #cbd5e1;padding:8px;text-align:left}
  th{background:#f1f5f9}
  .stamp{color:#22c55e;font-weight:bold;font-size:1.3rem}
</style></head>
<body>
  <h1>Order ${o.reference || orderId.slice(0,8)}</h1>
  <p><strong>Date:</strong> ${o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString() : ""}</p>
  <p><strong>Customer:</strong> ${o.userName} · ${o.userPhone || ""}</p>
  <p><strong>Payment:</strong> ${o.paymentMethodName} (${o.paymentType})</p>
  <p><strong>Payer:</strong> ${o.payerName} · ${o.payerPhone || ""}</p>
  <h2>Items</h2>
  <table>
    <tr><th>Product</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr>
    ${(o.items||[]).map(it => `<tr>
      <td>${it.name}</td><td>${it.qty}</td><td>${it.price}</td>
      <td>$${((parseFloat(String(it.price).replace(/[^0-9.]/g,""))||0)*it.qty).toFixed(2)}</td>
    </tr>`).join("")}
  </table>
  <p><strong>Subtotal:</strong> $${(o.subtotal||0).toFixed(2)}</p>
  <p><strong>Shipping:</strong> $${(o.shipTotal||0).toFixed(2)}</p>
  <h2>Total: $${(o.grandTotal||0).toFixed(2)}</h2>
  <p class="stamp">✅ APPROVED</p>
  ${o.approvedAt?.toDate ? `<p>Approved on: ${o.approvedAt.toDate().toLocaleString()}</p>` : ""}
</body></html>`;
  
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Order_${o.reference || orderId.slice(0,8)}.html`;
  a.click();
  URL.revokeObjectURL(url);
  
  toast("📥 Downloaded full order document.", "success");
};

// ============================================================
// DOCUMENT VIEWER — with Close / PDF / Image / Screenshot
// ============================================================
function openDocWindow(title, bodyHtml, options = {}) {
  const w = window.open("", "_blank");
  if (!w) {
    toast("Popup blocked — allow popups to view documents.", "warning");
    return;
  }

  const docId = "doc-" + Date.now().toString(36);
  const filename = (options.filename || title).replace(/[^\w\-]+/g, "_");

  w.document.write(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${title}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    background: #f1f5f9;
    margin: 0;
    padding: 0;
    color: #1e293b;
  }

  /* ---------- Action toolbar ---------- */
  .doc-toolbar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: #0f172a;
    padding: 12px 20px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: flex-end;
    box-shadow: 0 2px 12px rgba(0,0,0,.15);
  }
  .doc-toolbar button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 16px;
    border: none;
    border-radius: 8px;
    font-size: .85rem;
    font-weight: 600;
    cursor: pointer;
    transition: .15s;
    font-family: inherit;
  }
  .doc-toolbar button:hover { transform: translateY(-1px); }
  .doc-toolbar button:active { transform: translateY(0); }
  .btn-close    { background: #ef4444; color: #fff; }
  .btn-pdf      { background: #0ea5e9; color: #fff; }
  .btn-image    { background: #8b5cf6; color: #fff; }
  .btn-screenshot { background: #22c55e; color: #fff; }
  .btn-print    { background: #64748b; color: #fff; }

  /* ---------- Page wrapper ---------- */
  .doc-page {
    max-width: 860px;
    margin: 24px auto;
    padding: 34px 40px;
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 8px 28px rgba(0,0,0,.08);
  }

  /* ---------- Document content ---------- */
  .doc-wrap h1 {
    color: #0f172a;
    margin: 0 0 6px;
    font-size: 1.7rem;
  }
  .doc-ref, .doc-date { color: #64748b; margin: 3px 0; font-size: .9rem; }

  /* User details block */
  .doc-user {
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    border-radius: 10px;
    padding: 14px 18px;
    margin: 18px 0;
  }
  .doc-user h3 {
    margin: 0 0 10px;
    color: #0369a1;
    font-size: 1rem;
  }
  .doc-user-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 8px 20px;
    font-size: .88rem;
  }
  .doc-user-grid p { margin: 0; }
  .doc-user-grid strong { color: #334155; display: inline-block; min-width: 110px; }

  .doc-party {
    margin: 18px 0;
    padding: 12px 16px;
    background: #f8fafc;
    border-radius: 8px;
    font-size: .9rem;
  }
  .doc-party p { margin: 4px 0; }

  .doc-table {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
  }
  .doc-table th, .doc-table td {
    border: 1px solid #cbd5e1;
    padding: 10px;
    text-align: left;
    font-size: .88rem;
  }
  .doc-table th {
    background: #f1f5f9;
    font-weight: 700;
    color: #0f172a;
  }
  .doc-table tr:nth-child(even) td { background: #fafafa; }

  .doc-totals {
    text-align: right;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 2px solid #e2e8f0;
  }
  .doc-totals p { margin: 4px 0; font-size: .92rem; }
  .doc-totals h3 { color: #0f172a; margin: 10px 0 0; font-size: 1.25rem; }

  .paid-stamp {
    display: inline-block;
    margin-top: 10px;
    padding: 6px 16px;
    background: #dcfce7;
    color: #166534;
    border-radius: 8px;
    font-weight: 700;
    font-size: .85rem;
    letter-spacing: .5px;
  }

  .doc-foot {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px dashed #cbd5e1;
    color: #475569;
    font-size: .85rem;
  }

  .doc-block {
    margin: 18px 0;
    padding: 16px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #fff;
  }
  .doc-block h3 { margin: 0 0 8px; color: #0f172a; }

  /* Toast inside the doc window */
  .doc-toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: #0f172a;
    color: #fff;
    padding: 12px 22px;
    border-radius: 10px;
    font-size: .9rem;
    font-weight: 600;
    opacity: 0;
    pointer-events: none;
    transition: .25s;
    z-index: 999;
    box-shadow: 0 8px 24px rgba(0,0,0,.25);
  }
  .doc-toast.show {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
  .doc-toast.error { background: #dc2626; }
  .doc-toast.success { background: #16a34a; }

  /* ---------- Print ---------- */
  @media print {
    body { background: #fff; }
    .doc-toolbar { display: none !important; }
    .doc-page { margin: 0; box-shadow: none; border-radius: 0; padding: 20px; }
  }
</style>
</head>
<body>

<!-- ========== TOOLBAR ========== -->
<div class="doc-toolbar">
  <button class="btn-close"      onclick="window.close()">✕ Close</button>
  <button class="btn-screenshot" onclick="takeScreenshot()">📸 Screenshot</button>
  <button class="btn-image"      onclick="downloadImage()">🖼️ Download Image</button>
  <button class="btn-pdf"        onclick="downloadPDF()">📄 Download PDF</button>
  <button class="btn-print"      onclick="window.print()">🖨️ Print</button>
</div>

<!-- ========== PAGE ========== -->
<div class="doc-page" id="${docId}">
  ${bodyHtml}
</div>

<!-- ========== TOAST ========== -->
<div class="doc-toast" id="docToast"></div>

<script>
  const DOC_ID = "${docId}";
  const FILENAME = "${filename}";

  // ---------- Tiny toast ----------
  function docToast(msg, type = "success") {
    const t = document.getElementById("docToast");
    t.textContent = msg;
    t.className = "doc-toast show " + type;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.className = "doc-toast " + type, 2600);
  }

  // ---------- Download as PDF (via print dialog) ----------
  function downloadPDF() {
    docToast("Opening print dialog — choose 'Save as PDF'", "success");
    setTimeout(() => window.print(), 400);
  }

  // ---------- Download as PNG ----------
  async function downloadImage() {
    try {
      docToast("Generating image…", "success");
      const node = document.getElementById(DOC_ID);
      const canvas = await html2canvas(node, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false
      });
      const link = document.createElement("a");
      link.download = FILENAME + ".png";
      link.href = canvas.toDataURL("image/png");
      link.click();
      docToast("✅ Image downloaded", "success");
    } catch (err) {
      console.error(err);
      docToast("Failed to create image", "error");
    }
  }

  // ---------- Screenshot → clipboard ----------
  async function takeScreenshot() {
    try {
      docToast("Capturing screenshot…", "success");
      const node = document.getElementById(DOC_ID);
      const canvas = await html2canvas(node, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false
      });

      // Copy to clipboard if supported
      if (navigator.clipboard && window.ClipboardItem) {
        canvas.toBlob(async (blob) => {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": blob })
            ]);
            docToast("✅ Copied to clipboard!", "success");
          } catch (e) {
            // Fallback: download it instead
            const link = document.createElement("a");
            link.download = FILENAME + "_screenshot.png";
            link.href = canvas.toDataURL("image/png");
            link.click();
            docToast("✅ Screenshot saved", "success");
          }
        }, "image/png");
      } else {
        // Fallback: download
        const link = document.createElement("a");
        link.download = FILENAME + "_screenshot.png";
        link.href = canvas.toDataURL("image/png");
        link.click();
        docToast("✅ Screenshot saved", "success");
      }
    } catch (err) {
      console.error(err);
      docToast("Screenshot failed", "error");
    }
  }

  // ---------- Keyboard shortcuts ----------
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.close();
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      downloadImage();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "p") {
      e.preventDefault();
      downloadPDF();
    }
  });
<\/script>
</body>
</html>`);
  w.document.close();
}

// ============================================================
// USER PROGRESS (Safarini) — with WhatsApp follow-up
// ============================================================
function loadUserProgress() {
  if (!currentUser) return;
  
  const q = query(collection(db, "progress"), where("userId", "==", currentUser.uid));
  
  onSnapshot(q, (snap) => {
    const list = $("udProgressList");
    if (!list) return;
    list.innerHTML = "";
    let active = 0;
    
    if (snap.empty) {
      list.innerHTML = '<p class="ud-empty">No shipments in progress.</p>';
      $("udStatProgress").textContent = 0;
      return;
    }
    
    const arr = [];
    snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
    arr.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    
    arr.forEach(p => {
      const stage = p.stage || 1;
      if (stage < 5) active++;
      
      // Journey stepper — 5 steps
      const steps = ["Ordered", "Packed", "Safarini", "Dar", "Delivered"];
      const stepper = steps.map((s, i) => `
        <div class="ud-step ${i < stage ? 'done' : ''}">
          <div class="ud-dot">${i < stage ? '✓' : i + 1}</div>
          <span>${s}</span>
        </div>
      `).join("");
      
      // Stage detail
      const stages = p.stages || [];
      const current = stages[stage - 1] || {};
      const stageList = stages.map(s => `
        <div class="ad-stage ${s.done ? 'done' : ''}">
          <span class="ad-stage-dot">${s.done ? "✓" : s.key}</span>
          <div>
            <p class="ad-stage-label">${s.label}</p>
            <p class="ad-stage-place">${s.place}${s.at ? " · " + new Date(s.at).toLocaleDateString() : ""}</p>
          </div>
        </div>`).join("");
      
      // WhatsApp follow-up — enabled once it's shipping or arrived Dar
      const showWhatsApp = stage >= 3; // Safarini or later
      const waPhone = (p.adminPhone || "").replace(/\D/g, "");
      const waMessage = encodeURIComponent(
        `Hello! I'd like to follow up on my order.\n` +
        `Tracking: ${p.trackingId}\n` +
        `Product: ${p.productName}\n` +
        `Current stage: ${current.label || "—"} (${current.place || ""})`
      );
      const waLink = waPhone ?
        `https://wa.me/${waPhone}?text=${waMessage}` :
        `https://wa.me/?text=${waMessage}`;
      
      const div = document.createElement("div");
      div.className = "ud-item bill-card";
      div.style.flexDirection = "column";
      div.style.alignItems = "stretch";
      
      div.innerHTML = `
        <div class="bill-head">
          <div>
            <h5>${p.productName}</h5>
            <p class="bill-date">Tracking: <strong>${p.trackingId}</strong></p>
            <p class="bill-date">Ref: ${p.orderRef || "—"} · ${p.price || ""}</p>
          </div>
          <span class="ad-badge ${stage >= 5 ? 'on' : 'warn'}">
            ${stage >= 5 ? "✅ Delivered" : `Stage ${stage}/5`}
          </span>
        </div>

        <!-- Journey visual -->
        <div class="ud-progress-bar">${stepper}</div>

        <!-- Current status -->
        <div class="progress-current">
          <p class="progress-current-label">📍 Currently: <strong>${current.label || "—"}</strong></p>
          <p class="progress-current-place">${current.place || ""}</p>
        </div>

        <!-- Full stage list -->
        <details class="progress-details">
          <summary>View full journey</summary>
          <div class="ad-stage-list">${stageList}</div>
        </details>

        <!-- WhatsApp follow-up -->
        ${showWhatsApp ? `
          <div class="progress-actions">
            <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="btn-whatsapp">
              💬 Contact on WhatsApp
            </a>
            <p class="progress-hint">Chat directly with our team about your shipment.</p>
          </div>
        ` : `
          <div class="progress-actions">
            <p class="progress-hint">
              💬 WhatsApp follow-up becomes available once your order is in transit.
            </p>
          </div>
        `}
      `;
      list.appendChild(div);
    });
    
    $("udStatProgress").textContent = active;
  });
}

// ============================================================
// PRODUCT MEDIA / SHIPPING HELPERS
// ============================================================
function updateMediaField() {
  const mediaType = document.querySelector('input[name="mediaType"]:checked')?.value || "image";
  const label = $("mediaUrlLabel");
  const input = $("productMediaUrl");

  if (mediaType === "image") {
    label.textContent = "Image URL";
    input.placeholder = "https://example.com/image.jpg";
  } else if (mediaType === "video") {
    label.textContent = "Video URL";
    input.placeholder = "https://example.com/video.mp4";
  } else {
    label.textContent = "YouTube URL";
    input.placeholder = "https://youtube.com/watch?v=... or https://youtu.be/...";
  }
  updateYoutubePreview();
}

function updateYoutubePreview() {
  const mediaType = document.querySelector('input[name="mediaType"]:checked')?.value;
  const wrap = $("youtubePreviewWrap");
  const frame = $("youtubePreview");
  const url = $("productMediaUrl")?.value.trim();

  if (mediaType !== "youtube") {
    wrap.classList.add("hidden");
    frame.src = "";
    return;
  }

  const id = extractYoutubeId(url);
  if (id) {
    frame.src = `https://www.youtube.com/embed/${id}`;
    wrap.classList.remove("hidden");
  } else {
    wrap.classList.add("hidden");
    frame.src = "";
  }
}

function extractYoutubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&?/]+)/,
    /(?:youtu\.be\/)([^&?/]+)/,
    /(?:youtube\.com\/embed\/)([^&?/]+)/,
    /(?:youtube\.com\/shorts\/)([^&?/]+)/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
  return null;
}

window.updateMediaField = updateMediaField;
window.updateYoutubePreview = updateYoutubePreview;

// ============================================================
// ADD TO CART — adds item, then opens the user's Cart panel
// ============================================================
window.addToCart = async (productId, qty = 1) => {
  qty = Math.max(1, Math.min(99, parseInt(qty) || 1));

  if (!currentUser) {
    toast("Please log in to add items to your cart.", "warning");
    setTimeout(() => { hideAllViews(); show($("authView")); }, 700);
    return;
  }

  const product = _allPublicProducts.find(p => p.id === productId);
  if (!product) { toast("Product not found.", "error"); return; }

  try {
    const existingQ = query(
      collection(db, "carts"),
      where("userId", "==", currentUser.uid),
      where("productId", "==", productId)
    );
    const existingSnap = await getDocs(existingQ);

    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0];
      const newQty = (existingDoc.data().qty || 1) + qty;
      await updateDoc(doc(db, "carts", existingDoc.id), { qty: newQty });
      toast(`🛒 Cart updated (Qty: ${newQty})`, "success");
    } else {
      await addDoc(collection(db, "carts"), {
        userId: currentUser.uid,
        productId,
        name: product.name,
        price: product.price,
        image: product.image || product.mediaUrl || "",
        mediaType: product.mediaType || "image",
        shippingType: product.shippingType || "free",
        shippingFee: product.shippingFee || "Free",
        qty,
        addedAt: serverTimestamp()
      });
      toast(`🛒 Added ${qty} item${qty > 1 ? "s" : ""} to cart!`, "success");
    }

    // Close the product modal
    $("productModal").classList.remove("active");

    // ⬇️ NEW: open the user's Cart panel
    
      openUserCartPanel();

  } catch (err) {
    console.error("addToCart error:", err);
    toast("Failed to add to cart.", "error");
  }
};

// ============================================================
// PLACE ORDER — adds item, then opens Payment modal directly
// ============================================================
window.placeOrder = async (productId, qty = 1) => {
  qty = Math.max(1, Math.min(99, parseInt(qty) || 1));

  if (!currentUser) {
    toast("Please log in to place an order.", "warning");
    setTimeout(() => { hideAllViews(); show($("authView")); }, 700);
    return;
  }

  const product = _allPublicProducts.find(p => p.id === productId);
  if (!product) { toast("Product not found.", "error"); return; }

  try {
    const existingQ = query(
      collection(db, "carts"),
      where("userId", "==", currentUser.uid),
      where("productId", "==", productId)
    );
    const existingSnap = await getDocs(existingQ);

    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0];
      const newQty = (existingDoc.data().qty || 1) + qty;
      await updateDoc(doc(db, "carts", existingDoc.id), { qty: newQty });
    } else {
      await addDoc(collection(db, "carts"), {
        userId: currentUser.uid,
        productId,
        name: product.name,
        price: product.price,
        image: product.image || product.mediaUrl || "",
        mediaType: product.mediaType || "image",
        shippingType: product.shippingType || "free",
        shippingFee: product.shippingFee || "Free",
        qty,
        addedAt: serverTimestamp()
      });
    }

    // Close product modal
    $("productModal").classList.remove("active");
    toast(`⚡ Proceeding to payment…`, "success");

    // ⬇️ NEW: pull the whole cart and open the Payment modal
    setTimeout(async () => {
      await openPaymentFromCart();
    }, 400);

  } catch (err) {
    console.error("placeOrder error:", err);
    toast("Failed to place order.", "error");
  }
};

// ============================================================
// PRODUCT MODAL — QUANTITY STEPPER
// ============================================================
let _modalQty = 1;

function setModalQty(n) {
  _modalQty = Math.max(1, Math.min(99, n));
  const input = $("qtyInput");
  if (input) input.value = _modalQty;
  
  // Disable − at 1, + at 99
  $("qtyMinus").disabled = _modalQty <= 1;
  $("qtyPlus").disabled = _modalQty >= 99;
}

// Wire buttons (once)
if (!$("qtyPlus")?._wired) {
  $("qtyPlus")?.addEventListener("click", () => setModalQty(_modalQty + 1));
  $("qtyMinus")?.addEventListener("click", () => setModalQty(_modalQty - 1));
  if ($("qtyPlus")) $("qtyPlus")._wired = true;
}

window.setModalQty = setModalQty;




// Bulletproof detection
function isMobile() {
  const hasTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (!hasTouch) return false;
  const noHover = window.matchMedia("(hover: none)").matches;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  return noHover && coarsePointer;
}

// ---------- Normalize URL / handle ----------
function normalizeUrl(value, platform) {
  if (!value) return "#";
  let v = String(value).trim();

  if (platform && /^@?[\w.\-]+$/.test(v) && !v.includes(".") && !/^https?:/i.test(v)) {
    const h = v.replace(/^@/, "");
    const map = {
      facebook:  `https://facebook.com/${h}`,
      instagram: `https://instagram.com/${h}`,
      whatsapp:  `https://wa.me/${h.replace(/\D/g, "")}`,
      tiktok:    `https://tiktok.com/@${h}`,
      twitter:   `https://twitter.com/${h}`,
      youtube:   `https://youtube.com/@${h}`,
      linkedin:  `https://linkedin.com/in/${h}`,
      telegram:  `https://t.me/${h}`,
      snapchat:  `https://snapchat.com/add/${h}`,
      pinterest: `https://pinterest.com/${h}`
    };
    return map[platform] || v;
  }
  if (!/^https?:\/\//i.test(v)) return "https://" + v;
  return v;
}

// ---------- Default icon per type ----------
function defaultContactIcon(c) {
  if (c.icon) return c.icon;
  if (c.type === "phone") return "📞";
  if (c.type === "email") return "✉️";
  if (c.type === "social") {
    const map = {
      facebook: "📘", instagram: "📷", whatsapp: "💬", tiktok: "🎵",
      twitter: "🐦", youtube: "▶️", linkedin: "💼", telegram: "✈️",
      snapchat: "👻", pinterest: "📌", other: "🔗"
    };
    return map[c.platform] || "🔗";
  }
  return "🔧";
}

function buildContactAction(c) {
  const type = (c.type || "").toLowerCase();
  const platform = (c.platform || "").toLowerCase();
  const raw = String(c.value || "").trim();
  const mobile = isMobile();
  
  // ---------- 📞 PHONE ----------
  if (type === "phone") {
    const clean = raw.replace(/[^\d+]/g, "");
    
    if (!mobile) {
      // Desktop → copy
      return { mode: "copy", copyValue: raw, hint: "Copy number" };
    }
    
    return { mode: "call", href: "tel:" + clean, hint: "Tap to call" };
  }
  
  // ---------- ✉️ EMAIL ----------
  if (type === "email") {
    const subject = encodeURIComponent(c.emailSubject || `Inquiry — ${c.label || "Website"}`);
    const body = encodeURIComponent(c.emailBody || "Hello,\n\nI'm reaching out from your website.\n\nThanks!");
    
    if (!mobile) {
      // Desktop → copy
      return { mode: "copy", copyValue: raw, hint: "Copy email" };
    }
    
    return {
      mode: "email",
      href: `mailto:${raw}?subject=${subject}&body=${body}`,
      hint: "Tap to compose email"
    };
  }
  
  // ---------- 💬 WHATSAPP ----------
  if (platform === "whatsapp") {
    const num = raw.replace(/\D/g, "");
    return {
      mode: "message",
      href: `https://wa.me/${num}`,
      target: "_blank",
      hint: "Tap to message"
    };
  }
  
  // ---------- 🔗 SOCIAL ----------
  if (type === "social") {
    return {
      mode: "open",
      href: normalizeUrl(raw, platform),
      target: "_blank",
      hint: "Tap to open"
    };
  }
  
  // ---------- 🔧 OTHER ----------
  if (/^https?:\/\//i.test(raw) || /^www\./i.test(raw)) {
    return {
      mode: "open",
      href: normalizeUrl(raw),
      target: "_blank",
      hint: "Tap to open"
    };
  }
  
  return { mode: "copy", copyValue: raw, hint: "Tap to copy" };
}

// ============================================================
// LOAD CONTACTS — homepage renderer
// ============================================================
function loadContacts() {
  console.log("🔵 loadContacts() started");

  const container = document.getElementById("contactContainer");
  if (!container) {
    console.error("❌ #contactContainer NOT FOUND");
    return;
  }

  const q = query(collection(db, "contacts"), where("active", "==", true));

  onSnapshot(q,
    (snap) => {
      console.log("📥 Contacts snapshot. Active:", snap.size);
      container.innerHTML = "";

      if (snap.empty) {
        container.innerHTML = '<p class="about-desc">No contact information yet.</p>';
        return;
      }

      const items = [];
      snap.forEach(d => items.push({ id: d.id, ...d.data() }));
      items.sort((a, b) => (a.order || 0) - (b.order || 0));

      items.forEach(c => {
        try {
          const icon   = c.icon || defaultContactIcon(c);
          const action = buildContactAction(c);

          console.log("   🔧", c.type, c.platform || "—", "→", action.mode, action.href);

          const card = document.createElement("a");
          card.className = "contact-card";
          card.dataset.type = c.type || "";
          if (c.platform) card.dataset.platform = c.platform;
          card.title = action.hint;

          // ---- Bind the action ----
          if (action.mode === "copy") {
            card.href = "javascript:void(0)";
            card.addEventListener("click", (e) => {
              e.preventDefault();
              if (navigator.clipboard) {
                navigator.clipboard.writeText(action.copyValue)
                  .then(() => toast("📋 Copied: " + action.copyValue, "success"))
                  .catch(() => toast("Copy failed.", "error"));
              } else {
                const tmp = document.createElement("input");
                tmp.value = action.copyValue;
                document.body.appendChild(tmp);
                tmp.select();
                document.execCommand("copy");
                tmp.remove();
                toast("📋 Copied: " + action.copyValue, "success");
              }
            });
          } else {
            card.href = action.href;
            if (action.target) {
              card.target = action.target;
              card.rel = "noopener noreferrer";
            }
          }

          // ---- Build visible content ----
          // ---- Build visible content ----
const iconEl = document.createElement("span");
iconEl.className = "contact-icon";
iconEl.innerHTML = icon;

const labelEl = document.createElement("span");
labelEl.className = "contact-label";
labelEl.textContent = c.label || "";

card.appendChild(iconEl);
card.appendChild(labelEl);

// ============================================================
// Always show the value for phone, email, and other
// (hide raw URL for social links — the label says it all)
// ============================================================
const shouldShowValue =
  c.type === "phone" ||
  c.type === "email" ||
  c.type === "other";

if (shouldShowValue) {
  const valueEl = document.createElement("span");
  valueEl.className = "contact-value";
  valueEl.innerHTML = formatDescription(c.value || "");
  card.appendChild(valueEl);
}

const hintEl = document.createElement("span");
hintEl.className = "contact-hint";
hintEl.textContent = action.hint;
card.appendChild(hintEl); 



          container.appendChild(card);
        } catch (err) {
          console.error("❌ Render error:", c, err);
        }
      });

      console.log("✅ Rendered", container.children.length, "cards");
    },
    (err) => {
      console.error("❌ Contacts listener error:", err.code, err.message);
      container.innerHTML = '<p class="about-desc">Failed to load contact info.</p>';
    }
  );
}


// ============================================================
// PAYMENT SYSTEM — USER SIDE
// ============================================================
let _payMethods = [];
let _payCurrentType = "bank";
let _payPendingOrder = null;

// Load all active payment methods once
onSnapshot(query(collection(db, "payments"), where("active", "==", true)), (snap) => {
  _payMethods = [];
  snap.forEach(d => _payMethods.push({ id: d.id, ...d.data() }));
  _payMethods.sort((a, b) => (a.order || 0) - (b.order || 0));
  populatePayMethods();
});

function populatePayMethods() {
  const sel = $("payMethodSelect");
  if (!sel) return;
  sel.innerHTML = "";

  const filtered = _payMethods.filter(m => m.type === _payCurrentType);

  if (filtered.length === 0) {
    sel.innerHTML = `<option value="__fallback__">⚠️ No ${_payCurrentType} method configured — use manual</option>`;
    showFallback();
    return;
  }

  sel.innerHTML = `<option value="">— Select ${_payCurrentType} method —</option>`;
  filtered.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name;
    sel.appendChild(opt);
  });

  hideFallback();
  $("payMethodDetails").classList.add("hidden");
}

// Type selector
document.querySelectorAll(".pay-type-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".pay-type-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    _payCurrentType = btn.dataset.paytype;
    populatePayMethods();
  });
});

$("payMethodSelect")?.addEventListener("change", (e) => {
  const id = e.target.value;
  if (id === "__fallback__") { showFallback(); return; }
  const m = _payMethods.find(x => x.id === id);
  if (!m) { hideFallback(); return; }

  hideFallback();
  const box = $("payMethodDetails");
  box.classList.remove("hidden");
  $("payMethodName").textContent = m.name || "";
  $("payAccountName").textContent = m.accountName ? "👤 " + m.accountName : "";
  $("payAccountNumber").textContent = m.accountNumber ? "🔢 " + m.accountNumber : "";

  const lipa = $("payLipaNumber");
  if (m.lipaNumber) {
    lipa.textContent = "🔢 Lipa No: " + m.lipaNumber;
    lipa.classList.remove("hidden");
  } else {
    lipa.classList.add("hidden");
  }

  $("payInstructions").textContent = m.instructions || autoInstructions(m);
});

function showFallback() {
  $("payMethodDetails").classList.add("hidden");
  $("payFallback").classList.remove("hidden");
}
function hideFallback() {
  $("payFallback").classList.add("hidden");
}

// Auto instructions generator (used when admin leaves it blank)
function autoInstructions(m) {
  const t = m.type;
  if (t === "bank") {
    return `1. Go to your bank app or branch\n2. Transfer to Account Name: ${m.accountName}\n3. Account Number: ${m.accountNumber}\n4. Enter amount shown above\n5. Save the confirmation SMS / receipt\n6. Submit this form and wait for approval`;
  }
  if (t === "mobile") {
    return `1. Dial your mobile money menu (*150*00# etc.)\n2. Choose "Send Money"\n3. Enter number: ${m.phone || m.accountNumber}\n4. Enter amount shown above\n5. Confirm with your PIN\n6. Save the SMS confirmation\n7. Submit this form and wait for approval`;
  }
  if (t === "lipa") {
    return `1. Dial mobile money menu\n2. Choose "Lipa kwa Simu" / "Pay by Number"\n3. Enter Lipa No: ${m.lipaNumber}\n4. Enter amount shown above\n5. Confirm with your PIN\n6. Save the SMS confirmation\n7. Submit this form and wait for approval`;
  }
  return "Follow the payment instructions provided by admin.";
}

window.openPaymentModal = (cartItems) => {
  if (!currentUser) {
    toast("Please log in first.", "warning");
    setTimeout(() => { hideAllViews(); show($("authView")); }, 700);
    return;
  }
  if (!cartItems || cartItems.length === 0) {
    toast("Your cart is empty.", "warning");
    return;
  }

  _payPendingOrder = cartItems;

  const grand = cartItems.reduce((sum, c) => {
    const p = parseFloat(String(c.price).replace(/[^0-9.]/g, "")) || 0;
    const s = c.shippingType === "paid"
      ? (parseFloat(String(c.shippingFee).replace(/[^0-9.]/g, "")) || 0) : 0;
    return sum + p * (c.qty || 1) + s;
  }, 0);

  $("payGrandTotal").textContent = "$" + grand.toFixed(2);
  $("payStep1").classList.remove("hidden");
  $("payStep2").classList.add("hidden");
  $("payFullName").value = currentUserData?.username || "";
  $("payPhoneOrAccount").value = currentUserData?.phone || "";

  $("paymentModal").classList.add("active");
  document.body.style.overflow = "hidden";
};

window.closePaymentModal = () => {
  $("paymentModal").classList.remove("active");
  document.body.style.overflow = "";
};

// ---------- Submit payment ----------
window.submitPayment = async () => {
  const fullName = $("payFullName").value.trim();
  const phoneOrAcc = $("payPhoneOrAccount").value.trim();
  const methodId = $("payMethodSelect").value;

  if (!fullName || !phoneOrAcc) {
    toast("Please fill in your name and phone/account number.", "warning");
    return;
  }
  if (!_payPendingOrder || _payPendingOrder.length === 0) {
    toast("Cart is empty.", "error");
    return;
  }

  const method = _payMethods.find(m => m.id === methodId) || {
    id: "__manual__",
    name: "Manual / Unconfigured",
    type: _payCurrentType
  };

  // Compute totals
  let subtotal = 0, shipTotal = 0;
  const items = _payPendingOrder.map(c => {
    const price = parseFloat(String(c.price).replace(/[^0-9.]/g, "")) || 0;
    const ship = c.shippingType === "paid"
      ? (parseFloat(String(c.shippingFee).replace(/[^0-9.]/g, "")) || 0) : 0;
    const qty = c.qty || 1;
    subtotal += price * qty;
    shipTotal += ship;
    return {
      productId: c.productId,
      name: c.name,
      price: c.price,
      qty,
      image: c.image || "",
      shippingFee: c.shippingFee || "Free",
      shippingType: c.shippingType || "free"
    };
  });

  const reference = "ORD-" + Date.now().toString(36).toUpperCase();

  try {
    await addDoc(collection(db, "orders"), {
      userId: currentUser.uid,
      userName: currentUserData.username || "",
      userPhone: currentUserData.phone || "",
      items,
      subtotal, shipTotal,
      grandTotal: subtotal + shipTotal,
      paymentMethodId: method.id,
      paymentMethodName: method.name,
      paymentType: method.type,
      payerName: fullName,
      payerPhone: phoneOrAcc,
      reference,
      status: "pending",
      createdAt: serverTimestamp()
    });

    // Clear user's cart
    const cartQ = query(collection(db, "carts"), where("userId", "==", currentUser.uid));
    const cartSnap = await getDocs(cartQ);
    await Promise.all(cartSnap.docs.map(d => deleteDoc(doc(db, "carts", d.id))));

    $("payReference").textContent = reference;
    $("payStep1").classList.add("hidden");
    $("payStep2").classList.remove("hidden");
    toast("✅ Payment submitted! Awaiting admin approval.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to submit payment.", "error");
  }
};

// Override udCheckout to open payment modal with cart contents
window.udCheckout = async () => {
  if (!currentUser) return;
  const q = query(collection(db, "carts"), where("userId", "==", currentUser.uid));
  const snap = await getDocs(q);
  if (snap.empty) { toast("Cart is empty.", "warning"); return; }
  const items = [];
  snap.forEach(d => items.push({ id: d.id, ...d.data() }));
  openPaymentModal(items);
};

// ============================================================
// ADMIN — PAYMENT METHODS CRUD
// ============================================================
function setupPaymentsAdmin() {
  const form = $("paymentForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("payId").value;
    const type = document.querySelector('input[name="payType"]:checked').value;
    const name = $("payNameInput").value.trim();
    const accountName = $("payAccountNameInput").value.trim();
    const accountNumber = $("payAccountNumberInput").value.trim();
    const phone = $("payPhoneInput").value.trim();
    const lipaNumber = $("payLipaInput").value.trim();
    const order = parseInt($("payOrderInput").value) || 1;
    const active = $("payActiveInput").checked;
    let instructions = $("payInstructionsInput").value.trim();

    if (!name) { toast("Method name required.", "warning"); return; }
    if (type === "bank" && !accountNumber) { toast("Account number required for bank.", "warning"); return; }
    if (type === "mobile" && !phone) { toast("Phone required for mobile money.", "warning"); return; }
    if (type === "lipa" && !lipaNumber) { toast("Lipa Number required.", "warning"); return; }

    // Auto-generate if blank
    if (!instructions) {
      instructions = autoInstructions({ type, accountName, accountNumber, phone, lipaNumber });
    }

    const data = {
      type, name, accountName, accountNumber, phone, lipaNumber,
      instructions, order, active, updatedAt: serverTimestamp()
    };

    try {
      if (id) {
        await updateDoc(doc(db, "payments", id), data);
        toast("Payment method updated.", "success");
      } else {
        data.createdAt = serverTimestamp();
        await addDoc(collection(db, "payments"), data);
        toast("Payment method added.", "success");
      }
      resetPaymentForm();
    } catch (err) {
      console.error(err);
      toast("Save failed.", "error");
    }
  });

  onSnapshot(collection(db, "payments"), (snap) => {
    const list = $("adminPaymentList");
    list.innerHTML = "";
    $("adPayCount").textContent = snap.size;
    if (snap.empty) {
      list.innerHTML = '<p class="ud-empty">No payment methods yet.</p>';
      return;
    }
    const arr = [];
    snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
    arr.sort((a,b) => (a.order||0)-(b.order||0));

    arr.forEach(p => {
      const icon = p.type === "bank" ? "🏦" : p.type === "mobile" ? "📱" : "🔢";
      const div = document.createElement("div");
      div.className = "ad-item";
      div.innerHTML = `
        <div class="contact-icon" style="width:44px;height:44px;border-radius:50%;background:#f0f9ff;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">${icon}</div>
        <div class="ad-item-body">
          <h5>${p.name} <span class="ad-badge ${p.active ? 'on':'off'}">${p.active ? 'Active':'Inactive'}</span></h5>
          <p>${p.type} · ${p.accountName || ""} · ${p.accountNumber || p.phone || p.lipaNumber || ""}</p>
        </div>
        <div class="ad-item-actions">
          <button class="btn-edit" onclick="editPayment('${p.id}')">Edit</button>
          <button class="btn-toggle" onclick="togglePayment('${p.id}', ${p.active})">${p.active ? 'Disable':'Enable'}</button>
          <button class="btn-delete" onclick="deletePayment('${p.id}')">Delete</button>
        </div>`;
      list.appendChild(div);
    });
  });
}

window.resetPaymentForm = () => {
  const f = $("paymentForm");
  if (!f) return;
  f.reset();
  $("payId").value = "";
  $("payActiveInput").checked = true;
  $("payOrderInput").value = 1;
  $("adPayFormTitle").textContent = "➕ Add Payment Method";
  f.querySelector(".btn-primary").textContent = "💾 Save Payment Method";
};

window.editPayment = async (id) => {
  const snap = await getDoc(doc(db, "payments", id));
  if (!snap.exists()) return toast("Not found.", "error");
  const p = snap.data();
  $("payId").value = id;
  document.querySelector(`input[name="payType"][value="${p.type}"]`).checked = true;
  $("payNameInput").value = p.name || "";
  $("payAccountNameInput").value = p.accountName || "";
  $("payAccountNumberInput").value = p.accountNumber || "";
  $("payPhoneInput").value = p.phone || "";
  $("payLipaInput").value = p.lipaNumber || "";
  $("payInstructionsInput").value = p.instructions || "";
  $("payOrderInput").value = p.order || 1;
  $("payActiveInput").checked = p.active !== false;
  $("adPayFormTitle").textContent = "✏️ Edit Payment Method";
  $("paymentForm").querySelector(".btn-primary").textContent = "💾 Update";
  adGo("payments");
};

window.togglePayment = async (id, cur) => {
  await updateDoc(doc(db, "payments", id), { active: !cur });
  toast(`Method ${!cur ? "activated":"deactivated"}.`, "success");
};

window.deletePayment = async (id) => {
  if (!confirm("Delete this payment method?")) return;
  await deleteDoc(doc(db, "payments", id));
  toast("Deleted.", "success");
};

// ============================================================
// ADMIN — ORDER APPROVAL
// ============================================================
function setupOrdersAdmin() {
  onSnapshot(collection(db, "orders"), (snap) => {
    const pendingList = $("adminPendingOrders");
    const allList = $("adminAllOrders");
    if (!pendingList || !allList) return;
    
    const orders = [];
    snap.forEach(d => orders.push({ id: d.id, ...d.data() }));
    orders.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    
    const pending = orders.filter(o => o.status === "pending");
    // ✅ Badge is updated by setupOrderCounters — no need to touch it here
    
    pendingList.innerHTML = "";
    if (pending.length === 0) {
      pendingList.innerHTML = '<p class="ud-empty">No pending orders.</p>';
    } else {
      pending.forEach(o => pendingList.appendChild(renderOrderCard(o, true)));
    }
    
    allList.innerHTML = "";
    if (orders.length === 0) {
      allList.innerHTML = '<p class="ud-empty">No orders yet.</p>';
    } else {
      orders.forEach(o => allList.appendChild(renderOrderCard(o, false)));
    }
  });
}

function renderOrderCard(o, isPending) {
  const badgeClass = o.status === "approved" ? "on" : o.status === "rejected" ? "off" : "warn";
  const badgeText  = o.status === "approved" ? "✅ Approved" :
                     o.status === "rejected" ? "❌ Rejected" : "⏳ Pending";
  const itemsHtml = (o.items || []).map(it => `
    <div class="bill-item">
      ${it.image ? `<img src="${it.image}" alt="">` : ""}
      <div class="bill-item-info">
        <p><strong>${it.name}</strong></p>
        <p>Qty: ${it.qty} · ${it.price}</p>
      </div>
    </div>`).join("");

  const div = document.createElement("div");
  div.className = "ud-item bill-card";
  div.innerHTML = `
    <div class="bill-head">
      <div>
        <h5>${o.reference || o.id.slice(0,8)}</h5>
        <p class="bill-date">${o.userName} · ${o.userPhone || ""}</p>
        <p class="bill-date">Paid via ${o.paymentMethodName} (${o.paymentType})</p>
        <p class="bill-date">Payer: ${o.payerName} · ${o.payerPhone}</p>
      </div>
      <span class="ad-badge ${badgeClass}">${badgeText}</span>
    </div>
    <div class="bill-items">${itemsHtml}</div>
    <div class="bill-total">
      <span>Total</span><strong>$${(o.grandTotal||0).toFixed(2)}</strong>
    </div>
    ${isPending ? `
      <div class="bill-actions">
        <button class="btn-primary" onclick="approveOrder('${o.id}')">✅ Approve</button>
        <button class="btn-delete" onclick="rejectOrder('${o.id}')">❌ Reject</button>
      </div>` : ""}
  `;
  return div;
}

// ============================================================
// ADMIN — APPROVE ORDER + AUTO-CREATE PROGRESS TRACKING
// ============================================================
window.approveOrder = async (id) => {
  if (!confirm("Approve this payment and start product tracking?")) return;
  
  try {
    const orderSnap = await getDoc(doc(db, "orders", id));
    if (!orderSnap.exists()) { toast("Order not found.", "error"); return; }
    const order = orderSnap.data();
    
    // 1) Mark order approved
    await updateDoc(doc(db, "orders", id), {
      status: "approved",
      approvedAt: serverTimestamp(),
      approvedBy: currentUser.uid
    });
    
    // 2) Create progress doc (China → Dar → Delivered)
    const trackingId = "TRK-" + Date.now().toString(36).toUpperCase();
    
    await addDoc(collection(db, "progress"), {
      userId: order.userId,
      orderId: id,
      orderRef: order.reference || id.slice(0, 8).toUpperCase(),
      productName: (order.items?.[0]?.name || "Order") +
        (order.items?.length > 1 ? ` +${order.items.length - 1} more` : ""),
      price: "$" + (order.grandTotal || 0).toFixed(2),
      items: order.items || [],
      trackingId,
      
      // ---- Journey stages ----
      // 1 = Ordered (China warehouse)
      // 2 = Packed in China
      // 3 = Shipped / In transit (Safarini)
      // 4 = Arrived Dar es Salaam
      // 5 = Delivered
      stage: 1,
      stages: [
        { key: 1, label: "Order Confirmed", place: "China Warehouse", done: true, at: new Date().toISOString() },
        { key: 2, label: "Packed & Ready", place: "China Warehouse", done: false, at: null },
        { key: 3, label: "In Transit (Safarini)", place: "China → Tanzania", done: false, at: null },
        { key: 4, label: "Arrived Dar es Salaam", place: "Dar es Salaam", done: false, at: null },
        { key: 5, label: "Delivered", place: "Customer Address", done: false, at: null }
      ],
      
      // ---- WhatsApp follow-up ----
      contactPhone: order.userPhone || "",
      adminPhone: currentUserData?.phone || "",
      
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    
    toast("✅ Order approved. Tracking started (China → Dar es Salaam).", "success", 4500);
    
  } catch (err) {
    console.error("approveOrder error:", err);
    toast("Failed to approve order.", "error");
  }
};

window.rejectOrder = async (id) => {
  if (!confirm("Reject this order?")) return;
  await updateDoc(doc(db, "orders", id), {
    status: "rejected",
    rejectedAt: serverTimestamp()
  });
  toast("Order rejected.", "info");
};

// ============================================================
// HELPER — open the user's Cart panel from anywhere
// ============================================================
async function openUserCartPanel() {
  // Make sure we're on the user dashboard
  if (currentRole === "superadmin") {
    hideAllViews(); show($("superDashboard"));
    return;
  }
  if (currentRole === "admin") {
    hideAllViews(); show($("adminDashboard"));
    return;
  }

  // Show user dashboard
  hideAllViews();
  show($("userDashboard"));

  // Ensure the cart listeners are wired
  if (typeof renderUserDashboard === "function") renderUserDashboard();

  // Switch to the cart panel
  setTimeout(() => {
    if (typeof udGo === "function") udGo("cart");
  }, 150);
}
window.openUserCartPanel = openUserCartPanel;

// ============================================================
// HELPER — pull current cart and open the Payment modal
// ============================================================
async function openPaymentFromCart() {
  if (!currentUser) {
    toast("Please log in first.", "warning");
    setTimeout(() => { hideAllViews(); show($("authView")); }, 700);
    return;
  }

  const q = query(collection(db, "carts"), where("userId", "==", currentUser.uid));
  const snap = await getDocs(q);

  if (snap.empty) {
    toast("Your cart is empty.", "warning");
    return;
  }

  const items = [];
  snap.forEach(d => items.push({ id: d.id, ...d.data() }));

  openPaymentModal(items);
}
window.openPaymentFromCart = openPaymentFromCart;

// ============================================================
// BUILD USER DETAILS BLOCK (used inside every document)
// ============================================================
async function buildUserDetailsBlock(order) {
  // Prefer the live user doc; fall back to order snapshot
  let u = {};
  try {
    if (order.userId) {
      const snap = await getDoc(doc(db, "users", order.userId));
      if (snap.exists()) u = snap.data();
    }
  } catch (e) { /* ignore */ }

  const name    = u.username   || order.userName  || "—";
  const phone   = u.phone      || order.userPhone || "—";
  const email   = u.email      || "—";
  const joined  = u.createdAt?.toDate
    ? u.createdAt.toDate().toLocaleDateString()
    : "—";
  const address = u.address || u.location || "—";
  const role    = u.role    || "user";

  return `
    <div class="doc-user">
      <h3>👤 Customer Details</h3>
      <div class="doc-user-grid">
        <p><strong>Full Name:</strong> ${name}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Address:</strong> ${address}</p>
        <p><strong>Member Since:</strong> ${joined}</p>
        <p><strong>Role:</strong> ${role}</p>
      </div>
    </div>
  `;
}

// ---------- Robust close ----------
function closeDoc() {
  // Strategy 1: plain close
  try { window.close(); } catch (e) {}

  // Strategy 2: after a short delay, if we're still here, go blank + close
  setTimeout(() => {
    try {
      if (!window.closed) {
        window.open("", "_self");
        window.close();
      }
    } catch (e) {}
  }, 120);

  // Strategy 3: if still alive, go back / show message
  setTimeout(() => {
    try {
      if (!window.closed) {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          // Last resort — tell the user
          const t = document.getElementById("docToast");
          if (t) {
            t.textContent = "Please close this tab manually (Ctrl+W / ⌘W)";
            t.className = "doc-toast show error";
            clearTimeout(t._timer);
            t._timer = setTimeout(() => t.className = "doc-toast error", 5000);
          }
        }
      }
    } catch (e) {}
  }, 400);
}

// ============================================================
// ADMIN — SHIPMENT PROGRESS CONTROL
// ============================================================
function setupProgressAdmin() {
  const q = query(collection(db, "progress"));
  onSnapshot(q, (snap) => {
    const list = $("adminProgressList");
    if (!list) return;
    list.innerHTML = "";

    if (snap.empty) {
      list.innerHTML = '<p class="ud-empty">No shipments yet.</p>';
      return;
    }

    const arr = [];
    snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
    arr.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    arr.forEach(p => {
      const stageLabels = ["Ordered", "Packed", "Safarini", "Dar es Salaam", "Delivered"];
      const currentLabel = stageLabels[(p.stage || 1) - 1];

      const stagesHtml = (p.stages || []).map(s => `
        <div class="ad-stage ${s.done ? 'done' : ''}">
          <span class="ad-stage-dot">${s.done ? "✓" : s.key}</span>
          <div>
            <p class="ad-stage-label">${s.label}</p>
            <p class="ad-stage-place">${s.place}</p>
          </div>
        </div>`).join("");

      const div = document.createElement("div");
      div.className = "ud-item bill-card";
      div.innerHTML = `
        <div class="bill-head">
          <div>
            <h5>${p.orderRef} — ${p.productName}</h5>
            <p class="bill-date">Tracking: ${p.trackingId}</p>
            <p class="bill-date">Customer phone: ${p.contactPhone || "—"}</p>
          </div>
          <span class="ad-badge on">Stage ${p.stage}/5 · ${currentLabel}</span>
        </div>

        <div class="ad-stage-list">${stagesHtml}</div>

        <div class="bill-actions">
          <button class="btn-secondary" onclick="advanceProgress('${p.id}')">
            ⏭️ Advance to Next Stage
          </button>
          <button class="btn-secondary" onclick="setProgressStage('${p.id}')"> 🎯 Set Stage…
          </button>
          <button class="btn-delete" onclick="deleteProgress('${p.id}')">
            🗑️ Delete
          </button>
        </div>
      `;
      list.appendChild(div);
    });
  });
}

// Advance one stage
window.advanceProgress = async (id) => {
  try {
    const snap = await getDoc(doc(db, "progress", id));
    if (!snap.exists()) return toast("Not found.", "error");
    const p = snap.data();

    const next = Math.min(5, (p.stage || 1) + 1);
    const stages = (p.stages || []).map(s => ({
      ...s,
      done: s.key <= next,
      at: s.key <= next && !s.at ? new Date().toISOString() : s.at
    }));

    await updateDoc(doc(db, "progress", id), {
      stage: next,
      stages,
      updatedAt: serverTimestamp()
    });

    toast(`✅ Advanced to stage ${next}/5`, "success");
  } catch (err) {
    console.error(err);
    toast("Failed to advance.", "error");
  }
};

// ============================================================
// SET STAGE MODAL — replace / advance / reset
// ============================================================
let _stageModalCtx = {
  progressId: null,
  current: 1,
  mode: "replace",
  selected: null,
  advanceBy: null
};

// Opens the modal from the admin panel
window.setProgressStage = async (id) => {
  try {
    const snap = await getDoc(doc(db, "progress", id));
    if (!snap.exists()) return toast("Not found.", "error");
    const p = snap.data();
    
    _stageModalCtx = {
      progressId: id,
      current: p.stage || 1,
      mode: "replace",
      selected: null,
      advanceBy: null
    };
    
    // Fill header
    $("setStageOrderInfo").textContent = `Order: ${p.orderRef || id.slice(0, 8)} · ${p.productName || ""}`;
    $("stageCurrentValue").textContent = `${_stageModalCtx.current}/5 — ${stageLabel(_stageModalCtx.current)}`;
    
    // Reset mode
    document.querySelectorAll(".stage-mode-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.mode === "replace");
    });
    $("stagePickerWrap").classList.remove("hidden");
    $("stageAdvanceWrap").classList.add("hidden");
    $("stageResetWrap").classList.add("hidden");
    
    // Reset picker
    document.querySelectorAll(".stage-opt").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".stage-adv-btn").forEach(b => b.classList.remove("active"));
    $("setStageError").textContent = "";
    
    $("setStageModal").classList.add("active");
    document.body.style.overflow = "hidden";
  } catch (err) {
    console.error(err);
    toast("Failed to load stage.", "error");
  }
};

window.closeSetStageModal = () => {
  $("setStageModal").classList.remove("active");
  document.body.style.overflow = "";
  _stageModalCtx = { progressId: null, current: 1, mode: "replace", selected: null, advanceBy: null };
};

// Stage label helper
function stageLabel(n) {
  const labels = ["Order Confirmed", "Packed & Ready", "In Transit (Safarini)", "Arrived Dar es Salaam", "Delivered"];
  return labels[(n || 1) - 1] || "";
}

// Mode buttons
document.querySelectorAll(".stage-mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    _stageModalCtx.mode = mode;
    document.querySelectorAll(".stage-mode-btn").forEach(b => {
      b.classList.toggle("active", b === btn);
    });
    
    $("stagePickerWrap").classList.toggle("hidden", mode !== "replace");
    $("stageAdvanceWrap").classList.toggle("hidden", mode !== "advance");
    $("stageResetWrap").classList.toggle("hidden", mode !== "reset");
    $("setStageError").textContent = "";
  });
});

// Stage picker buttons
document.querySelectorAll(".stage-opt").forEach(btn => {
  btn.addEventListener("click", () => {
    _stageModalCtx.selected = parseInt(btn.dataset.stage);
    document.querySelectorAll(".stage-opt").forEach(b => {
      b.classList.toggle("active", b === btn);
    });
  });
});

// Advance buttons
document.querySelectorAll(".stage-adv-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    _stageModalCtx.advanceBy = parseInt(btn.dataset.advance);
    document.querySelectorAll(".stage-adv-btn").forEach(b => {
      b.classList.toggle("active", b === btn);
    });
  });
});

// Apply
$("setStageApplyBtn")?.addEventListener("click", async () => {
  const { progressId, current, mode, selected, advanceBy } = _stageModalCtx;
  const errEl = $("setStageError");
  errEl.textContent = "";
  
  if (!progressId) return;
  
  let targetStage = current;
  
  if (mode === "replace") {
    if (!selected) { errEl.textContent = "Pick a stage to set."; return; }
    targetStage = selected;
  } else if (mode === "advance") {
    if (!advanceBy) { errEl.textContent = "Pick how many stages to advance."; return; }
    targetStage = Math.min(5, current + advanceBy);
    if (targetStage === current) {
      errEl.textContent = "Already at the final stage.";
      return;
    }
  } else if (mode === "reset") {
    targetStage = 1;
  }
  
  targetStage = Math.max(1, Math.min(5, targetStage));
  
  // Disable button
  const btn = $("setStageApplyBtn");
  btn.disabled = true;
  btn.textContent = "Applying…";
  
  try {
    const snap = await getDoc(doc(db, "progress", progressId));
    if (!snap.exists()) throw new Error("Progress doc gone");
    const p = snap.data();
    const now = new Date().toISOString();
    
    // Rebuild stages array
    const baseStages = (p.stages && p.stages.length === 5) ? p.stages : [
      { key: 1, label: "Order Confirmed", place: "China Warehouse", done: false, at: null },
      { key: 2, label: "Packed & Ready", place: "China Warehouse", done: false, at: null },
      { key: 3, label: "In Transit (Safarini)", place: "China → Tanzania", done: false, at: null },
      { key: 4, label: "Arrived Dar es Salaam", place: "Dar es Salaam", done: false, at: null },
      { key: 5, label: "Delivered", place: "Customer Address", done: false, at: null }
    ];
    
    const stages = baseStages.map(s => {
      if (s.key <= targetStage) {
        // Done — keep existing timestamp if already done, else stamp now
        return { ...s, done: true, at: s.at || now };
      } else {
        // Not done — clear timestamp
        return { ...s, done: false, at: null };
      }
    });
    
    await updateDoc(doc(db, "progress", progressId), {
      stage: targetStage,
      stages,
      updatedAt: serverTimestamp()
    });
    
    toast(`✅ Stage set to ${targetStage}/5 — ${stageLabel(targetStage)}`, "success", 3500);
    closeSetStageModal();
  } catch (err) {
    console.error(err);
    errEl.textContent = "Failed to update stage.";
  } finally {
    btn.disabled = false;
    btn.textContent = "✅ Apply";
  }
});

// Close on backdrop + Escape
$("setStageModal")?.addEventListener("click", (e) => {
  if (e.target.id === "setStageModal") closeSetStageModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("setStageModal")?.classList.contains("active")) {
    closeSetStageModal();
  }
});

window.deleteProgress = async (id) => {
  if (!confirm("Delete this progress record?")) return;
  await deleteDoc(doc(db, "progress", id));
  toast("Deleted.", "success");
};

// ============================================================
// LOCATION — copy address to clipboard
// ============================================================
window.copyLocationAddress = async (btn) => {
  const text = "57PV+M45, Dar es Salaam, Tanzania";

  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback for older browsers / non-secure contexts
      const tmp = document.createElement("input");
      tmp.value = text;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand("copy");
      tmp.remove();
    }

    toast("📋 Address copied!", "success");

    // Tiny visual feedback on the button itself
    if (btn) {
      const original = btn.innerHTML;
      btn.innerHTML = "✅ Copied!";
      btn.disabled = true;
      setTimeout(() => {
        btn.innerHTML = original;
        btn.disabled = false;
      }, 1600);
    }
  } catch (err) {
    console.error("Copy failed:", err);
    toast("Couldn't copy — please copy manually.", "error");
  }
};

// ============================================================
// LOCATION SETTINGS — admin editable
// ============================================================
(function setupLocationSettings() {
  const form = document.getElementById("locationSettingsForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const address    = document.getElementById("locationAddressInput").value.trim();
    const mapUrl     = document.getElementById("locationMapInput").value.trim();
    const directions = document.getElementById("locationDirectionsInput").value.trim();

    try {
      await setDoc(
        doc(db, "settings", "location"),
        { address, mapUrl, directions, updatedAt: serverTimestamp() },
        { merge: true }
      );
      toast("✅ Location saved.", "success");
    } catch (err) {
      console.error(err);
      toast("Failed to save location.", "error");
    }
  });

  onSnapshot(doc(db, "settings", "location"), (d) => {
    if (!d.exists()) return;
    const data = d.data();
    if (document.getElementById("locationAddressInput"))
      document.getElementById("locationAddressInput").value = data.address || "";
    if (document.getElementById("locationMapInput"))
      document.getElementById("locationMapInput").value = data.mapUrl || "";
    if (document.getElementById("locationDirectionsInput"))
      document.getElementById("locationDirectionsInput").value = data.directions || "";
  });
})();

// ============================================================
// PUBLIC LOCATION — apply saved settings
// ============================================================
onSnapshot(doc(db, "settings", "location"), (d) => {
  if (!d.exists()) return;
  const { address, mapUrl, directions } = d.data();

  const addrEl = document.getElementById("locationAddressText");
  if (addrEl && address) addrEl.textContent = address;

  const map = document.getElementById("mapFrame");
  if (map && mapUrl) map.src = mapUrl;

  const dirBtn = document.querySelector(".location-actions .btn-primary");
  if (dirBtn && directions) dirBtn.href = directions;

  // Update copy function target
  if (address) {
    window._locationAddress = address;
  }
});

// ============================================================
// ORDER COUNTERS — single source of truth for all badges
// ============================================================
function setupOrderCounters() {
  onSnapshot(collection(db, "orders"), (snap) => {
    const total = snap.size;
    const pending = snap.docs.filter(d => d.data().status === "pending").length;
    const approved = snap.docs.filter(d => d.data().status === "approved").length;
    const rejected = snap.docs.filter(d => d.data().status === "rejected").length;

    console.log("📊 Orders:", { total, pending, approved, rejected });

    // Update every badge that exists — harmless if missing
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    // Admin sidebar badge — shows PENDING count
    set("adOrdersBadge", pending);

    // Admin overview stat — shows TOTAL count
    set("adStatOrders", total);

    // Optional: if you show an approved count too
    set("adStatOrdersPending", pending);
    set("adStatOrdersApproved", approved);
    set("adStatOrdersRejected", rejected);

    // Hide badge if 0 pending, show if > 0
    const badge = document.getElementById("adOrdersBadge");
    if (badge) {
      badge.style.display = pending > 0 ? "inline-flex" : "none";
    }
  }, (err) => {
    console.error("Order counter listener failed:", err.code, err.message);
  });
}

// ============================================================
// EDIT SLIDE — load slide data into the admin form
// ============================================================
window.editSlide = async (id) => {
  try {
    const snap = await getDoc(doc(db, "slides", id));
    if (!snap.exists()) {
      toast("Slide not found.", "error");
      return;
    }
    const s = snap.data();

    // ---- Populate form fields ----
    $("slideId").value       = id;
    $("slideTitle").value    = s.title || "";
    $("slidePrice").value    = s.price || "";
    $("slideImage").value    = s.image || "";
    $("slideVideo").value    = s.video || "";
    $("slideDesc").value     = s.description || "";
    $("slideActive").checked = s.active !== false;

    // ---- Update form title + button ----
    $("adSlideFormTitle").textContent = "✏️ Edit Slide";
    const submitBtn = $("slideForm")?.querySelector(".btn-primary");
    if (submitBtn) submitBtn.textContent = "💾 Update Slide";

    // ---- Navigate to slides panel + scroll to form ----
    if (typeof adGo === "function") adGo("slides");

    setTimeout(() => {
      $("slideForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);

    toast("Editing: " + (s.title || "slide"), "info", 2500);
  } catch (err) {
    console.error("editSlide error:", err);
    toast("Failed to load slide.", "error");
  }
};

// ============================================================
// FORMAT DESCRIPTION — preserves newlines, auto-detects lists
// ============================================================
function formatDescription(text) {
  if (!text) return "";

  // Escape HTML to prevent injection
  const escaped = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const lines = escaped.split(/\r?\n/);

  // Detect if the text is predominantly a list
  const listLines = lines.filter(l => /^\s*([-*•]|\d+\.)\s+/.test(l));
  const isList = listLines.length >= 2 &&
                 listLines.length >= Math.ceil(lines.filter(l => l.trim()).length / 2);

  if (isList) {
    // Render as <ul> (or <ol> if numbered)
    const isOrdered = listLines.every(l => /^\s*\d+\.\s+/.test(l));
    const tag = isOrdered ? "ol" : "ul";

    const items = lines
      .filter(l => l.trim())
      .map(line => {
        // Strip the bullet/number prefix
        const cleaned = line
          .replace(/^\s*[-*•]\s+/, "")
          .replace(/^\s*\d+\.\s+/, "");
        return `<li>${cleaned}</li>`;
      })
      .join("");

    return `<${tag} class="desc-list">${items}</${tag}>`;
  }

  // Not a list — render paragraphs, preserving blank-line breaks
  return lines
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => `<p>${line}</p>`)
    .join("");
}

window.formatDescription = formatDescription;

// ============================================================
// LIVE DESCRIPTION PREVIEW
// ============================================================
(function setupDescPreviews() {
  const pairs = [
    { input: "aboutDescInput",   preview: "aboutDescPreview" },
    { input: "slideDesc",        preview: "slideDescPreview" },
    { input: "productDesc",      preview: "productDescPreview" }
  ];

  pairs.forEach(({ input, preview }) => {
    const inEl = document.getElementById(input);
    const pvEl = document.getElementById(preview);
    if (!inEl || !pvEl) return;

    const update = () => {
      pvEl.innerHTML = formatDescription(inEl.value);
    };
    inEl.addEventListener("input", update);
    update(); // initial
  });
})();

// ============================================================
// FOOTER — public side
// ============================================================
(function setupFooter() {
  // Auto year
  const yearEl = document.getElementById("footerYear");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Load settings (brand, tagline, copyright, credit, links)
  onSnapshot(doc(db, "settings", "footer"), (d) => {
    if (!d.exists()) return;
    const f = d.data();

    if (f.brandName) {
      document.getElementById("footerBrandName").textContent = f.brandName;
    }
    if (f.tagline) {
      document.getElementById("footerTagline").textContent = f.tagline;
    }
    if (f.credit) {
      document.getElementById("footerCredit").textContent = f.credit;
    }

    // Copyright — build with current year
    const copyEl = document.getElementById("footerCopyright");
    if (copyEl && f.copyrightText) {
      const year = new Date().getFullYear();
      copyEl.innerHTML =
        `© <span id="footerYear">${year}</span> ${f.copyrightText}`;
    }

    // Custom quick links (optional override)
    if (Array.isArray(f.quickLinks) && f.quickLinks.length > 0) {
      const ul = document.getElementById("footerQuickLinks");
      ul.innerHTML = "";
      f.quickLinks.forEach(link => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = link.href || "#";
        a.textContent = link.label || "";
        if (link.href?.startsWith("http")) {
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        li.appendChild(a);
        ul.appendChild(li);
      });
    }
  });

  // Load live contacts into footer (phone/email/address + socials)
  onSnapshot(query(collection(db, "contacts"), where("active", "==", true)), (snap) => {
    const contactList = document.getElementById("footerContactList");
    const socialsBox  = document.getElementById("footerSocials");

    // Collect items
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    items.sort((a, b) => (a.order || 0) - (b.order || 0));

    // ---- Contact list (phone / email / other) ----
    const contactItems = items.filter(c =>
      c.type === "phone" || c.type === "email" || c.type === "other"
    );

    contactList.innerHTML = "";
    if (contactItems.length === 0) {
      contactList.innerHTML =
        "<li><span class='fc-icon'>📍</span><span>Dar es Salaam, Tanzania</span></li>";
    } else {
      contactItems.slice(0, 5).forEach(c => {
        const li = document.createElement("li");
        const icon = c.icon || defaultContactIcon(c);
        const href = buildContactHref(c);

        li.innerHTML = `
          <span class="fc-icon">${icon}</span>
          ${href
            ? `<a href="${href}" ${href.startsWith("http") ? 'target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(c.value || "")}</a>`
            : `<span>${escapeHtml(c.value || "")}</span>`}
        `;
        contactList.appendChild(li);
      });
    }

    // ---- Socials ----
    const socialItems = items.filter(c => c.type === "social");
    socialsBox.innerHTML = "";
    socialItems.slice(0, 8).forEach(c => {
      const icon = c.icon || defaultContactIcon(c);
      const href = normalizeUrl(c.value || "", c.platform || "");
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = c.label || c.platform || "Social";
      a.innerHTML = icon;
      socialsBox.appendChild(a);
    });

    if (socialItems.length === 0) {
      socialsBox.innerHTML =
        `<span style="color:#64748b;font-size:.8rem">No socials yet.</span>`;
    }
  });

  // Newsletter submit
  const nlForm = document.getElementById("footerNewsletterForm");
  if (nlForm) {
    nlForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("footerNewsletterEmail").value.trim();
      const msgEl = document.getElementById("footerNewsletterMsg");
      msgEl.className = "footer-msg";
      msgEl.textContent = "";

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msgEl.textContent = "Please enter a valid email.";
        msgEl.classList.add("err");
        return;
      }

      try {
        await addDoc(collection(db, "subscribers"), {
          email: email.toLowerCase(),
          source: "footer",
          createdAt: serverTimestamp()
        });
        msgEl.textContent = "✅ Thanks for subscribing!";
        msgEl.classList.add("ok");
        nlForm.reset();
      } catch (err) {
        console.error(err);
        msgEl.textContent = "Failed to subscribe. Try again.";
        msgEl.classList.add("err");
      }
    });
  }
})();

// Small helpers used above
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildContactHref(c) {
  if (c.type === "phone") return "tel:" + String(c.value || "").replace(/[^\d+]/g, "");
  if (c.type === "email") return "mailto:" + c.value;
  if (/^https?:\/\//i.test(c.value || "")) return c.value;
  return "";
}

// ============================================================
// ADMIN — FOOTER
// ============================================================
function setupFooterAdmin() {
  // ----- Settings form -----
  const form = document.getElementById("footerSettingsForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = {
        brandName:     document.getElementById("ftBrandName").value.trim(),
        tagline:       document.getElementById("ftTagline").value.trim(),
        copyrightText: document.getElementById("ftCopyright").value.trim(),
        credit:        document.getElementById("ftCredit").value.trim(),
        updatedAt:     serverTimestamp()
      };
      try {
        await setDoc(doc(db, "settings", "footer"), data, { merge: true });
        toast("✅ Footer saved.", "success");
      } catch (err) {
        console.error(err);
        toast("Failed to save footer.", "error");
      }
    });

    // Live-load existing settings
    onSnapshot(doc(db, "settings", "footer"), (d) => {
      if (!d.exists()) return;
      const f = d.data();
      document.getElementById("ftBrandName").value  = f.brandName || "";
      document.getElementById("ftTagline").value    = f.tagline || "";
      document.getElementById("ftCopyright").value  = f.copyrightText || "";
      document.getElementById("ftCredit").value     = f.credit || "";
    });
  }

  // ----- Quick links form -----
  const linkForm = document.getElementById("footerLinkForm");
  if (linkForm) {
    linkForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const idx   = document.getElementById("ftLinkIndex").value;
      const label = document.getElementById("ftLinkLabel").value.trim();
      const href  = document.getElementById("ftLinkHref").value.trim();

      if (!label || !href) {
        toast("Label and URL are required.", "warning");
        return;
      }

      // Read current links
      const snap = await getDoc(doc(db, "settings", "footer"));
      const current = (snap.exists() && Array.isArray(snap.data().quickLinks))
        ? [...snap.data().quickLinks]
        : [];

      if (idx === "") {
        current.push({ label, href });
      } else {
        current[parseInt(idx)] = { label, href };
      }

      try {
        await setDoc(doc(db, "settings", "footer"),
          { quickLinks: current, updatedAt: serverTimestamp() },
          { merge: true });
        toast("✅ Link saved.", "success");
        resetFooterLinkForm();
      } catch (err) {
        console.error(err);
        toast("Failed to save link.", "error");
      }
    });
  }

  // ----- Live list of quick links -----
  onSnapshot(doc(db, "settings", "footer"), (d) => {
    const list = document.getElementById("adminFooterLinkList");
    if (!list) return;
    list.innerHTML = "";
    if (!d.exists() || !Array.isArray(d.data().quickLinks) ||
        d.data().quickLinks.length === 0) {
      list.innerHTML = "<p class='ud-empty'>No custom links. Defaults will be used.</p>";
      return;
    }
    d.data().quickLinks.forEach((l, i) => {
      const div = document.createElement("div");
      div.className = "ad-item";
      div.innerHTML = `
        <div class="ad-item-body">
          <h5>${l.label}</h5>
          <p>${l.href}</p>
        </div>
        <div class="ad-item-actions">
          <button class="btn-edit"   onclick="editFooterLink(${i})">Edit</button>
          <button class="btn-delete" onclick="deleteFooterLink(${i})">Delete</button>
        </div>`;
      list.appendChild(div);
    });
  });

  // ----- Subscribers list -----
  onSnapshot(collection(db, "subscribers"), (snap) => {
    const list = document.getElementById("adminSubscriberList");
    const cnt  = document.getElementById("adSubscriberCount");
    if (!list) return;
    if (cnt) cnt.textContent = snap.size;

    if (snap.empty) {
      list.innerHTML = "<p class='ud-empty'>No subscribers yet.</p>";
      return;
    }

    const arr = [];
    snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
    arr.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    list.innerHTML = "";
    arr.forEach(s => {
      const div = document.createElement("div");
      div.className = "ad-item";
      div.innerHTML = `
        <div class="ad-item-body">
          <h5>${s.email}</h5>
          <p>${s.createdAt?.toDate ? s.createdAt.toDate().toLocaleString() : ""}</p>
        </div>
        <div class="ad-item-actions">
          <button class="btn-delete" onclick="deleteSubscriber('${s.id}')">Delete</button>
        </div>`;
      list.appendChild(div);
    });
  });
}

window.resetFooterLinkForm = () => {
  const f = document.getElementById("footerLinkForm");
  if (f) f.reset();
  const idx = document.getElementById("ftLinkIndex");
  if (idx) idx.value = "";
};

window.editFooterLink = async (i) => {
  const snap = await getDoc(doc(db, "settings", "footer"));
  if (!snap.exists()) return;
  const links = snap.data().quickLinks || [];
  const l = links[i];
  if (!l) return;

  document.getElementById("ftLinkIndex").value = i;
  document.getElementById("ftLinkLabel").value = l.label || "";
  document.getElementById("ftLinkHref").value  = l.href  || "";
};

window.deleteFooterLink = async (i) => {
  if (!confirm("Delete this footer link?")) return;
  const snap = await getDoc(doc(db, "settings", "footer"));
  if (!snap.exists()) return;
  const links = [...(snap.data().quickLinks || [])];
  links.splice(i, 1);
  await setDoc(doc(db, "settings", "footer"),
    { quickLinks: links, updatedAt: serverTimestamp() },
    { merge: true });
  toast("Link deleted.", "success");
};

window.deleteSubscriber = async (id) => {
  if (!confirm("Remove this subscriber?")) return;
  await deleteDoc(doc(db, "subscribers", id));
  toast("Subscriber removed.", "success");
};

aboutForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("aboutId").value;
  const title = document.getElementById("aboutTitleInput").value.trim();
  const description = document.getElementById("aboutDescInput").value;
  const image = document.getElementById("aboutImageInput").value.trim();
  const link = document.getElementById("aboutLinkInput").value = "";
  const order = parseInt(document.getElementById("aboutOrderInput").value) || 1;
  const active = document.getElementById("aboutActiveInput").checked;

  if (!title || !description.trim()) {
    toast("Title and description are required.", "warning");
    return;
  }

  const data = {
    title, description, image,
    link,                                  // ← NEW
    order, active,
    updatedAt: serverTimestamp()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "aboutItems", id), data);
      toast("About item updated.", "success");
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "aboutItems"), data);
      toast("About item added.", "success");
    }
    resetAboutForm();
  } catch (err) {
    console.error(err);
    toast("Save failed.", "error");
  }
});