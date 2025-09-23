// auth.js (with Name + Username save + referral support)
// Signup, Login, Logout, Auth check

import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  updateDoc,
  increment
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/** Show status messages */
function showStatus(msg, color = "red") {
  let statusBox = document.getElementById("authStatus");
  if (!statusBox) {
    statusBox = document.createElement("p");
    statusBox.id = "authStatus";
    statusBox.style.position = "fixed";
    statusBox.style.top = "12px";
    statusBox.style.right = "12px";
    statusBox.style.zIndex = "9999";
    statusBox.style.padding = "8px 12px";
    statusBox.style.borderRadius = "8px";
    statusBox.style.background = "rgba(0,0,0,0.6)";
    statusBox.style.color = "#fff";
    document.body.appendChild(statusBox);
  }
  statusBox.textContent = msg;
  statusBox.style.background =
    color === "green"
      ? "rgba(40,167,69,0.9)"
      : "rgba(220,53,69,0.95)";
  statusBox.style.display = "block";
  clearTimeout(showStatus._hideTimer);
  showStatus._hideTimer = setTimeout(() => {
    statusBox.style.display = "none";
  }, 5000);
}

/** ---------------- REFERRAL HANDLING ---------------- */
// Extract ?ref=uid from URL
function getReferralFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get("ref") || "";
}

// Auto-fill referral code field if exists
window.addEventListener("DOMContentLoaded", () => {
  const urlRef = getReferralFromURL();
  if (urlRef) {
    const input = document.getElementById("refCode");
    if (input) input.value = urlRef;
  }
});

/** ---------------- SIGNUP ---------------- */
document.getElementById("signupBtn")?.addEventListener("click", async () => {
  const name = (document.getElementById("name")?.value || "").trim();
  const username = (document.getElementById("username")?.value || "").trim().toLowerCase();
  const email = (document.getElementById("signupEmail")?.value || "").trim().toLowerCase();
  const password = (document.getElementById("signupPassword")?.value || "");
  const confirmPassword = (document.getElementById("confirmPassword")?.value || "");

  // Referral: input or URL
  let refCodeInput = (document.getElementById("refCode")?.value || "").trim();
  if (!refCodeInput) {
    refCodeInput = getReferralFromURL();
  }

  // validations
  if (!name || !username || !email || !password || !confirmPassword) {
    showStatus("⚠️ Please fill all fields.", "red");
    return;
  }
  if (password !== confirmPassword) {
    showStatus("⚠️ Passwords do not match.", "red");
    return;
  }
  if (password.length < 6) {
    showStatus("⚠️ Password must be at least 6 characters.", "red");
    return;
  }

  try {
    // create firebase auth account
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // prepare user doc with all details
    const userRef = doc(db, "users", user.uid);
    const baseData = {
      name,
      username,
      email: user.email,
      balance: 0,
      createdAt: serverTimestamp(),
      referCode: user.uid,      // user can share this UID as referral code
      referralsCount: 0
    };

    await setDoc(userRef, baseData);

    // If there is a referral code, check and apply
    if (refCodeInput && refCodeInput !== user.uid) {
      try {
        const referrerRef = doc(db, "users", refCodeInput);
        const refSnap = await getDoc(referrerRef);
        if (refSnap.exists()) {
          await updateDoc(userRef, {
            referredBy: refCodeInput,
            referredAt: serverTimestamp()
          }).catch(()=>{});

          try {
            await updateDoc(referrerRef, { referralsCount: increment(1) });
          } catch (e) {
            try { await updateDoc(referrerRef, { referralsCount: 1 }); } catch(e2){}
          }
        }
      } catch (e) {
        console.error("Referral handling error (signup):", e);
      }
    }

    showStatus("✅ Signup successful! Redirecting...", "green");
    setTimeout(() => { window.location.href = "index.html"; }, 1200);
  } catch (error) {
    const code = error.code || "";
    if (code === "auth/email-already-in-use") {
      showStatus("❌ Email already in use. Try logging in.", "red");
    } else if (code === "auth/invalid-email") {
      showStatus("❌ Invalid email address.", "red");
    } else {
      showStatus("❌ " + (error.message || "Signup failed"), "red");
    }
    console.error("Signup error:", error);
  }
});

/** ---------------- LOGIN ---------------- */
document.getElementById("loginBtn")?.addEventListener("click", async () => {
  const email = (document.getElementById("loginEmail")?.value || "").trim().toLowerCase();
  const password = (document.getElementById("loginPassword")?.value || "");

  if (!email || !password) {
    showStatus("⚠️ Please enter email and password.", "red");
    return;
  }

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const user = credential.user;

    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      await signOut(auth);
      showStatus("No Account Found, Please Sign-Up", "red");
      return;
    }

    showStatus("✅ Login successful! Redirecting...", "green");
    setTimeout(() => { window.location.href = "index.html"; }, 800);
  } catch (error) {
    const code = error.code || "";
    console.error("Login error:", error);

    if (code === "auth/user-not-found") {
      showStatus("No Account Found, Please Sign-Up", "red");
      return;
    }
    if (code === "auth/wrong-password") {
      showStatus("Invalid Password", "red");
      return;
    }
    showStatus("❌ " + (error.message || "Login failed"), "red");
  }
});

/** ---------------- LOGOUT ---------------- */
export async function logout() {
  try {
    await signOut(auth);
  } catch (e) {
    console.error("Logout failed:", e);
  }
  window.location.href = "auth.html";
}

/** ---------------- AUTH CHECK ---------------- */
onAuthStateChanged(auth, (user) => {
  if (!user && !window.location.href.includes("auth.html")) {
    window.location.href = "auth.html";
  }
});
