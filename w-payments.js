import { db } from "./firebase-config.js";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const paymentTable = document.getElementById("paymentTable");

// 🔥 Load payment requests
const q = query(collection(db, "payments"), orderBy("createdAt", "desc"));
onSnapshot(q, async (snapshot) => {
  paymentTable.innerHTML = "";
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();

    // User ka email fetch karo
    let email = "Unknown";
    if (data.uid) {
      const userRef = doc(db, "users", data.uid);
      const userDoc = await getDoc(userRef);
      if (userDoc.exists()) {
        email = userDoc.data().email;
      }
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${email}</td>
      <td>${data.accountHolder || "-"}</td>
      <td>${data.accountNumber || "-"}</td>
      <td>${data.amount} PKR</td>
      <td>${data.status}</td>
      <td>${data.createdAt?.toDate().toLocaleString() || "N/A"}</td>
      <td>
        ${
          data.status === "pending"
            ? `
          <button class="approve" data-id="${docSnap.id}" data-uid="${data.uid}" data-amount="${data.amount}">Approve</button>
          <button class="reject" data-id="${docSnap.id}">Reject</button>
          `
            : "✅ Processed"
        }
      </td>
    `;
    paymentTable.appendChild(tr);
  }

  // 🎯 Approve button
  document.querySelectorAll(".approve").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const uid = btn.getAttribute("data-uid");
      const amount = parseInt(btn.getAttribute("data-amount"), 10);

      const userRef = doc(db, "users", uid);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        let balance = userDoc.data().balance || 0;

        // 🟢 Add balance on payment approval
        await updateDoc(userRef, { balance: balance + amount });
        await updateDoc(doc(db, "payments", id), { status: "approved" });
        alert("✅ Payment approved & balance added!");
      }
    });
  });

  // 🎯 Reject button
  document.querySelectorAll(".reject").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      await updateDoc(doc(db, "payments", id), { status: "rejected" });
      alert("❌ Payment request rejected!");
    });
  });
});
