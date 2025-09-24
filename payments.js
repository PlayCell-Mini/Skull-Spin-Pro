// payments.js
import { auth, db } from "./firebase-config.js";
import {
  addDoc,
  collection,
  serverTimestamp,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// Receiver static method only (account number ab user input hoga)
const RECEIVER = {
  method: "Easypaisa"
};

/**
 * Add a new transaction to Firestore & update balance
 * @param {string} accountHolder - Account Holder Name (user input)
 * @param {string} accountNumber - Account Number (user input)
 * @param {number} amount - Amount user entered (>=100 PKR)
 */
export async function createTransaction(accountHolder, accountNumber, amount) {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error("No authenticated user found!");
    const MIN_PAYMENT = 100;
    if (!accountHolder || !accountNumber || !amount || amount < MIN_PAYMENT) {
      throw new Error(`⚠️ Please enter minimum Rs: ${MIN_PAYMENT}`);
    }

    // Generate unique reference
    const reference = `REF-${user.uid.slice(0, 6)}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;

    // ✅ Add transaction to Firestore
    await addDoc(collection(db, "transactions"), {
      uid: user.uid,
      accountHolder,             // user input
      accountNumber,             // user input
      amount,
      method: RECEIVER.method,   // fixed: Easypaisa
      accountReceiver: accountNumber, // 🔥 ab user ka diya hua number save hoga
      reference,
      status: "pending",
      createdAt: serverTimestamp()
    });

    // ✅ Update user's balance
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const currentBalance = userSnap.data().balance || 0;
      await updateDoc(userRef, {
        balance: currentBalance + amount
      });
    } else {
      await setDoc(userRef, { balance: amount }, { merge: true });
    }

    // ✅ Show success message
    showStatus("✅ Process complete. Payment will add within 30 min.", "green");
    return { success: true, reference };
  } catch (err) {
    console.error("❌ Error creating transaction:", err);
    showStatus("❌ " + err.message, "red");
    return { success: false, error: err.message };
  }
}

/**
 * Get all transactions of the current user
 */
export async function getMyTransactions() {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error("No authenticated user found!");

    const q = query(collection(db, "transactions"), where("uid", "==", user.uid));
    const snapshot = await getDocs(q);

    const data = [];
    snapshot.forEach((doc) => {
      data.push({ id: doc.id, ...doc.data() });
    });

    return data;
  } catch (err) {
    console.error("❌ Error fetching transactions:", err);
    return [];
  }
}

/**
 * Show temporary status message (success or error)
 * @param {string} msg - Message text
 * @param {string} color - "green" or "red"
 */
function showStatus(msg, color) {
  const statusMsg = document.getElementById("statusMessage");
  if (!statusMsg) return;

  statusMsg.textContent = msg;
  statusMsg.style.color = color;
  statusMsg.style.display = "block";

  // Hide after 5 seconds
  setTimeout(() => {
    statusMsg.style.display = "none";
  }, 5000);
}
