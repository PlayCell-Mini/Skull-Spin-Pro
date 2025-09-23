import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "firebase/auth";

import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase-config.js";

// Buttons aur elements get karo
const loginBtn = document.getElementById("loginBtn");
const signupBtn = document.getElementById("signupBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userInfo = document.getElementById("userInfo");
const addBalanceBtn = document.querySelector("button[onclick='addBalance()']");
const withdrawBtn = document.querySelector("button[onclick='withdraw()']");

// Balance load karne ka function
async function loadBalance(user) {
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    userInfo.innerText = `Balance: ${userSnap.data().balance} PKR`;
  } else {
    await setDoc(userRef, { balance: 0 });
    userInfo.innerText = "Balance: 0 PKR";
  }
}

// Auth state change listener
onAuthStateChanged(auth, (user) => {
  if (user) {
    // ✅ User login hai
    loginBtn.style.display = "none";
    signupBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    addBalanceBtn.style.display = "inline-block";
    withdrawBtn.style.display = "inline-block";
    userInfo.style.display = "inline-block";

    loadBalance(user);

  } else {
    // ❌ User logout hai
    loginBtn.style.display = "inline-block";
    signupBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    addBalanceBtn.style.display = "none";
    withdrawBtn.style.display = "none";
    userInfo.style.display = "none";
  }
});

// Login function
loginBtn.addEventListener("click", async () => {
  const email = prompt("Enter email:");
  const password = prompt("Enter password:");

  try {
    await signInWithEmailAndPassword(auth, email, password);
    alert("✅ Login successful");
  } catch (error) {
    alert("❌ " + error.message);
  }
});

// Signup function
signupBtn.addEventListener("click", async () => {
  const email = prompt("Enter email:");
  const password = prompt("Enter password (min 6 chars):");

  if (!email || !password) {
    alert("Email and password are required!");
    return;
  }

  if (password.length < 6) {
    alert("Password must be at least 6 characters long!");
    return;
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const userRef = doc(db, "users", userCredential.user.uid);
    await setDoc(userRef, { balance: 0 });
    alert("✅ Account created & logged in");
  } catch (error) {
    alert("❌ " + error.message);
  }
});

// Logout function
logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  alert("✅ Logged out");
});
